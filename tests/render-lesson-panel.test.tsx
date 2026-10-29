/**
 * Lesson layout B (redesign, Phase 3): the plan step bar, the Your-turn
 * panel's states, the question panel's keys, the practice progress, and
 * the view's message reuse (Phase 7: only the streaming row redraws).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { YourTurnPanel } from "../src/components/lesson/your-turn-panel.tsx";
import { StepBar, answerBlockClass, jumpTarget, rightCountLabel } from "../src/components/lesson/step-bar.tsx";
import { practiceProgress } from "../src/components/lesson/practice-progress.ts";
import { QuestionDock } from "../src/components/question-dock.tsx";
import { CONFIDENCE_STOPS, projectView, reuseUnchangedMessages, type LhMessage, type PlanStepBar, type QuestionAnswerData } from "../src/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});
// linkedom has no layout: the walked row's scrollIntoView is a no-op here.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const quizInput = {
	question: "Which planet is closest to the sun?",
	options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
	correctAnswer: "Mercury",
	explanation: "Mercury is the innermost planet.",
};

const composer = (over: Partial<React.ComponentProps<typeof YourTurnPanel>["composer"]> = {}) => ({
	busy: false,
	value: "",
	onChange: () => {},
	onSend: () => {},
	onStop: () => {},
	canSend: false,
	queuedSteers: [],
	...over,
});

function panel(over: Partial<React.ComponentProps<typeof YourTurnPanel>> = {}) {
	return renderToStaticMarkup(
		<YourTurnPanel
			pending={null}
			requiresReveal={false}
			onSaveQuestionDraft={() => {}}
			onSubmitAnswer={() => {}}
			readingThinking=""
			onReadingThinking={() => {}}
			practice={null}
			practiceNumber={null}
			onSubmitThinking={() => {}}
			sessionBusy={false}
			compacting={false}
			composer={composer()}
			stats={null}
			{...over}
		/>,
	);
}

describe("the Your-turn panel's states", () => {
	it("no question waiting: the message box with Send", () => {
		const html = panel();
		assert.match(html, /data-mode="chat"/);
		assert.match(html, /data-testid="panel-eyebrow"[^>]*>Your turn</);
		assert.match(html, /placeholder="Message the teacher…"/);
		assert.match(html, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Send</, "Send waits for text");
		assert.ok(!html.includes("stop-turn"), "no Stop while idle");
	});

	it("while the teacher writes: Stop, the hint, and the gray Send when ready", () => {
		const html = panel({ composer: composer({ busy: true, value: "wait, why?", canSend: true }) });
		assert.match(html, /Teacher is writing…/);
		assert.match(html, /data-testid="stop-turn"[\s\S]*?Stop<\/button>/, "no key hint beside Stop");
		assert.match(html, /Sends when the teacher finishes\./);
		assert.match(html, /data-testid="composer-send"[^>]*class="[^"]*bg-tone-2[\s\S]*?Send when ready/);
	});

	it("queued messages and the notice slot sit in the panel", () => {
		const html = panel({
			composer: composer({ busy: true, queuedSteers: [{ id: "s1", text: "and the variance?" }], notice: <p data-testid="composer-notice">Waiting for your agent</p> }),
		});
		assert.match(html, /data-testid="queued-steers"[\s\S]*?and the variance\?/);
		assert.match(html, /data-testid="composer-notice"/);
	});

	it("a practice pause turns the bar into Next problem", () => {
		const html = panel({ composer: composer({ nextProblem: true }) });
		assert.match(html, /data-testid="next-problem-button"[\s\S]*?Next problem/);
	});

	it("a waiting question fills the panel", () => {
		const html = panel({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } });
		assert.match(html, /data-mode="question"/);
		assert.match(html, /data-testid="question-dock"/);
		assert.match(html, /Which planet is closest/);
		assert.match(html, /Submit answer/);
	});

	it("a teach-phase check waits behind Check your understanding, with the reading field", () => {
		const html = panel({ pending: { tool: "quiz", toolCallId: "t1", input: { ...quizInput, type: "check" } }, requiresReveal: true });
		assert.match(html, /data-mode="reveal"/);
		assert.match(html, /data-testid="teach-check-reveal"[\s\S]*?Check your understanding/);
		assert.match(html, /data-testid="reading-thinking-field"/);
		assert.ok(!html.includes("Which planet is closest"), "the question stays hidden until opened");
		assert.ok(!html.includes('data-testid="question-dock"'));
	});

	it("an active practice problem fills the panel with its number", () => {
		const html = panel({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } }, practiceNumber: 3 });
		assert.match(html, /data-mode="practice"/);
		assert.match(html, /Problem 3/);
		assert.match(html, /Find E\[N\]\./);
	});
});

// ─── the plan step bar ───────────────────────────────────────────────────────

const bar: PlanStepBar = {
	currentIndex: 1,
	steps: [
		{ id: "a", title: "The update rule", status: "visited", answers: [{ toolCallId: "c1", outcome: "right" }, { toolCallId: "c2", outcome: "wrong", level: 4 }] },
		{ id: "b", title: "Gradient as an expectation", status: "current", answers: [] },
		{ id: "c", title: "Variance", status: "upcoming", answers: [] },
	],
};

describe("the plan step bar", () => {
	it("one block per step, the count and the current step's name", () => {
		const html = renderToStaticMarkup(<StepBar bar={bar} onJump={() => {}} onOpenPlan={() => {}} />);
		const statuses = [...html.matchAll(/data-testid="plan-step" data-status="(\w+)"/g)].map((m) => m[1]);
		assert.deepEqual(statuses, ["visited", "current", "upcoming"]);
		assert.match(html, /data-testid="plan-step-count"[^>]*>2 \/ 3</);
		assert.match(html, /Gradient as an expectation/);
		assert.match(html, /data-testid="plan-step-open"/, "the chevron opens the plan map");
		// The current step is the wide white block.
		assert.match(html, /data-status="current"[\s\S]*?w-\[22px\] bg-ink/);
	});

	it("tooltip data: answers as colored blocks and 'n of m right'", () => {
		assert.equal(rightCountLabel(bar.steps[0]!.answers), "1 of 2 right");
		assert.equal(rightCountLabel([]), null);
		assert.equal(rightCountLabel([{ toolCallId: "e", outcome: "ungraded" }]), null, "explain answers are not graded");
		assert.equal(answerBlockClass({ toolCallId: "x", outcome: "right" }), "bg-ans-right");
		assert.equal(answerBlockClass({ toolCallId: "x", outcome: "dontKnow" }), "bg-ans-dontknow");
	});

	it("only a done step with an answer jumps back", () => {
		assert.equal(jumpTarget(bar.steps[0]!), "c1");
		assert.equal(jumpTarget(bar.steps[1]!), null, "the current step does not jump");
		assert.equal(jumpTarget({ ...bar.steps[0]!, answers: [] }), null);
	});

	it("clicking a done step calls the jump with its first answer", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const jumps: string[] = [];
		try {
			await act(async () => root.render(<StepBar bar={bar} onJump={(id) => jumps.push(id)} onOpenPlan={() => {}} />));
			const steps = host.querySelectorAll<HTMLButtonElement>('[data-testid="plan-step"]');
			await act(async () => steps[0]!.click());
			await act(async () => steps[2]!.click());
			assert.deepEqual(jumps, ["c1"], "done step jumps; upcoming does nothing");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

// ─── the question panel's keys ───────────────────────────────────────────────

function press(key: string) {
	const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.defineProperty(e, "key", { value: key });
	document.dispatchEvent(e);
}

describe("the question panel's keys", () => {
	it("number keys pick options, 0 is I don't know, ←/→ move confidence, Enter submits", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		let answer: QuestionAnswerData | undefined;
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="keys1" input={quizInput} onSubmit={(a) => (answer = a)} />));
			const rows = () => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="question-option"]')];
			await act(async () => press("2"));
			assert.equal(rows()[1]!.getAttribute("aria-checked"), "true", "2 picks the second row");
			await act(async () => press("0"));
			assert.equal(host.querySelector('[data-testid="dont-know-option"]')!.getAttribute("aria-pressed"), "true", "0 = I don't know");
			assert.ok(rows().every((r) => r.getAttribute("aria-checked") === "false"), "I don't know clears the pick");
			await act(async () => press("1"));
			assert.equal(rows()[0]!.getAttribute("aria-checked"), "true");
			await act(async () => press("9"));
			assert.equal(rows()[0]!.getAttribute("aria-checked"), "true", "a key past the options does nothing");
			await act(async () => press("ArrowRight"));
			assert.match(host.querySelector('[data-testid="confidence-value"]')!.textContent ?? "", /^4 · Fairly sure$/);
			await act(async () => press("Enter"));
			assert.ok(answer, "Enter submits");
			assert.equal(answer!.confidence, CONFIDENCE_STOPS[3], "level 4 is saved as 80%");
			assert.equal(answer!.answers[0]!.label, rows()[0]!.textContent?.replace(/^1/, ""));
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("clicking a confidence bar sets the level", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="keys2" input={quizInput} onSubmit={() => {}} />));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confidence-level-5"]')!.click());
			assert.equal(host.querySelector('[data-testid="confidence-value"]')!.textContent, "5 · Certain");
			assert.equal(host.querySelector('[data-testid="confidence-level-5"]')!.getAttribute("aria-checked"), "true");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

// ─── practice progress ───────────────────────────────────────────────────────

describe("practiceProgress", () => {
	const msg = (...parts: Array<{ type: string; state?: string; input?: unknown }>) => ({ parts });
	it("counts finished problems, solved ones, and the active one", () => {
		const messages = [
			msg({ type: "tool-problem", state: "input-available" }, { type: "tool-conclude", state: "output-available", input: { outcome: "solved" } }),
			msg({ type: "tool-problem", state: "input-available" }, { type: "tool-conclude", state: "output-available", input: { outcome: "surrendered" } }),
			msg({ type: "tool-problem", state: "input-available" }, { type: "tool-conclude", state: "output-available", input: { outcome: "solvedWithHints" } }),
			msg({ type: "tool-problem", state: "input-available" }),
		];
		const p = practiceProgress(messages, true);
		assert.deepEqual(p.blocks, ["solved", "missed", "solved", "current"]);
		assert.equal(p.solved, 2);
		assert.equal(p.finished, 3);
		assert.equal(p.currentNumber, 4);
	});

	it("errored calls never count; no active problem means no current block", () => {
		const p = practiceProgress([msg({ type: "tool-problem", state: "output-error" }), msg({ type: "tool-conclude", input: { outcome: "solved" } })], false);
		assert.deepEqual(p.blocks, []);
		assert.equal(p.currentNumber, null);
	});
});

// ─── message reuse (only the streaming row redraws) ──────────────────────────

describe("reuseUnchangedMessages", () => {
	const usage = { input: 0, output: 0, total: 0, cacheReads: 0, cacheWrites: 0 };
	const a = (id: string, text: string) =>
		({ id, role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage, provider: "x", model: "x", timestamp: 0 }) as unknown as LhMessage;
	const u = (id: string, text: string) => ({ id, role: "user", content: text, timestamp: 0 }) as unknown as LhMessage;

	it("keeps unchanged message objects and replaces only the changed one", () => {
		const record = [u("u1", "hi"), a("a1", "first"), u("u2", "more"), a("a2", "stream")];
		const prev = projectView(record);
		const next = projectView([...record.slice(0, 3), a("a2", "streaming more")]);
		const out = reuseUnchangedMessages(prev, next);
		assert.equal(out[0], prev[0]);
		assert.equal(out[1], prev[1]);
		assert.equal(out[2], prev[2]);
		assert.notEqual(out[3], prev[3]);
		assert.equal(out[3]!.parts.at(-1)!.text, "streaming more");
	});

	it("returns the previous list itself when nothing changed", () => {
		const record = [u("u1", "hi"), a("a1", "first")];
		const prev = projectView(record);
		assert.equal(reuseUnchangedMessages(prev, projectView(record)), prev);
	});

	it("a message that gains a part is new; an appended message keeps the rest", () => {
		const prev = projectView([u("u1", "hi"), a("a1", "first")]);
		const next = projectView([u("u1", "hi"), a("a1", "first"), a("a2", "second")]);
		const out = reuseUnchangedMessages(prev, next);
		assert.equal(out[0], prev[0]);
		assert.notEqual(out[1], prev[1], "a2 joined a1's group: the group changed");
		assert.equal(out.length, 2);
	});
});
