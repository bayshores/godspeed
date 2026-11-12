/**
 * THE PRACTICE SURFACE — SSR render pins (the render-suite discipline:
 * pure bodies, renderToStaticMarkup, testids). The open problem pane (the
 * whole statement, the learner works in the lesson's message box), the
 * transcript cards (the problem's statement — commitment NEVER renders;
 * the conclusion's outcome + verdict + reveal; old saved thinking cards),
 * and the view projection (old thinking records' data part).
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

import { OpenProblemPane } from "../../src/frontend/components/lesson/open-problem-pane.tsx";
import { ConcludeCard, ProblemCard, ThinkingCard } from "../../src/frontend/components/practice-cards.tsx";
import { GraphContextCard } from "../../src/frontend/components/graph-context-card.tsx";
import { newGraphContextMessage } from "../../src/shared/core/native-messages.ts";
import { projectView } from "../../src/shared/core/view.ts";
import type { ArtifactPartProps } from "../../src/shared/core";
import { PRACTICE_PROBLEM_TOOL, type LhMessage } from "../../src/shared/core/native-messages.ts";
import { oldThinkingMessage } from "../old-records.ts";

const part = (over: Partial<ArtifactPartProps["part"]>): ArtifactPartProps["part"] => ({
	type: "tool-problem",
	state: "input-available",
	toolCallId: "call_p1",
	...over,
});

// ── the open problem pane ────────────────────────────────────────────────────

const pane = (over: Partial<React.ComponentProps<typeof OpenProblemPane>> = {}) =>
	renderToStaticMarkup(<OpenProblemPane statement="Show that the sum is even." source={null} part={null} {...over} />);

describe("OpenProblemPane", () => {
	it("shows the whole statement and nothing to type into", () => {
		const html = pane();
		assert.match(html, /data-testid="problem-statement"[\s\S]*Show that the sum is even\./);
		assert.doesNotMatch(html, /problem-number/, "the statement names its own number");
		assert.doesNotMatch(html, /practice-thinking-field|practice-send|data-testid="math-box"/);
		assert.doesNotMatch(html, /discard-problem|stop-turn/, "the way out sits beside Your turn");
	});

	it("homework shows where the problem is in the file", () => {
		assert.ok(!pane().includes("problem-source"), "no source line for a practice problem");
		assert.match(pane({ source: "hw6.pdf, page 2" }), /data-testid="problem-source"[^>]*>hw6\.pdf, page 2</);
	});
});

// ── the transcript cards ─────────────────────────────────────────────────────

describe("the practice transcript cards", () => {
	it("ProblemCard: ALWAYS OPEN, the 'Problem' eyebrow + the statement — the commitment NEVER renders", () => {
		const html = renderToStaticMarkup(
			<ProblemCard
				part={part({
					input: {
						statement: "Prove the parity claim.",
						mode: "recall",
						modelSolution: "Pair them.",
					},
				})}
			/>,
		);
		assert.match(html, /data-testid="problem-card"/);
		assert.match(html, /data-problem-call="call_p1"/, "the dock's show the whole problem scrolls to it");
		assert.match(html, /Problem/);
		assert.match(html, /Prove the parity claim\./);
		assert.doesNotMatch(html, /Pair them\./, "the commitment stays hidden");
		// No chevron, no collapsed bar.
		assert.doesNotMatch(html, /<button/, "nothing collapsible");
	});

	it("ConcludeCard: the SOLUTION is the hero (the pose's modelSolution via part.reveal); the verdict rides below, low-key", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: { outcome: "solvedWithHints", verdict: "The pairing came after R2." },
					reveal: "Pair them; each pair is even.",
				})}
			/>,
		);
		assert.match(html, /data-testid="conclude-card"/);
		assert.match(html, /Solved with hints/);
		assert.match(html, /Pair them; each pair is even\./, "the committed solution, verbatim");
		assert.match(html, /Concluded/); // the plain eyebrow
		assert.match(html, /Solved/); // the outcome rides the quiz chip
		assert.match(html, /Model solution/); // the labeled hero after the divider
		assert.ok(html.indexOf("Solved") < html.indexOf("Model solution"), "chip at the top");
		assert.match(html, /The pairing came after R2\./);
		// VERDICT FIRST: verdict under the heading row, then
		// the divider, then the labeled model solution.
		assert.ok(html.indexOf("The pairing came after R2.") < html.indexOf("Pair them; each pair is even."));
		assert.doesNotMatch(html, /<button/, "nothing collapsible");
	});

	it("ConcludeCard: legacy records fall back to their own solutionReveal", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: { outcome: "solved", verdict: "Clean.", solutionReveal: "Pair them; each pair is even." },
				})}
			/>,
		);
		assert.match(html, /Pair them; each pair is even\./);
	});

	it("ConcludeCard: THE METADATA POPOVER — quiet trigger at the bottom, box hidden until clicked", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: { outcome: "solvedWithHints", verdict: "v", rung: "R2", missClass: "cue", retest: true },
					problemInput: { mode: "discrimination", target: ["n_abc"] },
					reveal: "The solution.",
				})}
			/>,
		);
		assert.ok(html.includes('data-testid="metadata-toggle"'), "the trigger row");
		assert.match(html, /Metadata/, "the label (CSS renders it mono-caps)");
		assert.ok(!html.includes('data-testid="metadata-box"'), "the info box is CLOSED until clicked — no rows in the markup");
		assert.ok(!html.includes("border-t \"/>"), "no separate divider — the trigger just sits at the bottom");
		// The open face (info-box rows at the model solution's 15px) is a
		// client useState fold — static render cannot click; the rows' data
		// shape is pinned by the view-join test in practice-record.
	});

	it("ConcludeCard: no metadata trigger when the calls filled nothing beyond the visible card", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "dismissed" } })} />,
		);
		assert.ok(!html.includes("metadata-"), "the dismissal line carries no trigger");
		const legacy = renderToStaticMarkup(
			<ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "solved" }, reveal: "s" })} />,
		);
		assert.ok(!legacy.includes("metadata-"), "empty problemInput + bare outcome: nothing to reveal");
	});

	it("ConcludeCard: the dismissal synthesis is one muted line — no reveal card", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "dismissed" } })} />,
		);
		assert.match(html, /Problem dismissed\./);
		assert.doesNotMatch(html, /The solution/);
	});

	it("ThinkingCard (old saved lessons): one label, right side, expanded arrival", () => {
		const trace = renderToStaticMarkup(<ThinkingCard data={{ problemCallId: "c", commit: false, text: "stuck at step two" }} />);
		assert.match(trace, /Your thinking/);
		// Transcript rows arrive expanded (clearly conveyed as sent), in a bordered card.
		assert.match(trace, /aria-expanded="true"/);
		assert.ok(trace.includes("stuck at step two"), "the text is visible on arrival");
		assert.ok(trace.includes("border-border"), "a bordered card");
		assert.ok(trace.includes("border-l-2"), "the quote's rail");
		const legacy = renderToStaticMarkup(<ThinkingCard data={{ problemCallId: "c", commit: true, text: "It is 42." }} />);
		assert.match(legacy, /Your thinking/);
		assert.doesNotMatch(legacy, /Your solution/);
	});
});

// ── the view projection ──────────────────────────────────────────────────────

describe("the practice view projection", () => {
	it("an old thinking record projects as a user-side data part (register in details)", () => {
		const marker = oldThinkingMessage("call_p1", "It is 42.");
		const view = projectView([marker as LhMessage]);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.role, "user");
		const dataPart = view[0]!.parts[0]!;
		assert.equal(dataPart.type, "data-practice-thinking");
		assert.deepEqual(dataPart.data, { problemCallId: "call_p1", text: "It is 42." });
	});

	it("the problem pose's ack keeps the part input-available (the dock's mount)", () => {
		// Pose call + ack result (details: null — the placeholder fork).
		const messages = [
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "call_p1", name: PRACTICE_PROBLEM_TOOL, arguments: { statement: "S." } }],
			},
			{
				id: "r1",
				role: "toolResult",
				toolCallId: "call_p1",
				toolName: PRACTICE_PROBLEM_TOOL,
				content: [{ type: "text", text: "Problem posed" }],
				details: null,
				isError: false,
			},
		] as unknown as LhMessage[];
		const view = projectView(messages);
		const toolPart = view[0]!.parts.find((p) => p.type === `tool-${PRACTICE_PROBLEM_TOOL}`)!;
		assert.equal(toolPart.state, "input-available");
	});
});

// ── the graph-context card (a session's map pick; collapsed by default) ─────

describe("GraphContextCard", () => {
	it("collapsed: counts only — the statements stay hidden until expanded", () => {
		const html = renderToStaticMarkup(
			<GraphContextCard data={{ propositions: [
				{ id: "n1", name: "Modus ponens", statement: "If P implies Q and P holds, Q holds." },
				{ id: "n2", name: "Soundness", statement: "A valid argument from true premises has a true conclusion." },
			], chains: ["Modus ponens → Soundness"] }} />,
		);
		assert.ok(html.includes('data-testid="graph-context-card"'));
		assert.ok(html.includes("2 facts"));
		assert.ok(html.includes("1 chain"));
		// minimal: the collapsed bar carries NO statement text
		assert.ok(!html.includes("If P implies Q"));
		assert.ok(!html.includes("graph-context-body"));
	});

	it("zero chains: the chain count stays out of the summary", () => {
		const html = renderToStaticMarkup(
			<GraphContextCard data={{ propositions: [{ id: "n1", name: "A", statement: "S." }], chains: [] }} />,
		);
		assert.ok(html.includes("1 fact</span>"));
		assert.ok(!html.includes("chain"));
	});

	it("the marker projects to the card's part (projectView fold)", () => {
		const view = projectView([newGraphContextMessage(
			[{ id: "n1", name: "A", statement: "S." }], [],
		) as unknown as LhMessage]);
		assert.equal((view[0]!.parts[0] as { type: string }).type, "data-graph-context");
	});
});
