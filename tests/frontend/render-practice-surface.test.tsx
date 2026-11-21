/**
 * THE PRACTICE SURFACE — SSR render pins (the render-suite discipline:
 * pure bodies, renderToStaticMarkup, testids). The open problem pane (the
 * whole statement, the learner works in the lesson's message box), the
 * transcript cards (the problem's statement — commitment NEVER renders;
 * the conclusion's outcome + verdict + reveal; old saved thinking cards),
 * and the view projection (old thinking records' data part).
 */

import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";

import { OpenProblemPane } from "../../src/frontend/components/lesson/open-problem-pane.tsx";
import { ConcludeCard, ProblemCard, ThinkingCard } from "../../src/frontend/components/practice-cards.tsx";
import { ChatActionsContext } from "../../src/frontend/components/chat-actions-context.ts";
import { projectView } from "../../src/shared/core/view.ts";
import type { ArtifactPartProps } from "../../src/shared/core";
import { PRACTICE_PROBLEM_TOOL, type LhMessage } from "../../src/shared/core/native-messages.ts";
import { oldThinkingMessage } from "../old-records.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

/** Mounts a node, runs the checks against it, and cleans up. */
async function mounted(node: React.ReactNode, run: (host: HTMLElement) => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(node));
		await run(host);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const part = (over: Partial<ArtifactPartProps["part"]>): ArtifactPartProps["part"] => ({
	type: "tool-problem",
	state: "input-available",
	toolCallId: "call_p1",
	...over,
});

// ── the open problem pane ────────────────────────────────────────────────────

const pane = (over: Partial<React.ComponentProps<typeof OpenProblemPane>> = {}) =>
	renderToStaticMarkup(<OpenProblemPane statement="Show that the sum is even." part={null} picks={null} {...over} />);

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
	it("ProblemCard: ALWAYS OPEN, the statement alone with no label above it — the commitment NEVER renders", () => {
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
		assert.doesNotMatch(html, />Problem</, "nothing small above the statement's own title");
		assert.match(html, /data-testid="problem-card"[^>]*><div[^>]*style="[^"]*--lh-prose-size:16px[\s\S]*Prove the parity claim\./, "the statement comes first");
		assert.doesNotMatch(html, /Pair them\./, "the commitment stays hidden");
		// No chevron, no collapsed bar.
		assert.doesNotMatch(html, /<button/, "nothing collapsible");
	});

	it("ProblemCard: a problem with choices keeps them in the record as lettered rows", () => {
		const input = { statement: "Which hold?", options: [{ label: "first claim" }, { label: "second claim" }], multiSelect: true };
		const html = renderToStaticMarkup(<ProblemCard part={part({ input })} />);
		assert.match(html, /data-testid="problem-card-choices"[\s\S]*>A<[\s\S]*first claim[\s\S]*>B<[\s\S]*second claim/);
		assert.doesNotMatch(renderToStaticMarkup(<ProblemCard part={part({ input: { statement: "Plain." } })} />), /problem-card-choices/);
	});

	it("ProblemCard: draws nothing while its problem is open (Your turn shows it), and again once it is not", () => {
		const card = (inTurn: string | null) =>
			renderToStaticMarkup(
				<ChatActionsContext.Provider value={{ chatId: "c1", sendBlocked: null, sendText: () => {}, dropKept: () => {}, inTurn }}>
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
		assert.ok(!html.includes("Concluded"), "the outcome says how it ended, once");
		// The outcome is the answered card's small chip, at the start of the head row, never a bar across the card.
		assert.match(html, /data-testid="conclude-card"[^>]*><div class="flex flex-wrap items-center gap-2\.5"><span data-testid="conclude-outcome" class="inline-block shrink-0 rounded-sm px-\[9px\] py-0\.5 text-sm font-medium [^"]*">Solved with hints<\/span>/);
		assert.match(html, /Model solution/); // the labeled hero
		assert.ok(html.indexOf("Solved") < html.indexOf("Model solution"), "chip at the top");
		assert.match(html, /The pairing came after R2\./);
		// VERDICT FIRST: verdict under the heading row, then
		// the divider, then the labeled model solution.
		assert.ok(html.indexOf("The pairing came after R2.") < html.indexOf("Pair them; each pair is even."));
		assert.doesNotMatch(html, /<button/, "a solved problem's solution is open, with nothing to press");
	});

	it("ConcludeCard: moved on, the model solution starts folded behind Show solution, which opens it", async () => {
		const movedOn = <ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "movedOn", verdict: "Left for later." }, reveal: "Pair them; each pair is even." })} />;
		const html = renderToStaticMarkup(movedOn);
		assert.match(html, /data-testid="conclude-outcome"[^>]*>Moved on<\/span><button[^>]*data-testid="show-solution" aria-expanded="false"[^>]*>Show solution</);
		assert.match(html, /Left for later\./);
		assert.doesNotMatch(html, /Pair them|Model solution/, "folded");
		await mounted(movedOn, async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="show-solution"]')!.click());
			assert.match(host.querySelector('[data-testid="model-solution"]')!.textContent!, /Model solution[\s\S]*Pair them; each pair is even\./);
		});
		const none = renderToStaticMarkup(<ConcludeCard part={part({ type: "tool-conclude", input: { outcome: "movedOn", verdict: "v" } })} />);
		assert.doesNotMatch(none, /show-solution/, "no solution, no key");
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
