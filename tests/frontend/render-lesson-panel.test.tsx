/**
 * The lesson's turn sheet: Your turn in each of its states (with the
 * answer box, its size, the question above it and the foot row, or what is
 * next and its key), how its contents swap, where it shows, the box's Enter
 * rules, the question's keys, folding and saved drafts, the question just
 * answered while the teacher writes, the reading pane's desk and Stop, the practice
 * progress, and the view's message reuse.
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
import { TurnSheet } from "../../src/frontend/components/lesson/turn-sheet.tsx";
import { TurnPinned } from "../../src/frontend/components/lesson/turn-pinned.ts";
import type { NextAction, TurnNext } from "../../src/frontend/components/lesson/turn-next-model.ts";
import { LessonScroll } from "../../src/frontend/components/lesson/lesson-scroll.tsx";
import type { QuestionHandle } from "../../src/frontend/components/question-dock.tsx";
import { practiceProgress } from "../../src/frontend/components/lesson/practice-progress.ts";
import { ReadingPane } from "../../src/frontend/components/lesson/reading-pane.tsx";
import { TeacherContext, type TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";
import { SpaceProvider } from "../../src/frontend/components/space-context.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { call, CONCLUDE_SOLVED, result, userText } from "../stop-fixtures.ts";
import { PIECE_DETAILS } from "../piece-fixtures.ts";
import { problemPieceOf } from "../../src/shared/core/problem-piece.ts";
import { activeProblemOf, buildAnswer, CONFIDENCE_STOPS, dismissedAnswer, normalizeOptions, resolveCorrect, type QuestionData, emptyDockSelection, type DockSelection, findPendingToolCall, newUserMessage, projectView, reuseUnchangedMessages, type LhMessage, type QuestionAnswerData, type QuestionFormDraft, type SpaceSummary } from "../../src/shared/core/index.ts";

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
const quizOptions = normalizeOptions(quizInput.options);
const quizQD: QuestionData = { kind: "quiz", question: quizInput.question, mode: "single-select", options: quizOptions, correctIndices: resolveCorrect(quizInput.correctAnswer, quizOptions).indices };
const written = { tool: "ask_user_question", toolCallId: "a1", input: { question: "Why does it converge?" } };
const choice = { tool: "ask_user_question", toolCallId: "a2", input: { question: "How do you want to start?", options: [{ label: "From an example" }, { label: "From the definition" }] } };
const problem = { toolCallId: "p1", statement: "Find E[N].", piece: null, choices: null, line: "Practice, problem 2", part: null, file: null };
const NO_NEXT = { kind: "next", next: { line: null, key: null }, dim: false } as const;
const atStop: TurnNext = { line: "Cross-validation is next.", key: { label: "Continue", action: "keep-going" } };
const between: TurnNext = { line: null, key: { label: "Next problem", action: "next" } };
const shown = (next: TurnNext, dim = false) => ({ kind: "next" as const, next, dim });

const marco: TeacherApi = {
	name: "marco",
	follow: false,
	setFollow: () => {},
	panelOpen: false,
	panelStarts: false,
	setPanelOpen: () => {},
	showTerminal: () => {},
	recent: [],
	doing: null,
	setLesson: () => {},
	go: () => {},
	offer: null,
	held: false,
	spaceNameOf: () => null,
};
const named = (node: React.ReactNode) => <TeacherContext.Provider value={marco}>{node}</TeacherContext.Provider>;

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
		onSaveQuestionDraft: () => {},
		onSubmitAnswer: () => {},
		onSkipQuestion: () => {},
		reviewRefused: false,
		problem: null,
		problemPicked: emptyDockSelection(),
		onPickProblem: () => {},
		onDiscardProblem: () => {},
		shown: NO_NEXT,
		swapKey: "",
		onNext: () => {},
		busy: false,
		value: "",
		onChange: () => {},
		onSend: () => {},
		onHelpLine: () => {},
		attachments,
		questionRef: { current: null },
		boxRef: { current: null },
		stuck: null,
		error: null,
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
	it("next: the title, what is next and one main key at the row's end, then the box that asks, with no way out", () => {
		for (const busy of [false, true]) {
			const out = html({ busy, shown: shown(atStop) });
			assert.match(out, /data-mode="next"/);
			assert.match(out, /<h2[^>]*>Your turn<\/h2>[\s\S]*data-testid="turn-next"[\s\S]*data-testid="turn-next-line" class="[^"]*text-ink"[^>]*>Cross-validation is next\.<[\s\S]*data-testid="next-problem-button"/);
			assert.match(out, /data-testid="next-problem-button" data-action="keep-going" class="lh-btn lh-btn-main ml-auto shrink-0">Continue</);
			assert.equal(out.split("lh-btn-main").length - 1, 1, "one bright key");
			assert.match(out, /data-testid="turn-next"[\s\S]*data-testid="composer"[\s\S]*data-testid="composer-send"[^>]*disabled[^>]*>Ask Teacher</);
			assert.doesNotMatch(out, /skip-question|discard-problem|stop-turn|Stop here|Keep going/);
		}
		const plain = html({ shown: shown(between) });
		assert.doesNotMatch(plain, /turn-next-line/, "no line when nothing names what is next");
		assert.match(plain, /data-action="next"[^>]*>Next problem</);
	});

	it("the key sends its own action: keep going at a stop, the go-ahead between problems; Enter away from a field presses it", async () => {
		const pressed: NextAction[] = [];
		const onNext = (a: NextAction) => pressed.push(a);
		await mounted(turn({ shown: shown(atStop), onNext }), async (host, show) => {
			await click(host, "next-problem-button");
			await show(turn({ shown: shown(between), onNext }));
			await click(host, "next-problem-button");
			const enter = new window.Event("keydown", { bubbles: true, cancelable: true });
			Object.defineProperty(enter, "key", { value: "Enter" });
			await act(async () => document.body.dispatchEvent(enter));
		});
		assert.deepEqual(pressed, ["keep-going", "next", "next"]);
	});

	it("pinned at the window's foot with nothing to answer: no head, the key that goes on at the end of the Try asking row, and the box alone while the teacher works", () => {
		const pinned = (n: React.ReactNode) => <TurnPinned.Provider value={true}>{n}</TurnPinned.Provider>;
		const out = html({ shown: shown(atStop) }, pinned);
		assert.match(out, /data-testid="your-turn"[^>]*class="[^"]*lh-turn-quiet/);
		assert.doesNotMatch(out, /<h2/);
		assert.match(out, /turn-next-line[^>]*>Cross-validation is next\.<\/p><\/div>[\s\S]*data-testid="composer"[\s\S]*data-testid="turn-foot"[\s\S]*Try asking[\s\S]*data-testid="next-problem-button"[^>]*>Continue</);
		const busy = html({ busy: true, shown: shown({ line: "Cross-validation is next.", key: null }, true) }, pinned);
		assert.match(busy, /data-testid="turn-swap"[^>]*class="[^"]*hidden[^"]*"><\/div>/);
		assert.match(busy, /data-testid="composer"/);
		assert.doesNotMatch(busy, /turn-next|turn-foot|<h2/);
		for (const over of [{ pending: quiz }, { problem }]) {
			const asked = html(over, pinned);
			assert.match(asked, /<h2/, "a question or a problem keeps its head");
			assert.doesNotMatch(asked, /lh-turn-quiet/);
		}
	});

	it("the last topic: one line and Done for today", () => {
		const out = html({ shown: shown({ line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" } }) });
		assert.match(out, />That was the last topic\.<[\s\S]*data-action="done-for-today"[^>]*>Done for today</);
	});

	it("while the teacher writes: the next line dimmed, with no key", () => {
		const out = html({ busy: true, shown: shown({ line: "Cross-validation is next.", key: null }, true) });
		assert.match(out, /data-testid="turn-next-line" class="[^"]*text-ink-2"[^>]*>Cross-validation is next\.</);
		assert.doesNotMatch(out, /next-problem-button/);
		assert.doesNotMatch(html({ busy: true, shown: shown({ line: null, key: null }, true) }), /turn-next/, "with no line, the title alone");
	});

	it("Start again after a first reply stopped with nothing written", () => {
		assert.match(html({ shown: shown({ line: null, key: { label: "Start again", action: "start-again" } }) }), /data-action="start-again"[^>]*>Start again</);
	});

	it("a question or a problem takes the sheet over the next state", () => {
		for (const over of [{ pending: quiz }, { problem }]) assert.doesNotMatch(html({ ...over, shown: shown(atStop) }), /turn-next|next-problem-button/);
	});

	it("an app-posed opener keeps Skip question while a turn runs", () => {
		const opener = { ...quiz, input: { ...quizInput, type: "predict" }, appPosed: { kind: "opener" as const, ref: "t1" } };
		const out = html({ pending: opener, busy: true });
		assert.match(out, /data-testid="skip-question"[^>]*>Skip question</);
		assert.match(out, /<h2[^>]*>Prediction</, "the title says what waits");
		assert.doesNotMatch(out, /question-kind/, "no small label over the question");
	});

	it("the title says what waits: a question's kind, or that it is from earlier", () => {
		const fromEarlier = { ...quiz, appPosed: { kind: "review" as const, ref: { chatId: "c_old", toolCallId: "rv1" } } };
		assert.match(html({ pending: fromEarlier }), /<h2[^>]*>From earlier</);
		assert.match(html({ pending: quiz }), /<h2[^>]*>Quiz</);
		assert.match(html({ pending: { ...quiz, input: { ...quizInput, type: "predict" } } }), /<h2[^>]*>Prediction</);
		assert.match(html({ pending: written }), /<h2[^>]*>Question</);
		assert.match(html({}), /<h2[^>]*>Your turn</, "with nothing asked");
	});

	it("a refused answer from earlier says so in one quiet line", () => {
		assert.match(html({ reviewRefused: true }), /data-testid="review-refused"[^>]*>That question is no longer due, so nothing was saved\.</);
		assert.doesNotMatch(html(), /review-refused/);
	});

	it("with nothing waiting the box asks the teacher, by its name", () => {
		const out = html();
		assert.match(out, /data-testid="composer" data-size="line"[\s\S]*Your question[\s\S]*data-testid="composer-send"[^>]*disabled[^>]*>Ask Teacher</);
		assert.equal(out.split('data-testid="math-box"').length - 1, 1, "one writing box");
		assert.match(html({}, named), />Ask marco</);
		assert.match(html({ value: "why?" }), /data-testid="composer-send"(?![^>]*disabled)[^>]*class="[^"]*lh-btn-main[^"]*"[^>]*>Ask Teacher</, "bright once there is something to ask");
		assert.match(html({ value: "why?", shown: shown(atStop) }), /data-testid="composer-send"(?![^>]*disabled)[^>]*class="lh-btn shrink-0"[^>]*>Ask Teacher</, "the next key stays the bright one");
	});

	it("the ask key sends the box's words, and steers while the teacher writes", async () => {
		let sent = 0;
		await mounted(turn({ value: "why does this converge?", onSend: () => sent++ }), async (host, show) => {
			await click(host, "composer-send");
			await show(turn({ value: "slower please", busy: true, onSend: () => sent++ }));
			await click(host, "composer-send");
		});
		assert.equal(sent, 2);
	});

	it("an open problem's box has no Teach me this: he asks the teacher in the box", () => {
		assert.doesNotMatch(html({ problem }), /teach-me|Teach me this/);
	});

	it("a waiting quiz question sits above the box, with no text box or submit of its own", () => {
		const out = html({ pending: quiz });
		assert.match(out, /data-mode="question"/);
		assert.match(out, /data-testid="question-dock"[\s\S]*Which planet is closest[\s\S]*data-testid="composer"/);
		assert.match(out, /data-testid="question-submit"[^>]*disabled[^>]*>Submit answer</, "Submit waits for a pick");
		assert.match(out, /Your reasoning or a question/);
		assert.match(out, /data-testid="composer-send"[^>]*disabled[^>]*>Ask Teacher<\/button><button[^>]*data-testid="question-submit"/, "the ask key sits before Submit answer");
		assert.equal(out.split('data-testid="math-box"').length - 1, 1, "one writing box");
		assert.equal(out.split("Submit answer").length - 1, 1, "one submit button");
	});

	it("Submit answer waits for a pick, then sends the answer with the box text as the thinking", async () => {
		const answers: QuestionAnswerData[] = [];
		const props = (value: string) => turn({ pending: quiz, value, onSubmitAnswer: (a) => answers.push(a) });
		await mounted(props(""), async (host, show) => {
			assert.equal(submitDisabled(host), true);
			await click(host, "question-submit");
			assert.equal(answers.length, 0, "a disabled Submit sends nothing");
			await act(async () => optionNamed(host, "Mercury").click());
			await show(props("closest orbit"));
			assert.equal(submitDisabled(host), false);
			await click(host, "question-submit");
			assert.equal(answers.length, 1);
			assert.equal(answers[0]!.answers[0]!.label, "Mercury");
			assert.equal(answers[0]!.thinking, "closest orbit");
			assert.equal(answers[0]!.text, undefined);
		});
	});

	it("Stuck? leads the foot row under the box while a question or a problem waits; with nothing waiting the row is Try asking", () => {
		const keys = /data-testid="composer"[\s\S]*data-testid="turn-foot"[^>]*><span[^>]*>Stuck\?<\/span>[\s\S]*?>I don(?:'|&#x27;)t know<[\s\S]*?>Give me a hint<[\s\S]*?>Explain it simpler</;
		for (const over of [{ pending: quiz }, { pending: written }, { pending: choice }, { problem }]) assert.match(html(over), keys, JSON.stringify(Object.keys(over)));
		const ideas = /data-testid="composer"[\s\S]*data-testid="turn-foot"[^>]*><span[^>]*>Try asking<\/span>[\s\S]*?>Draw it<[\s\S]*?>Show a demo<[\s\S]*?>Look it up<[\s\S]*?>Quiz me</;
		for (const over of [{}, { shown: shown(atStop) }, { busy: true }]) {
			assert.match(html(over), ideas, JSON.stringify(Object.keys(over)));
			assert.doesNotMatch(html(over), /Stuck\?/);
		}
		for (const over of [{ pending: quiz }, { problem }]) assert.doesNotMatch(html(over), /Try asking/, "never both");
	});

	it("a Try asking key sends its words as a line to the teacher", async () => {
		const lines: string[] = [];
		await mounted(turn({ onHelpLine: (l) => lines.push(l) }), async (host) => {
			const keys = [...host.querySelectorAll<HTMLElement>('[data-testid="lesson-idea"]')];
			assert.deepEqual(keys.map((k) => k.textContent), ["Draw it", "Show a demo", "Look it up", "Quiz me"]);
			await click(host, "lesson-idea");
			assert.deepEqual(lines, ["Draw it"]);
		});
	});

	it("I don't know answers the question in one click, with the box text as the thinking", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, value: "no idea", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await click(host, "help-dont-know");
			assert.equal(answers.length, 1);
			assert.equal(answers[0]!.dontKnow, true);
			assert.equal(answers[0]!.correct, false);
			assert.equal(answers[0]!.thinking, "no idea");
		});
		await mounted(turn({ pending: written, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await click(host, "help-dont-know");
			assert.equal(answers[1]!.text, "I don't know", "an ask has no gap to record, so it is answered in words");
			assert.equal(answers[1]!.dontKnow, false);
		});
	});

	it("the hint and simpler keys, and I don't know on a problem, send their words as a line to the teacher", async () => {
		const lines: string[] = [];
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, onHelpLine: (l) => lines.push(l), onSubmitAnswer: (a) => answers.push(a) }), async (host, show) => {
			await click(host, "help-hint");
			await click(host, "help-simpler");
			await show(turn({ problem, onHelpLine: (l) => lines.push(l) }));
			await click(host, "help-dont-know");
		});
		assert.deepEqual(lines, ["Give me a hint", "Explain it simpler", "I don't know"]);
		assert.equal(answers.length, 0, "the question stays open");
	});

	it("while the teacher writes the keys wait, but I don't know still answers a question from earlier", () => {
		const off = (out: string, id: string) => new RegExp(`data-testid="${id}"[^>]*disabled`).test(out);
		const busy = html({ pending: quiz, busy: true });
		assert.ok(off(busy, "help-dont-know") && off(busy, "help-hint") && off(busy, "help-simpler"));
		const fromEarlier = html({ pending: { ...quiz, appPosed: { kind: "review" as const, ref: { chatId: "c_old", toolCallId: "rv1" } } }, busy: true });
		assert.ok(!off(fromEarlier, "help-dont-know") && off(fromEarlier, "help-hint"));
		assert.ok(!off(html({ pending: quiz }), "help-hint"));
	});

	it("a question answered in words: the box text is the answer", async () => {
		const answers: QuestionAnswerData[] = [];
		const out = html({ pending: written });
		assert.match(out, /An answer or a question/);
		assert.match(out, /data-testid="question-submit"[^>]*disabled/, "an empty box is no answer");
		assert.doesNotMatch(out, /question-option/);
		await mounted(turn({ pending: written, value: "the steps shrink", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			assert.equal(submitDisabled(host), false);
			await click(host, "question-submit");
			assert.equal(answers[0]!.text, "the steps shrink");
			assert.equal(answers[0]!.thinking, undefined);
		});
	});

	it("an ask with choices has no field of its own: with nothing picked the box text is the own answer", async () => {
		const answers: QuestionAnswerData[] = [];
		const out = html({ pending: choice });
		assert.doesNotMatch(out, /other-option|Type your own answer|Your own answer/);
		assert.match(out, /An answer or a question/);
		assert.match(out, /data-testid="question-submit"[^>]*disabled/, "an empty box and no pick is no answer");
		await mounted(turn({ pending: choice, value: "Start from a picture", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			assert.equal(submitDisabled(host), false);
			await click(host, "question-submit");
			assert.equal(answers[0]!.other, "Start from a picture");
			assert.deepEqual(answers[0]!.answers, []);
			assert.equal(answers[0]!.thinking, undefined, "the text is the answer, not reasoning");
		});
		await mounted(turn({ pending: choice, value: "examples stick better", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => optionNamed(host, "From an example").click());
			await click(host, "question-submit");
			assert.equal(answers[1]!.answers[0]!.label, "From an example");
			assert.equal(answers[1]!.thinking, "examples stick better", "with a pick the text is the reasoning");
			assert.equal(answers[1]!.other, undefined);
		});
	});

	it("an ask with choices: a pick turns the box to reasoning, and clicking it again gives the own answer back", async () => {
		const answers: QuestionAnswerData[] = [];
		const props = (value: string) => turn({ pending: choice, value, onSubmitAnswer: (a) => answers.push(a) });
		await mounted(props(""), async (host, show) => {
			const placeholder = () => host.innerHTML.match(/An answer or a question|Your reasoning or a question/)?.[0];
			assert.equal(placeholder(), "An answer or a question");
			await act(async () => optionNamed(host, "From an example").click());
			assert.equal(placeholder(), "Your reasoning or a question", "with a pick the text is reasoning");
			await act(async () => optionNamed(host, "From an example").click());
			assert.equal(placeholder(), "An answer or a question", "a second click clears the pick");
			await show(props("Start from a picture"));
			await click(host, "question-submit");
			assert.equal(answers[0]!.other, "Start from a picture");
			assert.deepEqual(answers[0]!.answers, []);
			assert.equal(answers[0]!.thinking, undefined);
		});
	});

	it("the lesson reads what is picked through the question's handle, for a question typed in the terminal", async () => {
		const ref: { current: QuestionHandle | null } = { current: null };
		await mounted(turn({ pending: quiz, questionRef: ref }), async (host) => {
			assert.deepEqual(ref.current!.picked(), []);
			await act(async () => optionNamed(host, "Mercury").click());
			assert.deepEqual(ref.current!.picked(), ["Mercury"]);
		});
	});

	it("an open practice problem shows whole above the box, worked on in the box", () => {
		const out = html({ problem });
		assert.match(out, /data-mode="practice"/);
		assert.match(out, /<h2[^>]*>Practice, problem 2<\/h2>/, "the problem's number is the title");
		assert.doesNotMatch(out, />Your turn</);
		assert.match(out, /data-testid="open-problem"[\s\S]*data-testid="problem-statement"[\s\S]*Find E\[N\]\./);
		assert.match(out, /Your work or a question/);
		assert.match(out, /data-testid="discard-problem"[^>]*>Discard problem</);
		assert.doesNotMatch(out, /question-dock/);
		assert.equal(out.split('data-testid="math-box"').length - 1, 1);
	});

	it("a problem's words go to the teacher at any time, one Send for work and questions", () => {
		for (const busy of [false, true]) assert.match(html({ problem, busy, value: "E[N] = 2" }), /data-testid="composer-send"(?![^>]*disabled)[^>]*>Send</);
		assert.doesNotMatch(html({ problem }), /Ask Teacher/);
	});

	it("a problem with choices shows them as lettered rows above the work box, and one without shows none", () => {
		const choices = { labels: ["$x < 1$", "$x = 1$", "$x > 1$"], multiSelect: true };
		const out = html({ problem: { ...problem, choices } });
		assert.match(out, /data-testid="problem-statement"[\s\S]*Find E\[N\][\s\S]*data-testid="problem-choices"[\s\S]*Select all that apply[\s\S]*data-testid="composer"[\s\S]*Your work/);
		assert.equal(out.split('data-testid="question-option"').length - 1, 3);
		assert.match(out, /role="checkbox"[^>]*>(?:(?!<button)[\s\S])*?>A<[\s\S]*>B<[\s\S]*>C</, "lettered A, B, C");
		const single = html({ problem: { ...problem, choices: { ...choices, multiSelect: false } } });
		assert.match(single, /role="radio"/);
		assert.doesNotMatch(single, /Select all that apply/);
		const plain = html({ problem });
		assert.doesNotMatch(plain, /problem-choices|question-option|Select all that apply/);
	});

	it("picking among a problem's choices saves the picks, and a pick alone can be sent", async () => {
		const choices = { labels: ["first", "second", "third"], multiSelect: true };
		const saved: DockSelection[] = [];
		await mounted(turn({ problem: { ...problem, choices }, onPickProblem: (p) => saved.push(p) }), async (host, show) => {
			await act(async () => optionNamed(host, "second").click());
			assert.deepEqual(saved.map((p) => [...p.selected]), [[1]]);
			assert.equal(host.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')!.disabled, true, "nothing picked or typed yet");
			await show(turn({ problem: { ...problem, choices }, problemPicked: { selected: new Set([1]) } }));
			assert.equal(host.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')!.disabled, false, "a pick is enough to send");
			assert.equal(optionNamed(host, "second").getAttribute("aria-checked"), "true");
		});
	});

	it("a homework problem shows only its statement", () => {
		const out = html({ problem: { ...problem, line: null, part: "b" } });
		assert.doesNotMatch(out, /problem-line|problem-source/);
		assert.match(out, /Find E\[N\]\./);
	});

	it("a homework problem's file and page sit at the end of the title line, and open the file", async () => {
		const opened: string[] = [];
		(window as unknown as { lh: unknown }).lh = { openPath: async (path: string) => void opened.push(path), showInFolder: async () => {} };
		try {
			const file = { name: "HW6.pdf", path: "/tmp/HW6.pdf", page: 2 };
			assert.match(html({ problem: { ...problem, line: null, part: "b", file } }), /<h2[^>]*>Your turn<\/h2><div data-testid="turn-keys"[^>]*><button[^>]*data-testid="lesson-assignment"[^>]*title="HW6.pdf, page 2"/);
			assert.doesNotMatch(html({ pending: quiz, problem: { ...problem, file } }), /lesson-assignment/, "not over a question asked while it is open");
			await mounted(turn({ problem: { ...problem, file } }), async (host) => {
				assert.equal(host.querySelector('[data-testid="lesson-assignment"]')!.textContent, "HW6.pdf, page 2");
				await click(host, "lesson-assignment");
			});
			assert.deepEqual(opened, ["/tmp/HW6.pdf"]);
		} finally {
			delete (window as unknown as { lh?: unknown }).lh;
		}
	});

	it("a homework problem folds the parts the learner is not on to their first line, and a click opens and folds one", async () => {
		const statement = "Solve each equation.\n\n(a) First\n\n(b) Second\n\n(c) Third";
		await mounted(turn({ problem: { ...problem, line: null, part: "b", statement } }), async (host) => {
			const head = (label: string) => host.querySelector(`[data-part-head="${label}"]`)!;
			assert.equal(head("a").getAttribute("role"), "button");
			assert.equal(head("a").getAttribute("aria-expanded"), "false");
			assert.equal(head("c").getAttribute("aria-expanded"), "false");
			assert.match(host.querySelector("[data-part-current]")!.textContent!, /\(b\) Second/);
			await act(async () => (head("a") as HTMLElement).click());
			assert.equal(head("a").getAttribute("aria-expanded"), "true");
			await act(async () => (head("a") as HTMLElement).click());
			assert.equal(head("a").getAttribute("aria-expanded"), "false");
		});
	});

	it("a problem without a line shows only the statement", () => {
		assert.doesNotMatch(html({ problem: { ...problem, line: null } }), /problem-line/);
	});

	it("a quiz asked while a problem is still open (a strong topic's extra question) is answered first, then the problem is back until its conclude", async () => {
		const posed: LhMessage[] = [
			call("p1", "problem", { statement: "Find E[N].", nodeId: "reg" }, 30),
			result("p1", "problem", null, 30),
			userText("u1", "E[N] = 2", 32),
			call("q1", "quiz", { ...quizInput, nodeId: "reg" }, 33),
		];
		const asked = findPendingToolCall(projectView(posed));
		assert.equal(asked?.toolCallId, "q1");
		assert.equal(activeProblemOf(posed)?.toolCallId, "p1", "the problem stays open under the quiz");
		const out = html({ pending: asked, problem });
		assert.match(out, /data-mode="question"/);
		assert.match(out, /data-testid="question-dock"[\s\S]*Which planet is closest[\s\S]*Submit answer/);
		assert.match(out, /data-testid="skip-question"[^>]*>Skip question</, "he may skip it");
		assert.doesNotMatch(out, /open-problem|discard-problem/);

		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: asked, problem, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => optionNamed(host, "Mercury").click());
			await click(host, "question-submit");
		});
		assert.equal(answers[0]?.correct, true);

		const answered = [...posed, result("q1", "quiz", answers[0], 34)];
		assert.equal(findPendingToolCall(projectView(answered)), null);
		assert.equal(activeProblemOf(answered)?.toolCallId, "p1");
		assert.match(html({ problem }), /data-mode="practice"[\s\S]*data-testid="discard-problem"/);
		const concluded = [...answered, call("c1", "conclude", CONCLUDE_SOLVED, 35), result("c1", "conclude", null, 35)];
		assert.equal(activeProblemOf(concluded), null);
	});

	it("Skip question and Discard problem are the way out of each state, at the end of the title row", async () => {
		const skip = /<h2[^>]*>(Quiz|Code|Question)<\/h2><div data-testid="turn-keys"[^>]*><button[^>]*data-testid="skip-question"[^>]*>Skip question<\/button><\/div><\/div>[\s\S]*data-testid="composer"/;
		assert.match(html({ pending: quiz }), skip);
		assert.match(html({ pending: { tool: "write_code", toolCallId: "w1", input: { question: "Write add.", language: "python" } } }), skip);
		assert.match(html({ pending: written }), skip);
		assert.match(html({ pending: quiz, busy: true }), skip, "Stop sits in the lesson text, not here");
		assert.match(html({ problem, busy: true }), /<\/h2><div data-testid="turn-keys"[^>]*><button[^>]*data-testid="discard-problem"[\s\S]*data-testid="turn-foot"/);
		assert.doesNotMatch(html({ pending: quiz, busy: true }), /stop-turn/);


		const asked: string[] = [];
		const handlers = { onSkipQuestion: () => asked.push("question"), onDiscardProblem: () => asked.push("problem") };
		await mounted(turn({ pending: quiz, ...handlers }), async (host, show) => {
			await click(host, "skip-question");
			await show(turn({ problem, ...handlers }));
			await click(host, "discard-problem");
			assert.deepEqual(asked, ["question", "problem"]);
		});
	});

	it("a turn an agent took and went quiet on says how long, and Stop runs it again", async () => {
		let stopped = 0;
		const stuck = { minutes: 7, label: "Stop and try again", onStop: () => stopped++ };
		const out = html({ stuck });
		assert.match(out, /data-testid="turn-stuck"[^>]*>Teacher took this 7 minutes ago and hasn(?:'|&#x27;)t answered\./);
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

	it("takes pictures and PDFs: the tray above the field, the button in the box's row of keys", () => {
		const files = {
			...attachments,
			files: [
				{ id: "f1", attachment: { name: "graph.png", mimeType: "image/png", data: "iVBORw0KGgo=" } },
				{ id: "f2", attachment: { name: "notes.pdf", mimeType: "application/pdf", data: "JVBERi0=" } },
			],
		};
		const out = html({ problem, attachments: files });
		assert.match(out, /data-testid="attachment-tray"[\s\S]*data-testid="draft-image"[\s\S]*data-testid="draft-pdf"[\s\S]*data-testid="math-box"/);
		assert.match(out, /class="lh-answer-lines[\s\S]*data-testid="math-box"[\s\S]*data-testid="attach-button"[^>]*>[\s\S]*?Add pictures or PDFs<\/button><div[^>]*><button[^>]*data-testid="composer-send"/);
		assert.equal(out.split('data-testid="attach-button"').length - 1, 1, "one attach button");
		const ask = html({ pending: choice });
		assert.match(ask, /class="lh-answer-line [\s\S]*data-testid="attach-button"[\s\S]*data-testid="question-submit"/, "beside Submit when the box is one line");
		assert.match(out, /type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp,application\/pdf"/);
		assert.doesNotMatch(out, /data-testid="composer-send"[^>]*disabled=""/, "files alone can be sent");
		assert.match(html({ problem, attachments: { ...attachments, error: "You can add up to 5 files to one message." } }), /data-testid="attachment-error"[^>]*>You can add up to 5 files to one message\.</);
	});

	it("mouse-first: no key hint and no em-dash in any state", () => {
		for (const over of [{}, { busy: true }, { shown: shown(atStop) }, { pending: quiz }, { pending: written }, { problem }]) {
			const out = html(over);
			assert.ok(!out.includes("Enter") && !out.includes("—"), JSON.stringify(Object.keys(over)));
		}
	});
});

describe("Enter in the box", () => {
	const enter = (view: EditorView, shiftKey = false) =>
		runScopeHandlers(view, { key: "Enter", keyCode: 13, shiftKey, metaKey: false, ctrlKey: false, altKey: false } as KeyboardEvent, "editor");

	it("typing reaches the lesson, Enter sends a problem's work, Shift+Enter is a newline", async () => {
		const typed: string[] = [];
		let sent = 0;
		await mounted(turn({ problem, value: "x^2", onChange: (v) => typed.push(v), onSend: () => sent++ }), async (host) => {
			const view = await mathBoxView(host, "Your work or a question");
			await act(async () => view.dispatch({ changes: { from: view.state.doc.length, insert: "+1" } }));
			assert.deepEqual(typed, ["x^2+1"]);
			await act(async () => void enter(view, true));
			assert.equal(sent, 0);
			await act(async () => void enter(view));
			assert.equal(sent, 1);
		});
	});

	it("an empty Enter on a problem sends nothing", async () => {
		let sent = 0;
		await mounted(turn({ problem, onSend: () => sent++ }), async (host) => {
			await act(async () => void enter(await mathBoxView(host, "Your work or a question")));
			assert.equal(sent, 0);
		});
	});

	it("Enter before a pick sends the words to the teacher; after a pick it submits them as reasoning", async () => {
		const answers: QuestionAnswerData[] = [];
		let sent = 0;
		await mounted(turn({ pending: quiz, value: "because", onSubmitAnswer: (a) => answers.push(a), onSend: () => sent++ }), async (host) => {
			await act(async () => void enter(await mathBoxView(host, "Your reasoning or a question")));
			assert.equal(answers.length, 0);
			assert.equal(sent, 1, "a side question");
			await act(async () => optionNamed(host, "Mercury").click());
			await act(async () => void enter(await mathBoxView(host, "Your reasoning or a question")));
			assert.equal(answers.length, 1);
			assert.equal(answers[0]!.thinking, "because");
		});
	});

	it("Enter with nothing waiting asks the teacher; an empty Enter sends nothing", async () => {
		let sent = 0;
		await mounted(turn({ onSend: () => sent++ }), async (host, show) => {
			await act(async () => void enter(await mathBoxView(host, "Your question")));
			assert.equal(sent, 0);
			await show(turn({ value: "why?", onSend: () => sent++ }));
			await act(async () => void enter(await mathBoxView(host, "Your question")));
			assert.equal(sent, 1);
		});
	});

	it("Enter submits a written answer", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: written, value: "it settles", onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => void enter(await mathBoxView(host, "An answer or a question")));
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
	it("number keys pick options, arrows move confidence, Enter on a picked row submits", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => press("2"));
			assert.equal(options(host)[1]!.getAttribute("aria-checked"), "true", "2 picks the second row");
			await act(async () => press("0"));
			assert.equal(options(host)[1]!.getAttribute("aria-checked"), "true", "0 does nothing");
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

	it("How sure shows only after a pick, as one line under the answers, and comes into view", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			assert.ok(host.querySelector('[data-testid="confidence-line"]') === null, "nothing before a pick");
			scrolledTo.length = 0;
			await act(async () => options(host)[1]!.click());
			const line = host.querySelector('[data-testid="confidence-line"]')!;
			assert.ok(scrolledTo.includes(line));
			assert.match(line.textContent ?? "", /^How sure are you\?/);
			assert.ok(options(host)[1]!.closest("[role=radiogroup]")!.nextElementSibling === line, "right under the answers");
			assert.equal(line.querySelector('[data-testid="confidence-level-1"]')!.getAttribute("title"), "1, Guessing");
			assert.equal(line.querySelector('[data-testid="confidence-level-5"]')!.getAttribute("title"), "5, Certain");
			assert.equal(line.textContent, "How sure are you?GuessingCertain", "the end words show at any width");
			const group = line.querySelector('[role="radiogroup"]')!.parentElement!;
			assert.equal(group.textContent, "GuessingCertain", "the end words and the squares are one group, so a narrow line wraps before it");
			assert.ok(!line.className.includes("@container"));
		});
	});

	it("clicking a square sets the level", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			await act(async () => options(host)[0]!.click());
			await click(host, "confidence-level-5");
			assert.equal(host.querySelector('[data-testid="confidence-level-5"]')!.getAttribute("aria-checked"), "true");
		});
	});
});

describe("writing folds the answer list", () => {
	const focusBox = async (host: HTMLElement) => {
		const content = (await mathBoxView(host, "Your reasoning or a question")).contentDOM;
		await act(async () => content.dispatchEvent(new dom.window.Event("focusin", { bubbles: true })));
	};

	it("clicking into the box with an answer picked folds the list into one row, How sure stays under it; Change opens the list", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			await act(async () => optionNamed(host, "Mercury").click());
			await click(host, "confidence-level-4");
			await focusBox(host);
			const row = host.querySelector<HTMLElement>('[data-testid="picked-row"]')!;
			assert.match(row.textContent ?? "", /Mercury/);
			assert.ok(row.querySelector('[data-testid^="confidence-level-"]') === null, "not on the picked row");
			assert.ok(row.nextElementSibling === host.querySelector('[data-testid="confidence-line"]'), "the line sits under it");
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]')!.getAttribute("aria-checked"), "true");
			assert.equal(options(host).length, 0, "the list is folded");
			assert.equal(submitDisabled(host), false, "the answer still stands");
			await act(async () => row.querySelector<HTMLButtonElement>('[data-testid="picked-change"]')!.click());
			assert.ok(host.querySelector('[data-testid="picked-row"]') === null);
			assert.equal(options(host).length, 3);
			assert.equal(host.querySelector('[data-testid="confidence-level-4"]')!.getAttribute("aria-checked"), "true", "still as set");
		});
	});

	it("unrated when it folds, the line still asks how sure; a square sets it and goes with the answer", async () => {
		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: quiz, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => optionNamed(host, "Mercury").click());
			await focusBox(host);
			const squares = [...host.querySelectorAll<HTMLButtonElement>('[data-testid^="confidence-level-"]')];
			assert.equal(squares.length, 5);
			assert.ok(squares.every((s) => s.getAttribute("aria-checked") === "false"), "nothing picked yet, all dark");
			await act(async () => squares[2]!.click());
			assert.equal(host.querySelector('[data-testid="confidence-level-3"]')!.getAttribute("aria-checked"), "true");
			await click(host, "question-submit");
			assert.equal(answers[0]!.confidence, CONFIDENCE_STOPS[2]);
		});
	});

	it("with nothing picked the list stays open", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			await focusBox(host);
			assert.ok(host.querySelector('[data-testid="picked-row"]') === null);
			assert.equal(options(host).length, 3);
		});
	});
});

describe("saved drafts", () => {
	const draft: QuestionFormDraft = { selection: { selected: new Set([0]) }, confidenceIndex: 2 };

	it("a question starts from the saved picks and confidence", async () => {
		await mounted(turn({ pending: quiz, initialQuestionDraft: draft }), async (host) => {
			assert.equal(options(host)[0]!.getAttribute("aria-checked"), "true");
			assert.equal(options(host)[1]!.getAttribute("aria-checked"), "false");
			assert.equal(host.querySelector('[data-testid="confidence-level-3"]')!.getAttribute("aria-checked"), "true");
			assert.equal(submitDisabled(host), false, "a saved pick is an answer");
		});
	});

	it("every change is saved as the selection and the confidence", async () => {
		const saved: QuestionFormDraft[] = [];
		await mounted(turn({ pending: quiz, initialQuestionDraft: draft, onSaveQuestionDraft: (d) => saved.push(d) }), async (host) => {
			await click(host, "confidence-level-5");
			assert.equal(saved.at(-1)!.confidenceIndex, 4);
			await act(async () => options(host)[0]!.click());
			const last = saved.at(-1)!;
			assert.deepEqual(Object.keys(last).sort(), ["confidenceIndex", "selection"]);
			assert.equal(last.selection.selected.size, 0);
			assert.equal(last.confidenceIndex, 4);
		});
	});
});

describe("the turn sheet", () => {
	type SheetProps = React.ComponentProps<typeof TurnSheet>;
	const column = ({ next = { line: null, key: null }, answered = null, ...over }: Partial<SheetProps> = {}) => (
		<TurnSheet {...turnProps(over)} spaceId={undefined} {...over} next={next} answered={answered} />
	);
	const swap = (host: HTMLElement) => host.querySelector('[data-testid="turn-swap"]')!;
	// The old contents' exit (--lh-dur-fast) plays out.
	const exitPlays = () => act(() => new Promise((done) => setTimeout(done, 150)));

	it("is Your turn alone: no head, no Terminal, Activity or Follow (the strip has them), and no drag handle", () => {
		const out = renderToStaticMarkup(named(column({ pending: quiz })));
		assert.match(out, /data-testid="turn-sheet"[\s\S]*data-testid="your-turn"/);
		assert.doesNotMatch(out, /separator|Resize/);
		assert.doesNotMatch(out, /teacher-head|teacher-terminal-open|teacher-activity-open|follow-/);
	});

	it("a new state fades the old contents out in the sheet that stays, then rises in", async () => {
		await mounted(named(column({ pending: quiz })), async (host, show) => {
			const sheet = host.querySelector('[data-testid="turn-sheet"]');
			assert.doesNotMatch(swap(host).className, /lh-rise|lh-fade/, "the contents it opened with are just there");
			await show(named(column({ next: between })));
			assert.equal(swap(host).getAttribute("data-state"), "closed");
			assert.match(swap(host).className, /lh-fade/);
			assert.ok(host.querySelector('[data-testid="question-dock"]'), "the question is held while it fades");
			await exitPlays();
			assert.equal(host.querySelector('[data-testid="turn-sheet"]'), sheet, "the sheet never left");
			assert.match(swap(host).className, /lh-rise/);
			assert.ok(host.querySelector('[data-testid="question-dock"]') === null);
			assert.equal(host.querySelector('[data-testid="next-problem-button"]')!.textContent, "Next problem");
		});
	});

	it("the box stays still while the rest swaps, so a line being typed keeps the keyboard", async () => {
		await mounted(named(column({ next: atStop })), async (host, show) => {
			const box = host.querySelector('[data-testid="composer"]')!;
			assert.ok(!swap(host).contains(box), "the box is outside the part that swaps");
			await show(named(column({ busy: true, next: null })));
			assert.equal(swap(host).getAttribute("data-state"), "closed");
			assert.equal(host.querySelector('[data-testid="composer"]'), box);
			await exitPlays();
			await show(named(column({ pending: quiz })));
			await exitPlays();
			assert.equal(host.querySelector('[data-testid="composer"]'), box, "the same box through every state");
		});
	});

	it("while the teacher writes after anything but an answer, the last next line stays dimmed with no key; after a question, no line", async () => {
		await mounted(named(column({ next: atStop })), async (host, show) => {
			await show(named(column({ busy: true, next: null })));
			await exitPlays();
			assert.match(host.querySelector('[data-testid="turn-next-line"]')!.className, /text-ink-2/);
			assert.equal(host.querySelector('[data-testid="turn-next-line"]')!.textContent, "Cross-validation is next.");
			assert.ok(host.querySelector('[data-testid="next-problem-button"]') === null);
			await show(named(column({ pending: quiz })));
			await exitPlays();
			await show(named(column({ busy: true, next: null })));
			await exitPlays();
			assert.ok(host.querySelector('[data-testid="turn-next"]') === null);
			assert.match(host.querySelector("h2")!.textContent!, /Your turn/);
		});
	});

	const pickedVenus = { toolCallId: "q1", answer: buildAnswer(quizQD, { values: ["Venus"] }) };
	const optionRows = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="answered-turn-option"]')];

	it("while the teacher writes after an answer, the question stays dimmed with the pick and its verdict, until the next thing swaps in", async () => {
		await mounted(named(column({ pending: quiz })), async (host, show) => {
			await show(named(column({ busy: true, next: null, answered: pickedVenus })));
			await exitPlays();
			const pane = host.querySelector('[data-testid="answered-turn"]')!;
			assert.equal(host.querySelector('[data-testid="your-turn"]')!.getAttribute("data-mode"), "answered");
			assert.ok(pane.hasAttribute("inert"), "nothing in it can be pressed");
			assert.match(pane.textContent!, /Which planet is closest to the sun\?/);
			const picked = optionRows(host).filter((r) => r.hasAttribute("data-picked"));
			assert.equal(picked.length, 1);
			assert.match(picked[0]!.textContent!, /Venus[\s\S]*Wrong/, "the verdict sits beside the pick");
			assert.equal(host.querySelectorAll('[data-testid="answer-result"]').length, 1);
			assert.equal(host.querySelector('[data-testid="composer-send"]')!.textContent, "Ask marco", "the box stays, to ask");
			assert.match(host.querySelector('[data-testid="turn-foot"]')!.textContent!, /^Try asking/, "no Stuck? keys with nothing to answer");
			assert.ok(host.querySelector('[data-testid="turn-next"]') === null);
			await show(named(column({ pending: { ...quiz, toolCallId: "q2" }, answered: pickedVenus })));
			assert.equal(swap(host).getAttribute("data-state"), "closed", "the next question swaps in with the fade");
			await exitPlays();
			assert.ok(host.querySelector('[data-testid="answered-turn"]') === null);
			assert.ok(host.querySelector('[data-testid="question-dock"]'));
		});
	});

	it("once the reply lands with nothing waiting, the next state takes over", async () => {
		await mounted(named(column({ busy: true, next: null, answered: pickedVenus })), async (host, show) => {
			await show(named(column({ next: between, answered: pickedVenus })));
			await exitPlays();
			assert.ok(host.querySelector('[data-testid="answered-turn"]') === null);
			assert.equal(host.querySelector('[data-testid="next-problem-button"]')!.textContent, "Next problem");
		});
	});

	it("a skipped question says Skipped instead of a pick; I don't know is its verdict alone", () => {
		const skipped = renderToStaticMarkup(named(column({ busy: true, next: null, answered: { toolCallId: "q1", answer: { ...dismissedAnswer("quiz", quizInput.question), answeredAt: "2026-11-19T10:00:00Z" } } })));
		assert.match(skipped, /data-testid="answered-turn-skipped"[^>]*>Skipped</);
		assert.doesNotMatch(skipped, /answered-turn-option|answer-result/);
		const unsure = renderToStaticMarkup(named(column({ busy: true, next: null, answered: { toolCallId: "q1", answer: buildAnswer(quizQD, { dontKnow: true }) } })));
		assert.match(unsure, /data-testid="answer-result"[^>]*>Didn(?:'|&#x27;)t know</);
		assert.doesNotMatch(unsure, /answered-turn-option|answered-turn-skipped/);
	});

	it("a right pick reads Right; a prediction shows the pick with no verdict", () => {
		const right = renderToStaticMarkup(named(column({ busy: true, next: null, answered: { toolCallId: "q1", answer: buildAnswer(quizQD, { values: ["Mercury"] }) } })));
		assert.match(right, /data-picked="true"[\s\S]*?Mercury[\s\S]*?data-testid="answer-result"[^>]*>Right</);
		const guess = renderToStaticMarkup(named(column({ busy: true, next: null, answered: { toolCallId: "q1", answer: buildAnswer({ ...quizQD, questionType: "predict" }, { values: ["Venus"] }) } })));
		assert.match(guess, /data-picked="true"/);
		assert.doesNotMatch(guess, /answer-result/, "a guess is never marked");
	});
});

describe("the lesson page's pair", () => {
	const page = (turn: React.ReactNode | null, reading: React.ReactNode | null = <div data-testid="lesson-reading" />) =>
		renderToStaticMarkup(<LessonScroll steps={null} restKey="" busy={false} contextRef={{ current: null }} reading={reading} turn={turn} />);

	it("draws Your turn alone, in the middle at its width in the pair, while the lesson text draws nothing", () => {
		const alone = page(<aside data-testid="turn-sheet" />, null);
		assert.match(alone, /data-testid="lesson-column" class="[^"]*@min-\[1280px\]\/room:max-w-\(--lh-turn\)/);
		assert.match(alone, /lh-lesson-alone/);
		assert.doesNotMatch(alone, /lesson-reading|room:grid|lh-lesson-pair/);
	});

	it("keeps Your turn beside the text for the whole lesson, and under it in a narrow room", () => {
		const started = page(<aside data-testid="turn-sheet" />);
		assert.match(started, /data-testid="lesson-column" class="[^"]*@min-\[1280px\]\/room:grid/, "the pair stays");
		assert.match(started, /class="lh-turn-fit min-w-0"[^>]*><aside data-testid="turn-sheet"/);
		assert.doesNotMatch(started, /room:hidden/, "never hidden: the box is always there");
		assert.doesNotMatch(page(null), /turn-sheet|@min-\[1280px\]\/room:grid/, "before the lesson starts the text is one column");
	});
});

describe("the reading pane", () => {
	const readingProps = (over: Partial<React.ComponentProps<typeof ReadingPane>> = {}): React.ComponentProps<typeof ReadingPane> => ({
		spaceId: undefined,
		stepNumbers: new Map(),
		echo: -1,
		messages: [],
		phases: [],
		status: "submitted",
		busy: true,
		stoppedEmpty: false,
		waitingForAgent: false,
		onStop: () => {},
		queuedSteers: [],
		arrivalsLive: false,
		pageMarks: new Map(),
		arrive: () => undefined,
		...over,
	});
	const pane = (over: Partial<React.ComponentProps<typeof ReadingPane>> = {}) => renderToStaticMarkup(<ReadingPane {...readingProps(over)} />);

	const planned: React.ComponentProps<typeof ReadingPane>["messages"] = [{ id: "a1", role: "assistant", parts: [{ type: "tool-work_plan", toolCallId: "p", state: "output-available", input: { items: ["Read"], done: 0 } }] }];

	it("the desk once the working teacher has a plan", () => {
		assert.doesNotMatch(pane(), /data-testid="agent-at-work"/);
		assert.match(pane({ messages: planned }), /data-testid="agent-at-work" data-state="working"/);
	});

	it("while the teacher writes: Stop and the lines waiting for it under the desk; none when idle or at a stop", () => {
		const out = pane({ messages: planned, queuedSteers: [{ id: "s1", text: "and the variance?" }] });
		assert.match(out, /data-testid="agent-at-work"[\s\S]*data-testid="queued-steers"[\s\S]*?and the variance\?[\s\S]*data-testid="stop-turn"[^>]*>Stop</);
		assert.doesNotMatch(pane({ busy: false, status: "ready" }), /stop-turn/);
		assert.doesNotMatch(pane({ onStop: null }), /stop-turn/, "the teacher reading ahead at a stop is not stopped");
	});

	it("no key that moves the lesson on at the foot of the text: those are in Your turn", () => {
		const stopped: React.ComponentProps<typeof ReadingPane>["messages"] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Limits" }] }];
		for (const over of [{ busy: false, status: "ready" as const, onStop: null }, { busy: false, status: "ready" as const, messages: stopped }]) {
			assert.doesNotMatch(pane(over), /next-problem-button|Start again|Continue/);
		}
	});

	it("no desk while no agent takes the turn; the strip says it instead", () => {
		const out = pane({ waitingForAgent: true });
		assert.doesNotMatch(out, /data-testid="agent-at-work"/);
		assert.ok(!out.includes("Thinking"), "no words while nothing works");
	});

	it("an empty lesson says it is new, with no promise of a probe", () => {
		const out = pane({ busy: false, status: "ready" });
		assert.match(out, />New lesson</);
		assert.doesNotMatch(out, /see what you already know/);
	});

	it("is as tall as its text: no scroller and no fade of its own, the page scrolls instead", () => {
		assert.doesNotMatch(pane({ busy: false, status: "ready" }), /overflow|lh-scroll-fade|role="log"/);
	});

	it("the learner's bubbles wear the lesson's space color, as the turn sheet does, not the open space's", () => {
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
			<ReadingPane {...readingProps({ spaceId: "spc_lesson", messages, status: "ready", busy: false })} />,
		);
		assert.match(bubble, /data-testid="user-message"[^>]*style="[^"]*var\(--lh-space-5\)/);
		assert.doesNotMatch(bubble, /--lh-space-3/);
		assert.match(inSpaces(named(<TurnSheet {...turnProps()} spaceId="spc_lesson" next={null} answered={null} />)), /--lh-pale:[^"]*var\(--lh-space-5\)/);
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

describe("Your turn with a problem printed in a file", () => {
	const printedProblem = { ...problem, piece: problemPieceOf(PIECE_DETAILS)! };
	const pageBox = (host: HTMLElement) => host.querySelector('[data-testid="page-piece"] > div')!;

	it("keeps the As printed key on the title line, where a long piece cannot scroll it away", async () => {
		await mounted(turn({ problem: printedProblem }), async (host) => {
			const key = host.querySelector<HTMLElement>('[data-testid="piece-printed"]')!;
			assert.equal(key.textContent, "As printed");
			assert.equal(key.parentElement!.parentElement, host.querySelector("h2")!.parentElement);
			assert.equal(key.getAttribute("aria-pressed"), "false");
			assert.doesNotMatch(pageBox(host).className, /bg-white/);
			await click(host, "piece-printed");
			assert.equal(key.getAttribute("aria-pressed"), "true");
			assert.match(pageBox(host).className, /bg-white/);
			await click(host, "piece-printed");
			assert.doesNotMatch(pageBox(host).className, /bg-white/);
		});
	});

	it("has no As printed key for a typed problem", () => {
		assert.doesNotMatch(html({ problem }), /piece-printed/);
	});
});
