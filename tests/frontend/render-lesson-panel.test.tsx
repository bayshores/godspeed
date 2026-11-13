/**
 * The lesson's teacher column: Your turn in each of its states (with the
 * one writing box and the question above it), the box's Enter rules, the
 * question's keys, folding and saved drafts, the teacher head with
 * Activity and the read-first reveal, the reading pane's waiting line,
 * the practice progress, and the view's message reuse.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { parseHTML } from "linkedom";
import { runScopeHandlers, type EditorView } from "@codemirror/view";
import { mathBoxView, stubCodeMirrorDom } from "../math-box-dom.ts";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { YourTurn } from "../../src/frontend/components/lesson/your-turn.tsx";
import { stopCard } from "../../src/frontend/components/lesson/stop-card-model.ts";
import { TeacherColumn } from "../../src/frontend/components/lesson/teacher-column.tsx";
import { practiceProgress } from "../../src/frontend/components/lesson/practice-progress.ts";
import { ReadingPane } from "../../src/frontend/components/lesson/reading-pane.tsx";
import { HalleyContext, type HalleyApi } from "../../src/frontend/components/halley/halley-context.ts";
import { SpaceProvider } from "../../src/frontend/components/space-context.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { CONFIDENCE_STOPS, newUserMessage, projectView, reuseUnchangedMessages, type LhMessage, type QuestionAnswerData, type QuestionFormDraft, type SpaceSummary } from "../../src/shared/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
const store = new Map<string, string>();
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
	localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
});
stubCodeMirrorDom(dom);
// linkedom has no layout: scrollIntoView only records what it was asked to show.
const scrolledTo: Element[] = [];
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: Element) {
	scrolledTo.push(this);
};

const quizInput = {
	question: "Which planet is closest to the sun?",
	options: [{ label: "Venus" }, { label: "Mercury" }, { label: "Mars" }],
	correctAnswer: "Mercury",
	explanation: "Mercury is the innermost planet.",
};
const quiz = { tool: "quiz", toolCallId: "q1", input: quizInput };
const check = { tool: "quiz", toolCallId: "t1", input: { ...quizInput, type: "check" } };
const written = { tool: "ask_user_question", toolCallId: "a1", input: { question: "Why does it converge?" } };
const problem = { toolCallId: "p1", statement: "Find E[N].", line: "Practice, problem 2", source: null, part: null };

const marco: HalleyApi = {
	name: "marco",
	follow: false,
	setFollow: () => {},
	panelOpen: false,
	setPanelOpen: () => {},
	recent: [],
	doing: null,
	setLesson: () => {},
	go: () => {},
	offer: null,
	spaceNameOf: () => null,
};
const named = (node: React.ReactNode) => <HalleyContext.Provider value={marco}>{node}</HalleyContext.Provider>;

const attachments = {
	files: [],
	error: null,
	add: () => {},
	remove: () => {},
	clear: () => {},
	restore: () => {},
};

type TurnProps = React.ComponentProps<typeof YourTurn>;

function turnProps(over: Partial<TurnProps> = {}): TurnProps {
	return {
		pending: null,
		revealPending: false,
		onReveal: () => {},
		onSaveQuestionDraft: () => {},
		onSubmitAnswer: () => {},
		onSkipQuestion: () => {},
		problem: null,
		onDiscardProblem: () => {},
		stop: null,
		busy: false,
		waitingForAgent: false,
		onStop: () => {},
		onNext: () => {},
		value: "",
		onChange: () => {},
		onSend: () => {},
		queuedSteers: [],
		attachments,
		stuck: null,
		error: null,
		stats: null,
		...over,
	};
}

const turn = (over: Partial<TurnProps> = {}) => <YourTurn {...turnProps(over)} />;
// The waiting state links to Settings, so the box renders inside a router.
const html = (over: Partial<TurnProps> = {}, wrap: (n: React.ReactNode) => React.ReactNode = (n) => n) =>
	renderToStaticMarkup(<MemoryRouter initialEntries={["/chat/ses_1"]}>{wrap(turn(over))}</MemoryRouter>);

/** Mounts a node, runs the checks against it, and cleans up. */
async function mounted(node: React.ReactNode, run: (host: HTMLElement, show: (next: React.ReactNode) => Promise<void>) => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(node));
		await run(host, (next) => act(async () => root.render(next)));
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const click = (host: HTMLElement, testId: string) => act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click());
const options = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[data-testid="question-option"]')];
const optionNamed = (host: HTMLElement, label: string) => options(host).find((b) => b.textContent?.includes(label))!;
const submitDisabled = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-testid="question-submit"]')!.disabled;

describe("Your turn in each state", () => {
	it("nothing to answer: the line, the box, and no way out", () => {
		const out = html();
		assert.match(out, /data-mode="chat"/);
		assert.match(out, />Your turn</);
		assert.match(out, /data-testid="nothing-to-answer"[^>]*>Nothing to answer right now\.</);
		assert.match(out, /data-testid="composer"[\s\S]*data-testid="math-box"[\s\S]*Message Teacher/, "the one writing box");
		assert.match(out, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Send</, "Send waits for text");
		assert.doesNotMatch(out, /skip-question|discard-problem|stop-turn/);
	});

	it("a stop: the card, no way out, and the Stop button stays hidden while the teacher reads ahead", () => {
		const view = stopCard({ kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "reg", stopOf: "c1", next: "Cross-validation", activeMinutes: 48, keptGoing: false });
		for (const busy of [false, true]) {
			const out = html({ busy, stop: { key: "c1", view, onAction: () => {} } });
			assert.match(out, /data-mode="stop"/);
			assert.match(out, /data-testid="stop-card"[\s\S]*Cross-validation is next\.[\s\S]*data-testid="composer"/, "the card, then the box under it");
			assert.doesNotMatch(out, /nothing-to-answer|skip-question|discard-problem|stop-turn/);
		}
	});

	it("an app-posed opener keeps Skip question while a turn runs", () => {
		const opener = { ...quiz, input: { ...quizInput, type: "predict" }, appPosed: { kind: "opener" as const, ref: "t1" } };
		const out = html({ pending: opener, busy: true });
		assert.match(out, /data-testid="question-kind"[^>]*>Prediction</);
		assert.match(out, /data-testid="skip-question"[^>]*>Skip question</);
		assert.doesNotMatch(out, /stop-turn/);
	});

	it("the box names the teacher", () => {
		assert.match(html({}, named), /Message marco/);
	});

	it("while the teacher writes: Stop beside Your turn, and the box says Send when ready", () => {
		const out = html({ busy: true });
		assert.match(out, />Your turn<[\s\S]*data-testid="stop-turn"[^>]*>Stop</);
		assert.match(out, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Send when ready</);
		assert.doesNotMatch(out, /nothing-to-answer/);
		assert.match(html({ busy: true, value: "wait, why?" }), /data-testid="composer-send"(?![^>]*disabled)[^>]*>[\s\S]*?Send when ready</, "typed text can steer the reply");
	});

	it("Stop stops the running turn", async () => {
		let stopped = 0;
		await mounted(turn({ busy: true, onStop: () => stopped++ }), async (host) => {
			await click(host, "stop-turn");
			assert.equal(stopped, 1);
		});
	});

	it("queued messages sit above the box", () => {
		const out = html({ busy: true, queuedSteers: [{ id: "s1", text: "and the variance?" }] });
		assert.match(out, /data-testid="queued-steers"[\s\S]*?and the variance\?[\s\S]*data-testid="math-box"/);
	});

	it("the pause between problems asks for Next problem; a study session's pause says Continue", async () => {
		const out = html({ next: "Next problem" });
		assert.match(out, /data-testid="next-problem-button"[^>]*>Next problem</);
		assert.match(out, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Send</, "the box can still send a message");
		assert.match(html({ next: "Continue" }), /data-testid="next-problem-button"[^>]*>Continue</);
		assert.doesNotMatch(html({ next: "Continue" }), /Next problem/);
		let next = 0;
		await mounted(turn({ next: "Next problem", onNext: () => next++ }), async (host) => {
			await click(host, "next-problem-button");
			assert.equal(next, 1);
		});
	});

	it("a waiting quiz question sits above the box, with no text box or submit of its own", () => {
		const out = html({ pending: quiz });
		assert.match(out, /data-mode="question"/);
		assert.match(out, /data-testid="question-kind"[^>]*>Quiz</);
		assert.match(out, /data-testid="question-dock"[\s\S]*Which planet is closest[\s\S]*data-testid="composer"/);
		assert.match(out, /data-testid="question-submit"[^>]*disabled[^>]*>Submit answer</, "Submit waits for a pick");
		assert.match(out, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Ask Teacher</);
		assert.match(out, /Your reasoning, or a question for Teacher/);
		assert.equal(out.split('data-testid="math-box"').length - 1, 1, "one writing box");
		assert.equal(out.split("Submit answer").length - 1, 1, "one submit button");
		assert.doesNotMatch(out, /nothing-to-answer/);
	});

	it("Submit answer waits for a pick, then sends the answer with the box text as the thinking", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, value: "closest orbit", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			assert.equal(submitDisabled(host), true);
			await click(host, "question-submit");
			assert.equal(answers.length, 0, "a disabled Submit sends nothing");
			await act(async () => optionNamed(host, "Mercury").click());
			assert.equal(submitDisabled(host), false);
			await click(host, "question-submit");
			assert.equal(answers.length, 1);
			assert.equal(answers[0]!.answers[0]!.label, "Mercury");
			assert.equal(answers[0]!.thinking, "closest orbit");
			assert.equal(answers[0]!.text, undefined);
		});
	});

	it("I don't know is an answer too", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await click(host, "dont-know-option");
			assert.equal(submitDisabled(host), false);
			await click(host, "question-submit");
			assert.equal(answers[0]!.dontKnow, true);
			assert.equal(answers[0]!.thinking, undefined, "an empty box adds no thinking");
		});
	});

	it("a question answered in words: the box text is the answer", async () => {
		const answers: QuestionAnswerData[] = [];
		const out = html({ pending: written });
		assert.match(out, /Type your answer, or a question for Teacher/);
		assert.match(out, /data-testid="question-submit"[^>]*disabled/, "an empty box is no answer");
		assert.doesNotMatch(out, /question-option|dont-know-option/);
		await mounted(turn({ pending: written, value: "the steps shrink", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			assert.equal(submitDisabled(host), false);
			await click(host, "question-submit");
			assert.equal(answers[0]!.text, "the steps shrink");
			assert.equal(answers[0]!.thinking, undefined);
		});
	});

	it("Ask marco sends the box text as a message and leaves the question open", async () => {
		let sent = 0;
		const answers: QuestionAnswerData[] = [];
		const node = named(turn({ pending: quiz, value: "what does closest mean?", onSend: () => sent++, onSubmitAnswer: (a) => answers.push(a) }));
		await mounted(node, async (host) => {
			const ask = host.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')!;
			assert.match(ask.textContent ?? "", /^Ask marco$/);
			assert.equal(ask.disabled, false);
			await click(host, "composer-send");
			assert.equal(sent, 1);
			assert.equal(answers.length, 0, "nothing was answered");
			assert.ok(host.querySelector('[data-testid="question-dock"]'), "the question stays open");
		});
	});

	it("read first: Check your understanding opens the check, and the question stays hidden", async () => {
		const out = html({ pending: check, revealPending: true });
		assert.match(out, /data-mode="reveal"/);
		assert.match(out, /data-testid="teach-check-reveal"[^>]*>Check your understanding</);
		assert.match(out, /Whatever comes to mind as you read\./);
		assert.match(out, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Ask Teacher</);
		assert.doesNotMatch(out, /Which planet is closest|question-dock|question-submit/);
		let revealed = 0;
		await mounted(turn({ pending: check, revealPending: true, onReveal: () => revealed++ }), async (host) => {
			await click(host, "teach-check-reveal");
			assert.equal(revealed, 1);
		});
	});

	it("an open practice problem shows whole above the box, worked on in the box", () => {
		const out = html({ problem });
		assert.match(out, /data-mode="practice"/);
		assert.match(out, /data-testid="problem-line"[^>]*>Practice, problem 2</);
		assert.match(out, /data-testid="open-problem"[\s\S]*data-testid="problem-statement"[\s\S]*Find E\[N\]\./);
		assert.match(out, /Message Teacher, or type your work/);
		assert.match(out, /data-testid="discard-problem"[^>]*>Discard problem</);
		assert.doesNotMatch(out, /problem-source|nothing-to-answer|question-dock/);
		assert.equal(out.split('data-testid="math-box"').length - 1, 1);
	});

	it("a homework problem shows where it is in the file", () => {
		const out = html({ problem: { ...problem, line: "HW4, problem 3 of 7", source: "from hw4.pdf, page 2", part: "b" } });
		assert.match(out, /data-testid="problem-line"[^>]*>HW4, problem 3 of 7</);
		assert.match(out, /data-testid="problem-source"[^>]*>from hw4\.pdf, page 2</);
		assert.match(out, /Find E\[N\]\./);
	});

	it("a problem without a line shows only the statement", () => {
		assert.doesNotMatch(html({ problem: { ...problem, line: null } }), /problem-line/);
	});

	it("Skip question, Discard problem and Stop are the way out of each state", async () => {
		const skip = /data-testid="skip-question"[^>]*>Skip question</;
		assert.match(html({ pending: quiz }), skip);
		assert.match(html({ pending: check, revealPending: true }), skip);
		assert.match(html({ pending: { tool: "write_code", toolCallId: "w1", input: { question: "Write add.", language: "python" } } }), skip);
		assert.match(html({ pending: written }), skip);
		assert.match(html({ pending: quiz, busy: true }), /data-testid="stop-turn"[^>]*>Stop</, "while the teacher replies to a message, Stop replaces Skip question");
		assert.doesNotMatch(html({ pending: quiz, busy: true }), /skip-question/);
		assert.match(html({ problem, busy: true }), /data-testid="stop-turn"/);
		assert.doesNotMatch(html({ problem, busy: true }), /discard-problem/);

		const asked: string[] = [];
		const handlers = { onSkipQuestion: () => asked.push("question"), onDiscardProblem: () => asked.push("problem") };
		await mounted(turn({ pending: quiz, ...handlers }), async (host, show) => {
			await click(host, "skip-question");
			await show(turn({ problem, ...handlers }));
			await click(host, "discard-problem");
			assert.deepEqual(asked, ["question", "problem"]);
		});
	});

	it("while the turn waits for an agent the box says Send, with nothing under it", () => {
		const out = html({ busy: true, waitingForAgent: true });
		assert.match(out, /data-testid="composer-send"[^>]*disabled[\s\S]*?>Send</, "the box says Send, not Send when ready");
		assert.doesNotMatch(out, /Send when ready/);
		assert.doesNotMatch(out, /lesson-waiting|no-agent|Open Connection settings/);
	});

	it("a turn an agent took and went quiet on says how long, and Stop runs it again", async () => {
		let stopped = 0;
		const stuck = { minutes: 7, label: "Stop and try again", onStop: () => stopped++ };
		const out = html({ stuck });
		assert.match(out, /data-testid="turn-stuck"[^>]*>Your agent took this 7 minutes ago and hasn(?:'|&#x27;)t answered\./);
		assert.match(out, /data-testid="turn-stuck-stop"[^>]*>Stop and try again</);
		assert.doesNotMatch(html(), /turn-stuck/);
		await mounted(turn({ stuck }), async (host) => {
			await click(host, "turn-stuck-stop");
			assert.equal(stopped, 1);
		});
	});

	it("an error reads as a plain sentence with Try again; the raw text is the hover tip", async () => {
		let retried = 0;
		const error = { text: "Your message didn't go through.", detail: "The send failed (500).", onRetry: () => retried++ };
		const out = html({ error });
		assert.match(out, /data-testid="lesson-error" title="The send failed \(500\)\."[^>]*>Your message didn&#x27;t go through\.</);
		assert.match(out, /data-testid="lesson-error-retry"[^>]*>Try again</);
		assert.doesNotMatch(html(), /lesson-error/);
		await mounted(turn({ error }), async (host) => {
			await click(host, "lesson-error-retry");
			assert.equal(retried, 1);
		});
	});

	it("takes pictures and PDFs: the tray above the field, the button in a row under the box", () => {
		const files = {
			...attachments,
			files: [
				{ id: "f1", attachment: { name: "graph.png", mimeType: "image/png", data: "iVBORw0KGgo=" } },
				{ id: "f2", attachment: { name: "notes.pdf", mimeType: "application/pdf", data: "JVBERi0=" } },
			],
		};
		const out = html({ attachments: files, stats: <span data-testid="size-button">3k</span> });
		assert.match(out, /data-testid="attachment-tray"[\s\S]*data-testid="draft-image"[\s\S]*data-testid="draft-pdf"[\s\S]*data-testid="math-box"/);
		assert.match(out, /data-testid="composer"[\s\S]*data-testid="attach-button"[^>]*>[\s\S]*?Add pictures or PDFs<[\s\S]*data-testid="size-button"/);
		assert.equal(out.split('data-testid="attach-button"').length - 1, 1, "one attach button, outside the box");
		assert.doesNotMatch(out.slice(out.indexOf('data-testid="composer"'), out.indexOf('data-testid="attach-button"')), /Add pictures or PDFs/);
		assert.match(out, /type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp,application\/pdf"/);
		assert.doesNotMatch(out, /data-testid="composer-send"[^>]*disabled=""/, "files alone can be sent");
		assert.match(html({ attachments: { ...attachments, error: "You can add up to 5 files to one message." } }), /data-testid="attachment-error"[^>]*>You can add up to 5 files to one message\.</);
	});

	it("mouse-first: no key hint and no em-dash in any state", () => {
		for (const over of [{}, { busy: true }, { next: "Next problem" }, { pending: quiz }, { pending: written }, { pending: check, revealPending: true }, { problem }]) {
			const out = html(over);
			assert.ok(!out.includes("Enter") && !out.includes("—"), JSON.stringify(Object.keys(over)));
		}
	});
});

describe("Enter in the box", () => {
	const enter = (view: EditorView, shiftKey = false) =>
		runScopeHandlers(view, { key: "Enter", keyCode: 13, shiftKey, metaKey: false, ctrlKey: false, altKey: false } as KeyboardEvent, "editor");

	it("typing reaches the lesson, Enter sends, Shift+Enter is a newline", async () => {
		const typed: string[] = [];
		let sent = 0;
		await mounted(turn({ value: "x^2", onChange: (v) => typed.push(v), onSend: () => sent++ }), async (host) => {
			const view = await mathBoxView(host, "Message Teacher");
			await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: "+1" } }));
			assert.deepEqual(typed, ["x^2+1"]);
			await act(async () => void enter(view, true));
			assert.equal(sent, 0);
			await act(async () => void enter(view));
			assert.equal(sent, 1);
		});
	});

	it("an empty Enter does nothing in a plain lesson", async () => {
		let sent = 0;
		await mounted(turn({ onSend: () => sent++ }), async (host) => {
			await act(async () => void enter(await mathBoxView(host, "Message Teacher")));
			assert.equal(sent, 0);
		});
	});

	it("an empty Enter in the pause asks for the next problem; with text it sends", async () => {
		let next = 0;
		let sent = 0;
		await mounted(turn({ next: "Next problem", onNext: () => next++, onSend: () => sent++ }), async (host, show) => {
			await act(async () => void enter(await mathBoxView(host, "Message Teacher")));
			assert.equal(next, 1);
			assert.equal(sent, 0);
			await show(turn({ next: "Next problem", value: "one more thing", onNext: () => next++, onSend: () => sent++ }));
			await act(async () => void enter(await mathBoxView(host, "Message Teacher")));
			assert.equal(next, 1);
			assert.equal(sent, 1);
		});
	});

	it("an empty Enter while the teacher writes stops; with text it steers", async () => {
		let stopped = 0;
		let sent = 0;
		const handlers = { busy: true, onStop: () => stopped++, onSend: () => sent++ };
		await mounted(turn(handlers), async (host, show) => {
			await act(async () => void enter(await mathBoxView(host, "Message Teacher")));
			assert.equal(stopped, 1);
			await show(turn({ ...handlers, value: "wait" }));
			await act(async () => void enter(await mathBoxView(host, "Message Teacher")));
			assert.equal(stopped, 1);
			assert.equal(sent, 1);
		});
	});

	it("Enter submits a picked answer and does nothing before one is picked", async () => {
		const answers: QuestionAnswerData[] = [];
		const label = "Your reasoning, or a question for Teacher";
		await mounted(turn({ pending: quiz, value: "because", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => void enter(await mathBoxView(host, label)));
			assert.equal(answers.length, 0);
			await act(async () => optionNamed(host, "Mercury").click());
			await act(async () => void enter(await mathBoxView(host, label)));
			assert.equal(answers.length, 1);
			assert.equal(answers[0]!.thinking, "because");
		});
	});

	it("Enter in the box checks the understanding while reading first", async () => {
		let revealed = 0;
		await mounted(turn({ pending: check, revealPending: true, onReveal: () => revealed++ }), async (host) => {
			await act(async () => void enter(await mathBoxView(host, "Whatever comes to mind as you read.")));
			assert.equal(revealed, 1);
		});
	});

	it("Enter submits a written answer", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: written, value: "it settles", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => void enter(await mathBoxView(host, "Type your answer, or a question for Teacher")));
			assert.equal(answers[0]!.text, "it settles");
		});
	});
});

function press(key: string) {
	const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.defineProperty(e, "key", { value: key });
	document.dispatchEvent(e);
}

describe("the question's keys", () => {
	it("number keys pick options, 0 is I don't know, arrows move confidence, Enter on a picked row submits", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => press("2"));
			assert.equal(options(host)[1]!.getAttribute("aria-checked"), "true", "2 picks the second row");
			await act(async () => press("0"));
			assert.equal(host.querySelector('[data-testid="dont-know-option"]')!.getAttribute("aria-pressed"), "true", "0 = I don't know");
			assert.ok(options(host).every((r) => r.getAttribute("aria-checked") === "false"), "I don't know clears the pick");
			await act(async () => press("1"));
			assert.equal(options(host)[0]!.getAttribute("aria-checked"), "true");
			await act(async () => press("9"));
			assert.equal(options(host)[0]!.getAttribute("aria-checked"), "true", "a key past the options does nothing");
			await act(async () => press("ArrowRight"));
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]')!.getAttribute("aria-checked"), "true", "→ from unrated lands on 4");
			await act(async () => press("ArrowLeft"));
			assert.equal(host.querySelector('[data-testid="confidence-level-3"]')!.getAttribute("aria-checked"), "true", "← moves back");
			await act(async () => press("ArrowRight"));
			assert.equal(answers.length, 0);
			await act(async () => press("Enter"));
			assert.equal(answers.length, 1, "Enter submits once");
			assert.equal(answers[0]!.confidence, CONFIDENCE_STOPS[3], "level 4 is saved as 80%");
			assert.equal(answers[0]!.answers[0]!.label, options(host)[0]!.textContent?.replace(/^A/, ""));
		});
	});

	it("Enter before any row is walked or picked submits nothing", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, onSubmitAnswer: (a) => answers.push(a) }), async () => {
			await act(async () => press("Enter"));
			assert.equal(answers.length, 0);
		});
	});

	it("picking an answer brings the confidence meter into view", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			scrolledTo.length = 0;
			await act(async () => options(host)[1]!.click());
			assert.ok(scrolledTo.includes(host.querySelector('[data-testid="confidence-meter"]')!));
		});
	});

	it("clicking a confidence bar sets the level", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			await click(host, "confidence-level-5");
			assert.equal(host.querySelector('[data-testid="confidence-level-5"]')!.getAttribute("aria-checked"), "true");
		});
	});
});

describe("writing folds the answer list", () => {
	const label = "Your reasoning, or a question for Teacher";
	const focusBox = async (host: HTMLElement) => {
		const content = (await mathBoxView(host, label)).contentDOM;
		await act(async () => content.dispatchEvent(new dom.window.Event("focusin", { bubbles: true })));
	};

	it("clicking into the box with an answer picked folds the list and Sure meter into one row; Change opens them", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			await act(async () => optionNamed(host, "Mercury").click());
			await click(host, "confidence-level-4");
			await focusBox(host);
			const row = host.querySelector<HTMLElement>('[data-testid="picked-row"]')!;
			assert.match(row.textContent ?? "", /Mercury/);
			assert.equal(row.querySelector('[data-testid="confidence-square-4"]')!.getAttribute("aria-checked"), "true", "Sure 4 rides the row");
			assert.equal(options(host).length, 0, "the list is folded");
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]'), null, "the Sure meter is folded");
			assert.equal(submitDisabled(host), false, "the answer still stands");
			await act(async () => row.querySelector<HTMLButtonElement>('[data-testid="picked-change"]')!.click());
			assert.equal(host.querySelector('[data-testid="picked-row"]'), null);
			assert.equal(options(host).length, 3);
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]')!.getAttribute("aria-checked"), "true", "the meter comes back as set");
		});
	});

	it("unrated when it folds, the row asks how sure; a square sets it and goes with the answer", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => optionNamed(host, "Mercury").click());
			await focusBox(host);
			const squares = [...host.querySelectorAll<HTMLButtonElement>('[data-testid^="confidence-square-"]')];
			assert.equal(squares.length, 5);
			assert.ok(squares.every((s) => s.getAttribute("aria-checked") === "false"), "nothing picked yet, all dark");
			await act(async () => squares[2]!.click());
			assert.equal(host.querySelector('[data-testid="confidence-square-3"]')!.getAttribute("aria-checked"), "true");
			await click(host, "question-submit");
			assert.equal(answers[0]!.confidence, CONFIDENCE_STOPS[2]);
		});
	});

	it("I don't know folds without a Sure row", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			await click(host, "dont-know-option");
			await focusBox(host);
			assert.match(host.querySelector('[data-testid="picked-row"]')!.textContent ?? "", /I don't know/);
			assert.equal(host.querySelector('[data-testid="confidence-squares"]'), null);
		});
	});

	it("with nothing picked the list stays open", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			await focusBox(host);
			assert.equal(host.querySelector('[data-testid="picked-row"]'), null);
			assert.equal(options(host).length, 3);
		});
	});
});

describe("saved drafts", () => {
	const draft: QuestionFormDraft = { selection: { selected: new Set([0]), otherSelected: false, dontKnow: false }, other: "", confidenceIndex: 2 };

	it("a question starts from the saved picks and confidence", async () => {
		await mounted(turn({ pending: quiz, initialQuestionDraft: draft }), async (host) => {
			assert.equal(options(host)[0]!.getAttribute("aria-checked"), "true");
			assert.equal(options(host)[1]!.getAttribute("aria-checked"), "false");
			assert.equal(host.querySelector('[data-testid="confidence-level-3"]')!.getAttribute("aria-checked"), "true");
			assert.equal(submitDisabled(host), false, "a saved pick is an answer");
		});
	});

	it("every change is saved as the selection, the typed own answer and the confidence", async () => {
		const saved: QuestionFormDraft[] = [];
		await mounted(turn({ pending: quiz, initialQuestionDraft: draft, onSaveQuestionDraft: (d) => saved.push(d) }), async (host) => {
			await click(host, "confidence-level-5");
			assert.equal(saved.at(-1)!.confidenceIndex, 4);
			await click(host, "dont-know-option");
			const last = saved.at(-1)!;
			assert.deepEqual(Object.keys(last).sort(), ["confidenceIndex", "other", "selection"]);
			assert.equal(last.selection.dontKnow, true);
			assert.equal(last.selection.selected.size, 0);
			assert.equal(last.other, "");
			assert.equal(last.confidenceIndex, 4);
		});
	});
});

describe("the teacher column", () => {
	const column = (over: Partial<React.ComponentProps<typeof TeacherColumn>> = {}) => (
		<TeacherColumn {...turnProps(over)} spaceId={undefined} width={480} onWidth={() => {}} requiresReveal={false} onReveal={() => {}} noAgent={false} {...over} />
	);

	it("the head names the teacher and says what it is doing, over Your turn", () => {
		const idle = renderToStaticMarkup(named(column()));
		assert.match(idle, /data-testid="teacher-head"[\s\S]*marco[\s\S]*data-testid="teacher-activity-open"[^>]*>Activity<[\s\S]*data-testid="your-turn"/);
		assert.doesNotMatch(idle, /teacher-head-doing/);
		assert.match(renderToStaticMarkup(named(column({ busy: true }))), /data-testid="teacher-head-doing"[^>]*>marco is writing…</);
		for (const busy of [true, false]) {
			const waiting = renderToStaticMarkup(<MemoryRouter initialEntries={["/chat/ses_1"]}>{named(column({ busy, noAgent: true }))}</MemoryRouter>);
			const link = /<a[^>]*data-testid="teacher-head-doing"[^>]*>Waiting for your agent</.exec(waiting)?.[0] ?? "";
			assert.match(link, /href="\/settings\?section=connection"/, "the status opens Connection settings, turn or no turn");
		}
		assert.match(renderToStaticMarkup(column()), /Teacher/, "the default name");
	});

	it("Activity swaps the column for the activity list until Back to your turn", async () => {
		await mounted(named(column()), async (host) => {
			assert.ok(host.querySelector('[data-testid="your-turn"]'));
			assert.equal(host.querySelector('[data-testid="teacher-activity"]'), null);
			await click(host, "teacher-activity-open");
			assert.ok(host.querySelector('[data-testid="teacher-activity"]'));
			assert.equal(host.querySelector('[data-testid="your-turn"]'), null);
			assert.match(host.querySelector('[data-testid="teacher-activity-back"]')!.textContent ?? "", /Back to your turn/);
			assert.equal(host.querySelector('[data-testid="teacher-activity-open"]'), null);
			await click(host, "teacher-activity-back");
			assert.ok(host.querySelector('[data-testid="your-turn"]'));
			assert.equal(host.querySelector('[data-testid="teacher-activity"]'), null);
		});
	});

	it("a teach-phase check waits behind Check your understanding until it is opened", async () => {
		let revealed = 0;
		await mounted(named(column({ pending: check, requiresReveal: true, onReveal: () => revealed++ })), async (host) => {
			assert.equal(host.querySelector('[data-testid="your-turn"]')!.getAttribute("data-mode"), "reveal");
			assert.equal(host.querySelector('[data-testid="question-dock"]'), null);
			await click(host, "teach-check-reveal");
			assert.equal(revealed, 1);
			assert.equal(host.querySelector('[data-testid="your-turn"]')!.getAttribute("data-mode"), "question");
			assert.ok(host.querySelector('[data-testid="question-dock"]'));
			assert.equal(host.querySelector('[data-testid="teach-check-reveal"]'), null);
		});
	});

	it("a check that follows another question opens at once; a question that needs no reveal never waits", async () => {
		await mounted(named(column({ pending: quiz })), async (host, show) => {
			assert.equal(host.querySelector('[data-testid="your-turn"]')!.getAttribute("data-mode"), "question");
			await show(named(column({ pending: check, requiresReveal: true })));
			assert.equal(host.querySelector('[data-testid="your-turn"]')!.getAttribute("data-mode"), "question", "the reading already happened");
			await show(named(column()));
			await show(named(column({ pending: { ...check, toolCallId: "t2" }, requiresReveal: true })));
			assert.equal(host.querySelector('[data-testid="your-turn"]')!.getAttribute("data-mode"), "reveal", "after a gap the learner reads first again");
		});
	});
});

describe("the reading pane", () => {
	const pane = (over: Partial<React.ComponentProps<typeof ReadingPane>> = {}) =>
		renderToStaticMarkup(
			<ReadingPane
				spaceId={undefined}
				messages={[]}
				phases={[]}
				status="submitted"
				busy
				turnInFlight={false}
				waitingForAgent={false}
				arrivalsLive={false}
				arrive={() => undefined}
				onOpenPlan={() => {}}
				scrollContextRef={{ current: null }}
				{...over}
			/>,
		);

	it("Thinking… while the agent works", () => {
		assert.match(pane(), /Thinking…/);
	});

	it("no Thinking… while no agent takes the turn; the teacher column says it instead", () => {
		const out = pane({ waitingForAgent: true });
		assert.ok(!out.includes("Thinking…"), "no shimmer while nothing works");
		assert.ok(!out.includes("lesson-waiting"));
	});

	it("an empty lesson says it is new, with no promise of a probe", () => {
		const out = pane({ busy: false, status: "ready" });
		assert.match(out, />New lesson</);
		assert.doesNotMatch(out, /see what you already know/);
	});

	it("the learner's bubbles wear the lesson's space color, as the teacher column does, not the open space's", () => {
		const spaces = [
			{ id: "spc_open", name: "Open space", color: 3 },
			{ id: "spc_lesson", name: "Lesson space", color: 5 },
		] as unknown as SpaceSummary[];
		const messages = projectView([{ ...newUserMessage("my answer", []), id: "u1" }]);
		const inSpaces = (node: React.ReactNode) =>
			renderToStaticMarkup(
				<ServerEventsProvider connect={(() => ({ onEvent() {}, onOpen() {}, close() {} })) as never}>
					<SpaceProvider initialActive="spc_open" initialSpaces={spaces}>
						{node}
					</SpaceProvider>
				</ServerEventsProvider>,
			);
		const bubble = inSpaces(
			<ReadingPane spaceId="spc_lesson" messages={messages} phases={[]} status="ready" busy={false} turnInFlight={false} waitingForAgent={false} arrivalsLive={false} arrive={() => undefined} onOpenPlan={() => {}} scrollContextRef={{ current: null }} />,
		);
		assert.match(bubble, /data-testid="user-message"[^>]*style="[^"]*var\(--lh-space-5\)/);
		assert.doesNotMatch(bubble, /--lh-space-3/);
		assert.match(inSpaces(named(<TeacherColumn {...turnProps()} spaceId="spc_lesson" width={480} onWidth={() => {}} requiresReveal={false} noAgent={false} onReveal={() => {}} />)), /--lh-pale:[^"]*var\(--lh-space-5\)/);
		assert.doesNotMatch(pane({ messages, busy: false, status: "ready" }), /data-testid="user-message"[^>]*style=/, "a lesson with no space keeps the plain bubble");
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
