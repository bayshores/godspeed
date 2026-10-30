/**
 * runSubmitAgent — the shared single-submit agent seam: one TypeBox-validated
 * submit call is the whole deliverable (a pi agent purely so the model can
 * retry a schema-invalid call). The submitted value is captured from the
 * execute seam, which only fires on a schema-valid call; the ??-fill
 * applies at the capture.
 */

import type { Usage } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "typebox";
import { invalidInputResult, toToolResult } from "../tool-execute.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";
import { healEncodedArguments } from "../../core/argument-heal.ts";

// ── the weak-model string-heal ──
//
// Weak models under a big submit payload often emit a whole array as ONE
// JSON-STRING instead of a native array ("propositions.0: must be
// object"). pi-agent-core runs `prepareArguments` BEFORE TypeBox
// validation, so heal it there instead of costing a retry. Best-effort:
// heal only a string that parses to an array; anything else passes
// through untouched and fails validation.
export function healStringifiedArrays(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) return raw;
	const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
	for (const key of ["propositions", "chains", "reteaches"]) {
		const v = out[key];
		if (typeof v !== "string" || v.trim().length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(v);
			if (Array.isArray(parsed)) out[key] = parsed;
		} catch {
			// not a clean stringify (e.g. truncated) — leave for validation
		}
	}
	return out;
}

export async function runSubmitAgent<T>(opts: {
	toolName: string;
	toolDescription: string;
	parameters: TSchema;
	/** Weak-model tolerance: defaults for omitted optional fields,
	 *  applied to the schema-valid raw input at the submit seam. */
	fill: (input: any) => T;
	systemPrompt: string;
	prompt: string;
	engine: PiEngine | undefined;
	signal: AbortSignal | undefined;
	onStep: (usage: Usage, model: string, step: number, finishReason: string, tools: string) => void;
	neverSubmitted: string;
	/** The task's name on outside-agent work items (pi-run taskLabel). */
	taskLabel?: string;
	/** Weak-model argument heal at pi's prepareArguments seam (runs BEFORE
	 *  TypeBox validation). Identity by default; extraction wires
	 *  healStringifiedArrays here. */
	prepareArguments?: (args: unknown) => unknown;
	/** Semantic validation at the submit seam: the value is schema-valid
	 *  but may violate a PIPELINE law (coverage, echo-equality). Returning
	 *  a problem string yields an isError result (invalidInputResult) →
	 *  the model retries within its turns. null = accept. */
	validate?: (value: T) => string | null;
}): Promise<T> {
	let submitted: T | undefined;
	const result = await runSubagent(
		[
			{
				name: opts.toolName,
				label: opts.toolName,
				description: opts.toolDescription,
				parameters: opts.parameters,
				prepareArguments: (args) =>
					// The standard heal composes AFTER the caller's shim;
					// extraction's healStringifiedArrays stays the inner pass.
					healEncodedArguments(
						opts.prepareArguments ? opts.prepareArguments(args) : args,
						opts.parameters,
					) as never,
				execute: async (_toolCallId, input) => {
					const value = opts.fill(input);
					const problem = opts.validate?.(value) ?? null;
					if (problem) return invalidInputResult(opts.toolName, [problem]);
					submitted = value;
					return toToolResult(submitted);
				},
			} satisfies AgentTool<any>,
		],
		{
			engine: opts.engine,
			systemPrompt: opts.systemPrompt,
			prompt: opts.prompt,
			maxTurns: 4, // retry-only: the submit call is the whole deliverable
			abortSignal: opts.signal,
			taskLabel: opts.taskLabel,
			onAssistantMessage: (message, step) =>
				opts.onStep(
					message.usage,
					// pi reports the bare model id; usage stamps carry provider:id.
					`${message.provider}:${message.model}`,
					step,
					message.stopReason,
					message.content.filter((c) => c.type === "toolCall").map((c) => (c as { name: string }).name).join(", ") || "(none)",
				),
			shouldStop: (_message, toolResults) => toolResults.some((r) => r.toolName === opts.toolName && !r.isError),
		},
	);
	void result;
	if (!submitted) throw new Error(opts.neverSubmitted);
	return submitted;
}
