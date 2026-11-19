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
import { ChatActionsContext } from "../../src/frontend/components/chat-actions-context.ts";
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
	renderToStaticMarkup(<OpenProblemPane statement="Show that the sum is even." part={null} {...over} />);

describe("OpenProblemPane", () => {
	it("shows the whole statement and nothing to type into", () => {
		const html = pane();
		assert.match(html, /data-testid="problem-statement"[\s\S]*Show that the sum is even\./);
		assert.doesNotMatch(html, /problem-number/, "the statement names its own number");
		assert.doesNotMatch(html, /practice-thinking-field|practice-send|data-testid="math-box"/);
		assert.doesNotMatch(html, /discard-problem|stop-turn/, "the way out sits beside Your turn");
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

	it("ProblemCard: draws nothing while its problem is open (Your turn shows it), and again once it is not", () => {
		const card = (openProblem: string | null) =>
			renderToStaticMarkup(
				<ChatActionsContext.Provider value={{ chatId: "c1", sendBlocked: null, sendText: () => {}, dropKept: () => {}, openProblem }}>
					<ProblemCard part={part({ input: { statement: "Prove the parity claim." } })} />
				</ChatActionsContext.Provider>,
			);
		assert.equal(card("call_p1"), "");
		assert.match(card("call_p2"), /Prove the parity claim\./, "another problem is open");
		assert.match(card(null), /Prove the parity claim\./, "no problem is open");
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

	it("ConcludeCard: no Metadata button; the agent's fields stay out of the learner's card", () => {
		const html = renderToStaticMarkup(
			<ConcludeCard
				part={part({
					type: "tool-conclude",
					input: { outcome: "solvedWithHints", verdict: "v", rung: "R2", missClass: "cue", retest: true },
					reveal: "The solution.",
				})}
			/>,
		);
		assert.match(html, /The solution\./);
		assert.doesNotMatch(html, /metadata-|Metadata|R2|cue/);
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
		// Transcript rows arrive expanded (clearly conveyed as sent), in a card.
		assert.match(trace, /aria-expanded="true"/);
		assert.ok(trace.includes("stuck at step two"), "the text is visible on arrival");
		assert.ok(trace.includes("lh-well"), "a card");
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

// ── the graph-context marker (a session's map pick) ─────────────────────────

describe("graph-context marker", () => {
	it("projects to a data part the view keeps (no card draws it)", () => {
		const marker = { id: "g1", role: "custom", customType: "graph-context", content: "", display: true, details: { propositions: [{ id: "n1", name: "A", statement: "S." }], chains: [] }, timestamp: 1 };
		const view = projectView([marker as unknown as LhMessage]);
		assert.equal((view[0]!.parts[0] as { type: string }).type, "data-graph-context");
	});
});
