/**
 * Lesson layout B: the plan step bar, the Your-turn
 * panel's states, the question panel's keys, the practice progress, and
 * the view's message reuse.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { runScopeHandlers, type EditorView } from "@codemirror/view";
import { mathBoxView, stubCodeMirrorDom } from "../math-box-dom.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { YourTurnPanel, fitPanelWidth } from "../../src/frontend/components/lesson/your-turn-panel.tsx";
import { LessonBox } from "../../src/frontend/components/lesson/lesson-box.tsx";
import { StepsPane, jumpTarget, rightCountLabel } from "../../src/frontend/components/lesson/steps-pane.tsx";
import { ProblemsPane } from "../../src/frontend/components/lesson/problems-pane.tsx";
import { practiceProgress } from "../../src/frontend/components/lesson/practice-progress.ts";
import { QuestionDock } from "../../src/frontend/components/question-dock.tsx";
import { PracticeDock } from "../../src/frontend/components/practice-dock.tsx";
import { ReadingPane } from "../../src/frontend/components/lesson/reading-pane.tsx";
import { CONFIDENCE_STOPS, projectView, reuseUnchangedMessages, type LhMessage, type PlanStepBar, type QuestionAnswerData, type QuestionFormDraft } from "../../src/shared/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});
stubCodeMirrorDom(dom);
// linkedom has no layout: the walked row's scrollIntoView is a no-op here.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const quizInput = {
	question: "Which planet is closest to the sun?",
	options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
	correctAnswer: "Mercury",
	explanation: "Mercury is the innermost planet.",
};

const attachments = (over: Partial<React.ComponentProps<typeof LessonBox>["attachments"]> = {}) => ({
	files: [],
	error: null,
	add: () => {},
	remove: () => {},
	clear: () => {},
	restore: () => {},
	...over,
});

function lessonBox(over: Partial<React.ComponentProps<typeof LessonBox>> = {}) {
	return (
		<LessonBox
			busy={false}
			value=""
			onChange={() => {}}
			onSend={() => {}}
			onStop={() => {}}
			canSend={false}
			showStop
			sideOpen={null}
			nextReady={false}
			onNext={() => {}}
			queuedSteers={[]}
			attachments={attachments()}
			{...over}
		/>
	);
}

function panel(over: Partial<React.ComponentProps<typeof YourTurnPanel>> = {}) {
	return renderToStaticMarkup(
		<YourTurnPanel
			pending={null}
			requiresReveal={false}
			onSaveQuestionDraft={() => {}}
			onSubmitAnswer={async () => true}
			onSkipQuestion={() => {}}
			readingThinking=""
			onReadingThinking={() => {}}
			practice={null}
			onSavePracticeDraft={() => {}}
			onSubmitThinking={async () => true}
			onDiscardProblem={() => {}}
			busy={false}
			waitingForAgent={false}
			onNext={() => {}}
			compacting={false}
			stats={null}
			{...over}
		/>,
	);
}

describe("the Your-turn panel's states", () => {
	it("no question waiting: nothing to answer, and no box in the panel", () => {
		const html = panel();
		assert.match(html, /data-mode="chat"/);
		assert.ok(!html.includes("panel-status"), "no header while it is simply the learner's turn");
		assert.match(html, /data-testid="nothing-to-answer"[^>]*>Nothing to answer right now\.</);
		assert.ok(!html.includes('data-testid="composer"'), "the box lives under the reading pane");
		assert.ok(!html.includes("stop-turn"), "no Stop while idle");
	});

	it("while the teacher writes, the header says so", () => {
		const html = panel({ busy: true });
		assert.match(html, /data-testid="panel-status"[^>]*>Teacher is writing…</);
		assert.ok(!html.includes("nothing-to-answer"));
	});

	it("a practice pause shows Next problem as the panel's action", () => {
		const html = panel({ next: "Next problem" });
		assert.match(html, /data-testid="next-problem-button"[\s\S]*?Next problem/);
	});

	it("a study session's pause says Continue, since the next topic may be taught first", () => {
		const html = panel({ next: "Continue" });
		assert.match(html, /data-testid="next-problem-button"[\s\S]*?>Continue</);
		assert.ok(!html.includes("Next problem<"));
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

	it("shows no small labels over the question panel's boxes, which keep their accessible names", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const render = (over: Partial<React.ComponentProps<typeof YourTurnPanel>>) => (
			<YourTurnPanel
				pending={null}
				requiresReveal={false}
				onSaveQuestionDraft={() => {}}
				onSubmitAnswer={async () => true}
				onSkipQuestion={() => {}}
				readingThinking=""
				onReadingThinking={() => {}}
				practice={null}
				onSavePracticeDraft={() => {}}
				onSubmitThinking={async () => true}
				onDiscardProblem={() => {}}
				busy={false}
				waitingForAgent={false}
				onNext={() => {}}
				compacting={false}
				stats={null}
				{...over}
			/>
		);
		try {
			await act(async () => root.render(render({ pending: { tool: "quiz", toolCallId: "t1", input: { ...quizInput, type: "check" } }, requiresReveal: true })));
			await mathBoxView(host, "Thinking while reading");
			const shown = host.textContent ?? "";
			assert.ok(!shown.includes("Your turn"), "no Your turn header");
			assert.ok(!shown.includes("Thinking while reading"), "the box's placeholder says it");
			await act(async () => root.render(render({ pending: { tool: "quiz", toolCallId: "q2", input: quizInput } })));
			await mathBoxView(host, "Your thinking");
			assert.ok(!(host.textContent ?? "").includes("Your thinking"), "no label over the thinking box");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("an active practice problem fills the panel; the statement names its own number", () => {
		const html = panel({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } } });
		assert.match(html, /data-mode="practice"/);
		assert.doesNotMatch(html, /problem-number/);
		assert.match(html, /Find E\[N\]\./);
	});

	it("a homework problem names itself in the pane, says where it is and asks to check the work", () => {
		const html = panel({ practice: { toolCallId: "p1", input: { number: "3", statement: "Find α." } }, homeworkProblem: { label: "Q3", source: "from hw4.pdf, page 2" } });
		assert.match(html, /your turn: q3/);
		assert.match(html, /from hw4\.pdf, page 2/);
		assert.match(html, /check my work/);
	});

	it("a homework lesson's problems pane: done bar, ticks and the open problem", () => {
		const problems = [
			{ number: "1", title: "Gradient", text: "…", done: true },
			{ number: "2", title: "Step size", text: "…", done: false },
			{ number: "3", title: "Momentum", text: "…", done: false },
		];
		const html = renderToStaticMarkup(<ProblemsPane name="HW 4" problems={problems} open="2" />);
		assert.match(html, /hw 4/);
		assert.match(html, /1 of 3 done/);
		assert.deepEqual([...html.matchAll(/data-status="(\w+)"/g)].map((m) => m[1]), ["done", "current", "upcoming"]);
		assert.match(html, />Q2</);
		assert.match(renderToStaticMarkup(<ProblemsPane name="HW 4" problems={[]} open={null} />), /reading the assignment/);
	});

	it("mouse-first: no action bar shows a key label", () => {
		for (const html of [
			panel({ next: "Next problem" }),
			panel({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } }),
			panel({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } } }),
		]) {
			assert.ok(!html.includes("Enter"), "no Enter label");
		}
	});

	it("a waiting question, a check behind its reveal and a code question each show Skip question", () => {
		const skip = /data-testid="skip-question"[^>]*>Skip question</;
		assert.match(panel({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } }), skip);
		assert.match(panel({ pending: { tool: "quiz", toolCallId: "t1", input: { ...quizInput, type: "check" } }, requiresReveal: true }), skip);
		assert.match(panel({ pending: { tool: "write_code", toolCallId: "w1", input: { question: "Write add.", language: "python" } } }), skip);
	});

	it("an active problem shows Discard problem", () => {
		const html = panel({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } } });
		assert.match(html, /data-testid="discard-problem"[^>]*>Discard problem</);
	});

	it("Skip question and Discard problem open their confirms", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const asked: string[] = [];
		const render = (over: Partial<React.ComponentProps<typeof YourTurnPanel>>) => (
			<YourTurnPanel
				pending={null}
				requiresReveal={false}
				onSaveQuestionDraft={() => {}}
				onSubmitAnswer={async () => true}
				onSkipQuestion={() => asked.push("question")}
				readingThinking=""
				onReadingThinking={() => {}}
				practice={null}
				onSavePracticeDraft={() => {}}
				onSubmitThinking={async () => true}
				onDiscardProblem={() => asked.push("problem")}
								busy={false}
								waitingForAgent={false}
								onNext={() => {}}
								compacting={false}
				stats={null}
				{...over}
			/>
		);
		try {
			await act(async () => root.render(render({ pending: { tool: "quiz", toolCallId: "q1", input: quizInput } })));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="skip-question"]')!.click());
			await act(async () => root.render(render({ practice: { toolCallId: "p1", input: { statement: "Find E[N]." } } })));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="discard-problem"]')!.click());
			assert.deepEqual(asked, ["question", "problem"]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("while the turn waits for an agent the header says so instead of Teacher is writing", () => {
		const html = panel({ busy: true, waitingForAgent: true });
		assert.match(html, /data-testid="panel-status"[^>]*>Waiting for your agent</);
		assert.ok(!html.includes("Teacher is writing"));
	});

	it("a problem's dock holds Stop only when the panel is given one", () => {
		const problem = { practice: { toolCallId: "p1", input: { statement: "Find E[N]." } }, busy: true };
		assert.equal(panel({ ...problem, onStop: () => {} }).split('data-testid="stop-turn"').length - 1, 1);
		assert.ok(!panel(problem).includes('data-testid="stop-turn"'), "a side reply's Stop is in the lesson box");
	});
});

describe("the lesson box", () => {
	const enter = (view: EditorView, shiftKey = false) =>
		runScopeHandlers(view, { key: "Enter", keyCode: 13, shiftKey, metaKey: false, ctrlKey: false, altKey: false } as KeyboardEvent, "editor");
	const html = (over: Partial<React.ComponentProps<typeof LessonBox>> = {}) => renderToStaticMarkup(lessonBox(over));

	it("idle: the writing box with a disabled Send, no Stop, no side note", () => {
		const out = html();
		assert.match(out, /data-testid="composer"[\s\S]*data-testid="math-box"[\s\S]*>Message the teacher…</, "the writing box, where math formats as you type");
		assert.match(out, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Send</, "Send waits for text");
		assert.ok(!out.includes("stop-turn"));
		assert.ok(!out.includes("side-question-note"));
	});

	it("with a question or problem open it says it stays open", () => {
		assert.match(html({ sideOpen: "question" }), /data-testid="side-question-note"[^>]*>Your question stays open while you ask\.</);
		assert.match(html({ sideOpen: "problem" }), />Your problem stays open while you ask\.</);
	});

	it("while the teacher writes: Stop on an empty box, the gray Send when ready with text", () => {
		assert.match(html({ busy: true }), /data-testid="stop-turn"/);
		const typed = html({ busy: true, value: "wait, why?", canSend: true });
		assert.ok(!typed.includes("stop-turn"));
		assert.match(typed, /data-testid="composer-send"[^>]*class="lh-btn ml-auto shrink-0"[\s\S]*?Send when ready/);
		assert.ok(!html({ busy: true, showStop: false }).includes("stop-turn"), "a problem's dock holds Stop instead");
	});

	it("queued messages and the notice sit above the box", () => {
		const out = html({ busy: true, queuedSteers: [{ id: "s1", text: "and the variance?" }], notice: <p data-testid="composer-notice">Stuck</p> });
		assert.match(out, /data-testid="composer-notice"[\s\S]*data-testid="queued-steers"[\s\S]*?and the variance\?[\s\S]*data-testid="math-box"/);
	});

	it("takes pictures and PDFs: the button beside the field, the tray above it", () => {
		const files = attachments({
			files: [
				{ id: "f1", attachment: { name: "graph.png", mimeType: "image/png", data: "iVBORw0KGgo=" } },
				{ id: "f2", attachment: { name: "notes.pdf", mimeType: "application/pdf", data: "JVBERi0=" } },
			],
		});
		const out = html({ attachments: files, canSend: true, sideOpen: "question" });
		assert.match(out, /data-testid="attachment-tray"[\s\S]*data-testid="draft-image"[\s\S]*data-testid="draft-pdf"[\s\S]*data-testid="math-box"/);
		assert.match(out, /data-testid="attach-button"[\s\S]*data-testid="math-box"[\s\S]*data-testid="composer-send"/);
		assert.match(out, /type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp,application\/pdf"/);
		assert.doesNotMatch(out, /data-testid="composer-send"[^>]*disabled=""/, "files alone can be sent");
		const refused = html({ attachments: attachments({ error: "You can add up to 5 files to one message." }) });
		assert.match(refused, /data-testid="attachment-error"[^>]*>You can add up to 5 files to one message\.</);
	});

	it("mouse-first: no key hint and no em-dash", () => {
		for (const out of [html(), html({ sideOpen: "question" }), html({ busy: true })]) assert.ok(!out.includes("Enter") && !out.includes("—"));
	});

	it("typing reaches the lesson, Enter sends, Shift+Enter is a newline; an empty Enter in the pause asks for the next problem", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const typed: string[] = [];
		let sent = 0;
		let next = 0;
		try {
			await act(async () => root.render(lessonBox({ value: "x^2", canSend: true, onChange: (v) => typed.push(v), onSend: () => sent++ })));
			const view = await mathBoxView(host, "Message the teacher");
			await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: "+1" } }));
			assert.deepEqual(typed, ["x^2+1"]);
			await act(async () => void enter(view, true));
			assert.equal(sent, 0);
			await act(async () => void enter(view));
			assert.equal(sent, 1);
			await act(async () => root.render(lessonBox({ nextReady: true, onNext: () => next++ })));
			await act(async () => void enter(await mathBoxView(host, "Message the teacher")));
			assert.equal(next, 1);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("Stop stops the running turn", async () => {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		let stopped = 0;
		try {
			await act(async () => root.render(lessonBox({ busy: true, sideOpen: "question", onStop: () => stopped++ })));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="stop-turn"]')!.click());
			assert.equal(stopped, 1);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("saved drafts in the panel", () => {
	it("a practice problem starts from its saved thinking", () => {
		const html = renderToStaticMarkup(<PracticeDock problemCallId="p1" input={{ statement: "Find E[N]." }} onSubmit={async () => true} initialDraft="half done" />);
		assert.match(html, /data-testid="math-box"[^]*>half done</);
	});

	it("a practice send clears the saved draft, and a refused one puts it back", async () => {
		for (const taken of [true, false]) {
			const host = document.createElement("div");
			document.body.append(host);
			const root = createRoot(host);
			const saved: string[] = [];
			try {
				await act(async () =>
					root.render(
						<PracticeDock problemCallId="p1" input={{ statement: "Find E[N]." }} onSubmit={async () => taken} initialDraft="half done" onSaveDraft={(t) => saved.push(t)} />,
					),
				);
				await act(async () => press("Enter"));
				assert.deepEqual(saved, taken ? [""] : ["", "half done"]);
			} finally {
				await act(async () => root.unmount());
				host.remove();
			}
		}
	});

	it("a question form starts from the saved draft and saves every change", async () => {
		const draft: QuestionFormDraft = { selection: { selected: new Set([0]), otherSelected: false, dontKnow: false }, thinking: "because", other: "", text: "" };
		assert.match(
			renderToStaticMarkup(<QuestionDock toolName="quiz" toolCallId="q1" input={quizInput} onSubmit={async () => true} initialDraft={draft} />),
			/data-testid="math-box"[^]*>because</,
		);
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const saved: QuestionFormDraft[] = [];
		try {
			await act(async () =>
				root.render(<QuestionDock toolName="quiz" toolCallId="q1" input={quizInput} onSubmit={async () => true} initialDraft={draft} onSaveDraft={(d) => saved.push(d)} />),
			);
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dont-know-option"]')!.click());
			assert.equal(saved.at(-1)!.selection.dontKnow, true);
			assert.equal(saved.at(-1)!.thinking, "because");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("the reading pane's waiting and error states", () => {
	const pane = (over: Partial<React.ComponentProps<typeof ReadingPane>> = {}) =>
		renderToStaticMarkup(
			<ReadingPane
				messages={[]}
				phases={[]}
				status="submitted"
				busy
				turnInFlight={false}
				compacting={false}
				waitingForAgent={false}
				error={null}
				onRetry={() => {}}
				arrivalsLive={false}
				arrive={() => undefined}
				onOpenPlan={() => {}}
				scrollContextRef={{ current: null }}
				{...over}
			/>,
		);

	it("Thinking… while the agent works", () => {
		const html = pane();
		assert.match(html, /Thinking…/);
		assert.ok(!html.includes("lesson-waiting"));
	});

	it("one waiting state, with how to connect and the Connection settings button, while no agent takes the turn", () => {
		const html = pane({ waitingForAgent: true });
		assert.ok(!html.includes("Thinking…"), "no shimmer while nothing works");
		assert.match(html, /data-testid="lesson-waiting"[^>]*>Waiting for your agent</);
		assert.match(html, /Open your agent from the sidebar\./);
		assert.match(html, /data-testid="lesson-waiting-settings"[^>]*>Open Connection settings</);
	});

	it("an error reads as a plain sentence with Try again; the raw text is the hover tip", () => {
		const html = pane({ busy: false, status: "error", error: { message: "The send failed (500)." } });
		assert.match(html, /data-testid="lesson-error" title="The send failed \(500\)\.">Your message didn&#x27;t go through\.</);
		assert.match(html, /data-testid="lesson-error-retry"[^>]*>Try again</);
		assert.ok(!html.includes("Something went wrong"));
	});

	it("an empty lesson says it is new, with no promise of a probe", () => {
		const html = pane({ busy: false, status: "ready" });
		assert.match(html, />New lesson</);
		assert.doesNotMatch(html, /see what you already know/);
	});
});

// ─── the steps pane ───────────────────────────────────────────────────────

const bar: PlanStepBar = {
	currentIndex: 1,
	steps: [
		{ id: "a", title: "The update rule", status: "visited", answers: [{ toolCallId: "c1", outcome: "right" }, { toolCallId: "c2", outcome: "wrong", level: 4 }] },
		{ id: "b", title: "Gradient as an expectation", status: "current", answers: [] },
		{ id: "c", title: "Variance", status: "upcoming", answers: [] },
	],
};

describe("the Your-turn panel's width", () => {
	it("keeps its saved width when there's room, and narrows so the text keeps 420px", () => {
		assert.equal(fitPanelWidth(440, null), 440, "before the lesson area is measured");
		assert.equal(fitPanelWidth(440, 1200), 440);
		assert.equal(fitPanelWidth(720, 1000), 580, "a docked cheat sheet narrows a wide panel");
		assert.equal(fitPanelWidth(720, 700), 340, "never below the panel's minimum");
	});
});

describe("the steps pane", () => {
	it("every step in order, ticked, current or upcoming, with the position in its name", () => {
		const html = renderToStaticMarkup(<StepsPane bar={bar} onJump={() => {}} onOpenPlan={() => {}} />);
		const statuses = [...html.matchAll(/data-testid="plan-step" data-status="(\w+)"/g)].map((m) => m[1]);
		assert.deepEqual(statuses, ["visited", "current", "upcoming"]);
		assert.match(html, /data-testid="plan-step-count"[^>]*>2 of 3</);
		assert.match(html, /font-bold text-ink"[^>]*>Gradient as an expectation</);
		assert.match(html, />1 of 2 right</, "a done step says how its answers went");
		assert.match(html, /data-testid="plan-step-open"[^>]*>plan map</);
	});

	it("'n of m right' counts graded answers only", () => {
		assert.equal(rightCountLabel(bar.steps[0]!.answers), "1 of 2 right");
		assert.equal(rightCountLabel([]), null);
		assert.equal(rightCountLabel([{ toolCallId: "e", outcome: "ungraded" }]), null, "explain answers are not graded");
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
			await act(async () => root.render(<StepsPane bar={bar} onJump={(id) => jumps.push(id)} onOpenPlan={() => {}} />));
			const buttons = host.querySelectorAll<HTMLButtonElement>('[data-testid="plan-step"] button');
			assert.equal(buttons.length, 1, "only the done step is a button");
			await act(async () => buttons[0]!.click());
			assert.deepEqual(jumps, ["c1"]);
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
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="keys1" input={quizInput} onSubmit={async (a) => ((answer = a), true)} />));
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
			assert.match(host.querySelector('[data-testid="confidence-value"]')!.textContent ?? "", /^how sure\? fairly sure$/);
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
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="keys2" input={quizInput} onSubmit={async () => true} />));
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confidence-level-5"]')!.click());
			assert.equal(host.querySelector('[data-testid="confidence-value"]')!.textContent, "how sure? certain");
			assert.equal(host.querySelector('[data-testid="confidence-level-5"]')!.getAttribute("aria-checked"), "true");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});
});

describe("writing folds the answer list", () => {
	async function dock(run: (host: HTMLElement) => Promise<void>) {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="fold1" input={quizInput} onSubmit={async () => true} />));
			await run(host);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	}
	const focusThinking = async (host: HTMLElement) => {
		const content = (await mathBoxView(host, "Your thinking")).contentDOM;
		await act(async () => content.dispatchEvent(new dom.window.Event("focusin", { bubbles: true })));
	};

	it("clicking into the box with an answer picked folds the list and Sure meter into one row; Change opens them", async () => {
		await dock(async (host) => {
			const mercury = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="question-option"]')].find((b) => b.textContent?.includes("Mercury"))!;
			await act(async () => mercury.click());
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confidence-level-4"]')!.click());
			await focusThinking(host);
			const row = host.querySelector<HTMLElement>('[data-testid="picked-row"]')!;
			assert.match(row.textContent ?? "", /Mercury/);
			assert.equal(row.querySelector('[data-testid="confidence-square-4"]')!.getAttribute("aria-checked"), "true", "Sure 4 rides the row");
			assert.equal(host.querySelectorAll('[data-testid="question-option"]').length, 0, "the list is folded");
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]'), null, "the Sure meter is folded");
			await act(async () => row.querySelector<HTMLButtonElement>('[data-testid="picked-change"]')!.click());
			assert.equal(host.querySelector('[data-testid="picked-row"]'), null);
			assert.equal(host.querySelectorAll('[data-testid="question-option"]').length, 3);
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]')!.getAttribute("aria-checked"), "true", "the meter comes back as set");
		});
	});

	it("unrated when it folds, the row asks how sure; a square sets it and goes with the answer", async () => {
		let sent: QuestionAnswerData | null = null;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="fold2" input={quizInput} onSubmit={async (a) => ((sent = a), true)} />));
			const mercury = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="question-option"]')].find((b) => b.textContent?.includes("Mercury"))!;
			await act(async () => mercury.click());
			await focusThinking(host);
			const squares = [...host.querySelectorAll<HTMLButtonElement>('[data-testid^="confidence-square-"]')];
			assert.equal(squares.length, 5);
			assert.ok(squares.every((s) => s.getAttribute("aria-checked") === "false"), "nothing picked yet, all dark");
			await act(async () => squares[2]!.click());
			assert.equal(host.querySelector('[data-testid="confidence-square-3"]')!.getAttribute("aria-checked"), "true");
			const form = host.querySelector('[data-testid="question-dock"]')!;
			await act(async () => form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
			assert.equal(sent!.confidence, CONFIDENCE_STOPS[2]);
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("I don't know folds without a Sure row", async () => {
		await dock(async (host) => {
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="dont-know-option"]')!.click());
			await focusThinking(host);
			assert.match(host.querySelector('[data-testid="picked-row"]')!.textContent ?? "", /I don't know/);
			assert.equal(host.querySelector('[data-testid="confidence-squares"]'), null);
		});
	});

	it("with nothing picked the list stays open", async () => {
		await dock(async (host) => {
			await focusThinking(host);
			assert.equal(host.querySelector('[data-testid="picked-row"]'), null);
			assert.equal(host.querySelectorAll('[data-testid="question-option"]').length, 3);
		});
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
	});

	it("errored calls never count; no active problem means no current block", () => {
		const p = practiceProgress([msg({ type: "tool-problem", state: "output-error" }), msg({ type: "tool-conclude", input: { outcome: "solved" } })], false);
		assert.deepEqual(p.blocks, []);
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
