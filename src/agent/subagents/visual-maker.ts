import { randomUUID } from "node:crypto";
import type { Message, Tool, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { agentEngine, type PiEngine } from "../models.ts";
import { forgetConversation, labelConversation } from "../agent-bridge.ts";
import type { VisualResult } from "../../core/contracts.ts";
import { getHeadless, type HeadlessApi } from "./headless.ts";
import { streamOnce, toolText as textResult } from "./stream-once.ts";

/**
 * The visual-maker sub-agent (docs/vision.md §2.5): authors ONE precise SVG
 * from a brief, renders it to a PNG with the same rasterizer the transcript
 * will use, LOOKS at the result, and iterates until correct ("the one rule
 * that matters: verify by looking").
 *
 * LOOP SHAPE: hand-rolled with streamOnce + a messages array, because the
 * loop must feed an IMAGE back to the model after each render. The tools
 * are declared WITHOUT execute: the model call stops with the tool calls,
 * and this loop appends the tool results itself, followed by a user
 * message containing the rendered PNG ("Here is the current render"). The
 * agent loop's execute-tool plumbing can't express that shape cleanly.
 *
 * Doctrine enforcement in code: if the model tries to finish while the
 * current SVG has never been rendered (or changed since its last render), the
 * loop renders it anyway, shows the image, and asks the model to look before
 * finishing. Nothing is delivered without having been looked at.
 *
 * Failure semantics mirror the demo-builder: { svg: "", notes: "FAILED: …" }.
 */

interface VisualMakerInput {
	brief: string;
}

interface VisualMakerOptions {
	/** Test seam: scripted engine; production runs on the outside agent. */
	engine?: PiEngine;
	headless?: HeadlessApi;
	/** Max model rounds (write/render cycles + final answer). Default 8. */
	maxIterations?: number;
	/** Live activity-line callback (updates the job record). */
	onActivity?: (line: string) => void;
	/** Kills the run mid-model-call. */
	abortSignal?: AbortSignal;
	/** Token usage: one call per loop iteration, folded into
	 * JobRecord.usage. */
	onUsage?: (usage: Usage) => void;
}

const INSTRUCTIONS = `You are a visual maker — a diagram author + renderer for precise, spatial figures. You
receive a brief describing ONE idea that needs exact placement (coordinate geometry, number lines,
vectors, function plots, physical layouts — things auto-layout diagrams cannot express), and you return
ONE clean, correct SVG. You never see the lesson; the brief is everything you know.

You do NOT decide what idea to show — the teacher already decided. Your job is faithful, precise
composition, and above everything CORRECTNESS: the picture must not assert anything false. A right-angle
mark on the wrong corner, a vector pointing the wrong way, a point plotted at the wrong coordinate is a
failure even if it renders cleanly.

Your three tools:
- write_svg({ svg }) — write the complete <svg>…</svg> source (overwrites the previous version).
- edit_svg({ old_text, new_text }) — a surgical exact-match replacement in the current SVG:
  old_text must appear EXACTLY ONCE; it is replaced by new_text. Call write_svg first. For anything
  beyond a one-spot fix (new elements, restructured layout), write_svg the whole document again.
- render_svg({}) — rasterize the current SVG to a PNG. The render arrives as an image in the
  message right after the tool result.

THE ONE RULE THAT MATTERS MOST: verify by looking. You are done only when you have LOOKED at the
rendered PNG and confirmed it is true to the brief. Rendering success only proves the SVG parsed; it
says nothing about whether the geometry is right or the picture is readable. When you look:

- Is every coordinate, angle, direction, and proportion actually correct? Re-derive the geometry if unsure.
- Are labels placed clearly, not overlapping lines or each other?
- Is anything clipped by the viewBox, too small to read, or cramped?
- Would a learner instantly read the intended idea from this picture alone?

Workflow: plan the coordinate space (viewBox + margins, nothing touching the edges) → write_svg →
render_svg → LOOK critically → fix (edit_svg for one-spot fixes, write_svg otherwise) and re-render
until correct and clean. Never finish without having looked at a render of your FINAL SVG.

SVG requirements:
- A complete <svg> with explicit width/height AND a matching viewBox.
- White background (<rect> or style), dark strokes, sans-serif labels at generous sizes.
- One idea, fewest elements — sparse and large beats busy and tiny.
- Draw only what the brief specifies; never invent data, values, or shapes to fill space.
- Plain, clean styling: at most one accent color. An explanatory diagram, not art.

Your FINAL message: 1-2 sentences of notes for the teacher (what the figure shows, any caveats) —
NEVER the SVG source itself. If you genuinely cannot make a correct picture of the brief, say exactly
that in your final message and why.`;

/** The wire declarations (pi-ai Tool, TypeBox parameters): this loop owns
 *  execution itself — write/edit dispatch inline below, render feeds the
 *  image-in-the-loop message — so the declarations carry no execute. */
function createVisualTools(): Record<string, Tool> {
	return {
		write_svg: {
			name: "write_svg",
			description: "Write the complete SVG source for the figure (overwrites any previous version).",
			parameters: Type.Object({
				svg: Type.String({ description: 'Complete <svg xmlns="…">…</svg> markup.' }),
			}),
		},
		edit_svg: {
			name: "edit_svg",
			description:
				"Replace one exact spot in the current SVG: old_text must appear EXACTLY ONCE and is replaced by new_text. Call write_svg first. For larger changes, write_svg the whole document.",
			parameters: Type.Object({
				old_text: Type.String({ description: "The exact text to replace — must match exactly once in the current SVG." }),
				new_text: Type.String({ description: "The replacement text." }),
			}),
		},
		render_svg: {
			name: "render_svg",
			description: "Render the current SVG to a PNG and show it to you for inspection. No arguments.",
			parameters: Type.Object({}),
		},
	};
}

const LOOK_MESSAGE =
	"Here is the current render of your SVG — inspect it critically (geometry, labels, clipping, readability):";
const UNLOOKED_FINISH_MESSAGE =
	"You finished without looking at a render of your final SVG. Above is its render. If it is correct and clean, reply with just your notes; otherwise call write_svg with fixes and render again.";

export async function runVisualMaker(input: VisualMakerInput, opts: VisualMakerOptions = {}): Promise<VisualResult> {
	const headless = opts.headless ?? getHeadless();
	const brief = input.brief.trim() || "(no brief)";
	const maxIterations = opts.maxIterations ?? 8;

	const reason = headless.unavailableReason();
	if (reason) {
		return { svg: "", notes: `FAILED: ${reason}` };
	}

	const tools = createVisualTools();
	const toolDeclarations = Object.values(tools);
	const engine = opts.engine ?? agentEngine();
	const sessionId = randomUUID();
	labelConversation(sessionId, `Visual · ${brief.split("\n")[0]}`);
	const prompt = [
		"Brief for ONE precise figure (from the teacher, verbatim — it is everything you know):",
		brief,
		"",
		"Author the SVG, render it, look at it, iterate until correct, then finish with your notes.",
	].join("\n");

	let messages: Message[] = [{ role: "user", content: prompt, timestamp: Date.now() }];
	let currentSvg: string | null = null;
	/** The svg shown in the most recent render (null = never rendered). */
	let renderedSvg: string | null = null;
	/** The svg in a render the model has actually received. */
	let lookedSvg: string | null = null;
	let finalText = "";

	try {
		for (let iteration = 0; iteration < maxIterations; iteration++) {
			// One model call per iteration (no agent loop: this loop owns tool
			// execution and the image-in-the-loop injection).
			const result = await streamOnce(
				engine,
				INSTRUCTIONS,
				messages,
				toolDeclarations,
				sessionId,
				opts.abortSignal,
			);
			// Every render already in `messages` was part of that call's input.
			lookedSvg = renderedSvg;
			opts.onUsage?.(result.usage);
			messages = [...messages, result];

			const toolCalls = result.content.filter((c): c is Extract<typeof c, { type: "toolCall" }> => c.type === "toolCall");
			if (toolCalls.length === 0) {
				finalText = result.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("")
					.trim();
				// Doctrine gate: never deliver an unlooked SVG. If the current SVG
				// changed since its last render (or was never rendered), show it now
				// and make the model look before accepting the finish.
				if (currentSvg && renderedSvg !== currentSvg) {
					let png: Buffer;
					try {
						png = await headless.renderSvg(currentSvg);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						return { svg: "", notes: `FAILED: rendering the final SVG failed — ${msg}` };
					}
					opts.onActivity?.("render_svg: inspecting final render");
					renderedSvg = currentSvg;
					messages = [
						...messages,
						{
							role: "user",
							content: [
								{ type: "text", text: UNLOOKED_FINISH_MESSAGE },
								{ type: "image", data: png.toString("base64"), mimeType: "image/png" },
							],
							timestamp: Date.now(),
						},
					];
					continue;
				}
				return finish(currentSvg, finalText);
			}

			const toolResults: ToolResultMessage[] = [];
			let renderPng: Buffer | null = null; // appended as the image message AFTER the tool results
			for (const call of toolCalls) {
				if (call.name === "write_svg") {
					const svg = (call.arguments as { svg?: unknown }).svg;
					if (typeof svg !== "string" || !svg.includes("<svg")) {
						toolResults.push(toolText(call.id, call.name, "ERROR: expected a complete <svg>…</svg> document in the `svg` field."));
						continue;
					}
					currentSvg = svg;
					opts.onActivity?.(`write_svg: ${(svg.length / 1024).toFixed(1)} KB`);
					toolResults.push(toolText(call.id, call.name, `Saved (${svg.length} bytes). Call render_svg to look at it.`));
				} else if (call.name === "edit_svg") {
					const edit = call.arguments as { old_text?: unknown; new_text?: unknown };
					if (!currentSvg) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to edit — call write_svg first."));
						continue;
					}
					if (typeof edit.old_text !== "string" || typeof edit.new_text !== "string" || !edit.old_text) {
						toolResults.push(toolText(call.id, call.name, "ERROR: expected old_text (non-empty) and new_text strings."));
						continue;
					}
					const occurrences = currentSvg.split(edit.old_text).length - 1;
					if (occurrences === 0) {
						toolResults.push(
							toolText(
								call.id,
								call.name,
								`ERROR: old_text not found. Closest line for reference:\n${snippetAround(currentSvg, edit.old_text)}`,
							),
						);
						continue;
					}
					if (occurrences > 1) {
						toolResults.push(
							toolText(call.id, call.name, `ERROR: old_text appears ${occurrences} times — it must match EXACTLY ONCE. Include more surrounding context to make it unique.`),
						);
						continue;
					}
					// A replacer function inserts new_text as written ("$&", "$$"
					// in a string replacement would be expanded as patterns).
					const newText = edit.new_text;
					currentSvg = currentSvg.replace(edit.old_text, () => newText);
					opts.onActivity?.("edit_svg: applied");
					toolResults.push(toolText(call.id, call.name, "OK — replaced 1 occurrence. Call render_svg to look at the edited SVG."));
				} else if (call.name === "render_svg") {
					if (!currentSvg) {
						toolResults.push(toolText(call.id, call.name, "ERROR: nothing to render — call write_svg first."));
						continue;
					}
					try {
						const png = await headless.renderSvg(currentSvg);
						renderPng = png;
						renderedSvg = currentSvg;
						opts.onActivity?.("render_svg: inspecting render");
						toolResults.push(toolText(call.id, call.name, "Rendered — the PNG follows in the next message. Look at it."));
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						opts.onActivity?.("render_svg: render error");
						toolResults.push(toolText(call.id, call.name, `RENDER ERROR (the SVG may be malformed): ${msg}. Fix it with write_svg and render again.`));
					}
				} else {
					toolResults.push(toolText(call.id, call.name, `ERROR: unknown tool "${call.name}". Use write_svg, edit_svg, or render_svg.`));
				}
			}
			// Message order: assistant tool-calls → tool results → render image.
			messages = [...messages, ...toolResults];
			if (renderPng) {
				messages = [
					...messages,
					{
						role: "user",
						content: [
							{ type: "text", text: LOOK_MESSAGE },
							{ type: "image", data: renderPng.toString("base64"), mimeType: "image/png" },
						],
						timestamp: Date.now(),
					},
				];
			}
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { svg: "", notes: `FAILED: the maker crashed — ${msg}` };
	} finally {
		forgetConversation(sessionId);
	}

	// Iteration limit: deliver the last written SVG only if it was looked at.
	if (currentSvg && lookedSvg === currentSvg) {
		return { svg: currentSvg, notes: finalText || "Iteration limit reached — delivering the last verified SVG." };
	}
	return { svg: "", notes: `FAILED: iteration limit (${maxIterations}) reached without a verified SVG.` };
}

function toolText(toolCallId: string, toolName: string, value: string): ToolResultMessage {
	return textResult(toolCallId, toolName, value, value.startsWith("ERROR:") || value.startsWith("RENDER ERROR"));
}

/** A 3-line numbered context window around the closest fuzzy match for a
 *  failed edit — enough for the model to see what went wrong and retry
 *  (the pi svg_tools snippetAround semantics). */
function snippetAround(svg: string, target: string): string {
	const words = target.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "(empty old_text)";
	const lines = svg.split("\n");
	let bestAt = -1;
	let bestScore = -1;
	for (let i = 0; i < lines.length; i++) {
		const score = words.filter((w) => lines[i]!.includes(w)).length;
		if (score > bestScore) {
			bestScore = score;
			bestAt = i;
		}
	}
	if (bestAt < 0) return "(no similar line found)";
	const from = Math.max(0, bestAt - 1);
	const to = Math.min(lines.length, bestAt + 2);
	return lines
		.slice(from, to)
		.map((line, idx) => `${from + idx + 1} | ${line}`)
		.join("\n");
}

function finish(svg: string | null, finalText: string): VisualResult {
	if (!svg) {
		return {
			svg: "",
			notes: `FAILED: the maker never wrote an SVG.${finalText ? ` (${finalText.slice(0, 300)})` : ""}`,
		};
	}
	return { svg, notes: finalText || undefined };
}
