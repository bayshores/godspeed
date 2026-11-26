/**
 * The lesson's turn: Your turn in each of its states (the task with the
 * question or problem, the writing row with its help strip and keys, what
 * is next and its key), how its contents swap, where it shows, the box's
 * Enter rules, the question's keys, folding and saved drafts, the question
 * just answered while the teacher writes, the reading pane's desk and Stop,
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
import { TurnSheet } from "../../src/frontend/components/lesson/turn-sheet.tsx";
import { TurnPlaceContext, TurnSlotsContext, type TurnPlace } from "../../src/frontend/components/lesson/turn-place.ts";
import type { NextAction, TurnNext, TurnNotes } from "../../src/frontend/components/lesson/turn-next-model.ts";
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
import { NO_LESSON_WORK, activeProblemOf, buildAnswer, CONFIDENCE_STOPS, dismissedAnswer, normalizeOptions, resolveCorrect, type QuestionData, emptyDockSelection, type DockSelection, findPendingToolCall, newUserMessage, projectView, reuseUnchangedMessages, type LhMessage, type QuestionAnswerData, type QuestionFormDraft, type SpaceSummary } from "../../src/shared/core/index.ts";

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
const problem = { toolCallId: "p1", statement: "Find E[N].", piece: null, choices: null, line: "Practice, problem 2", part: null, sent: false };
const NO_NEXT = { kind: "next", next: { line: null, key: null }, dim: false } as const;
const atStop: TurnNext = { line: "Cross-validation is next.", key: { label: "Continue", action: "keep-going" } };
const between: TurnNext = { line: null, key: { label: "Next problem", action: "next" } };
const shown = (next: TurnNext, dim = false) => ({ next, dim });

const marco: TeacherApi = {
	name: "marco",
	follow: false,
	setFollow: () => {},
	panelOpen: false,
	setPanelOpen: () => {},
	showChat: () => {},
	talk: { chats: [], chatId: null },
	waiting: { lessons: [], talk: null },
	canAsk: false,
	ask: () => {},
	asking: null,
	recent: [],
	doing: null,
	elsewhere: false,
	setLesson: () => {},
	go: () => {},
	slip: null,
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
		pale: "var(--color-tone)",
		pending: null,
		onSaveQuestionDraft: () => {},
		onSubmitAnswer: () => {},
		onSkipQuestion: () => {},
		reviewRefused: false,
		problem: null,
		problemPicked: emptyDockSelection(),
		onPickProblem: () => {},
		kept: null,
		shown: NO_NEXT,
		swapKey: "",
		onNext: () => {},
		busy: false,
		onStop: null,
		value: "",
		onChange: () => {},
		onSend: () => {},
		onHelpLine: () => {},
		attachments,
		questionRef: { current: null },
		boxRef: { current: null },
		error: null,
		onAnswerAsk: () => {},
		askError: null,
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
	it("next: what is next in the task, then the box that asks with one main key at the end of its keys, and no way out", () => {
		for (const busy of [false, true]) {
			const out = html({ busy, shown: shown(atStop) });
			assert.match(out, /data-mode="next"/);
			assert.doesNotMatch(out, /<h2/, "nothing asked, so no tag");
			assert.match(out, /data-testid="turn-sheet"[\s\S]*data-testid="turn-next-line" class="[^"]*text-ink"[^>]*>Cross-validation is next\.<[\s\S]*data-testid="turn-row"[\s\S]*data-testid="composer-keys"[\s\S]*data-testid="next-problem-button"/);
			assert.match(out, /data-testid="next-problem-button" data-action="keep-going" class="lh-btn lh-btn-main shrink-0">Continue</);
			assert.doesNotMatch(out.split('data-testid="turn-row"')[0]!, /next-problem-button/, "the key is in the box's row, not the task");
			assert.equal(out.split("lh-btn-main").length - 1, 1, "one bright key");
			assert.match(out, busy ? /data-testid="turn-row"[\s\S]*Tell Teacher what to focus on[\s\S]*data-testid="composer-send"[^>]*disabled[^>]*>Send</ : /data-testid="turn-row"[\s\S]*data-testid="composer"[\s\S]*data-testid="composer-send"[^>]*disabled[^>]*>Ask Teacher</);
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

	it("pinned or in the page with nothing to answer: no tag, the key that goes on ends the box's keys under Try asking, and the box alone while the teacher works", () => {
		for (const place of ["pinned", "under"] as const) {
			const there = (n: React.ReactNode) => <TurnPlaceContext.Provider value={place}>{n}</TurnPlaceContext.Provider>;
			const out = html({ shown: shown(atStop) }, there);
			assert.doesNotMatch(out, /<h2/);
			assert.match(out, /turn-next-line[^>]*>Cross-validation is next\.<\/p>[\s\S]*data-testid="turn-row"[\s\S]*data-testid="turn-foot"[\s\S]*Try asking[\s\S]*Quiz me<\/button><\/div><\/div><div data-testid="composer"[\s\S]*data-testid="composer-keys"[\s\S]*data-testid="next-problem-button"[^>]*>Continue</);
			const busy = html({ busy: true, shown: shown({ line: null, key: null }, true) }, there);
			assert.match(busy, /data-testid="turn-sheet"[^>]*class="[^"]*hidden/, "nothing to say, so the task takes no room");
			assert.match(busy, /data-testid="turn-row"[\s\S]*data-testid="composer"/);
			assert.doesNotMatch(busy, /turn-next|turn-foot|next-problem-button|<h2/);
			for (const over of [{ pending: quiz }, { problem }]) {
				const asked = html(over, there);
				assert.doesNotMatch(asked, /turn-sheet"[^>]*class="[^"]*hidden/, "a question or a problem is drawn");
			}
		}
	});

	it("the last topic: one line and Done for today", () => {
		const out = html({ shown: shown({ line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" } }) });
		assert.match(out, />That was the last topic\.<[\s\S]*data-action="done-for-today"[^>]*>Done for today</);
	});

	it("the last topic with notes: the pages and whether they are saved, no empty band before the box", () => {
		const page = (topicId: string, saving: boolean) => ({ topicId, name: "Stars and bars", recall: null, color: "#888", kind: "godspeed" as const, path: saving ? null : "A/B.md", saving });
		const end = (notes: TurnNotes) => shown({ line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" }, notes });
		const saving = html({ shown: end({ pages: [page("t1", false), page("t2", true)], saved: "Saving to Obsidian", ask: null }) });
		assert.equal(saving.split('data-testid="note-page"').length - 1, 2);
		assert.match(saving, /data-saving/);
		assert.match(saving, /data-testid="notes-saved"[^>]*>Saving to Obsidian</);
		assert.match(html({ shown: end({ pages: [page("t1", false)], saved: "Saved to Obsidian", ask: null }) }), />Saved to Obsidian</);
		const pinned = html({ shown: end({ pages: [page("t1", false)], saved: "Saved to Obsidian", ask: null }) }, (n) => <TurnPlaceContext.Provider value="pinned">{n}</TurnPlaceContext.Provider>);
		assert.match(pinned, /note-page/);
		assert.match(pinned, /overflow-x-auto/, "the sheet is short, so its pages keep one row that scrolls sideways");
		assert.match(saving, /overflow-x-auto/, "on the right page too");
		assert.match(pinned, />Saved to Obsidian</);
	});

	it("a My words ask: the ask is the line under the My words head, Done for today, Skip and Save are in the box and the limit is kept", async () => {
		const ask = { topicId: "t1", name: "Stars and bars", maxLength: 10 };
		const asking = shown({ line: "Explain stars and bars in your own words.", key: { label: "Done for today", action: "done-for-today" }, notes: { pages: [], saved: null, ask } });
		const out = html({ shown: asking });
		assert.match(out, /<h2[^>]*>My words<\/h2>[\s\S]*Explain stars and bars in your own words\./);
		assert.match(out, /data-testid="words-leave"[^>]*>Done for today</);
		assert.doesNotMatch(out, /next-problem-button/, "Done for today only in the box");
		assert.match(out, /One or two sentences/);
		assert.match(out, /data-testid="words-skip"[^>]*>Skip</);
		assert.match(out, /data-testid="words-save"[^>]*disabled[^>]*>Save</);
		const answers: unknown[] = [];
		const onAnswerAsk = (topicId: string, reply: unknown) => answers.push([topicId, reply]);
		const nexts: NextAction[] = [];
		await mounted(turn({ shown: asking, value: "Halve it.", onAnswerAsk, onNext: (a: NextAction) => nexts.push(a) }), async (host) => {
			await click(host, "words-save");
			await click(host, "words-skip");
			await click(host, "words-leave");
		});
		assert.deepEqual(answers, [["t1", { words: "Halve it." }], ["t1", { skip: true }]]);
		assert.deepEqual(nexts, ["done-for-today"]);
		assert.match(html({ shown: asking, value: "x".repeat(14) }), /Shorten it by 4 characters\./);
		assert.match(html({ shown: asking, value: "x".repeat(14) }), /data-testid="words-save"[^>]*disabled/);
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

	it("an app-posed opener has no Skip question in the task while a turn runs: the top bar's More holds it", () => {
		const opener = { ...quiz, input: { ...quizInput, type: "predict" }, appPosed: { kind: "opener" as const, ref: "t1" } };
		const out = html({ pending: opener, busy: true });
		assert.doesNotMatch(out, /skip-question|Skip question/);
		assert.match(out, /<h2 class="lh-kind">Prediction</, "the tag says what waits");
		assert.doesNotMatch(out, /question-kind/, "no small label over the question");
	});

	it("the tag says what waits, drawn by the question after its text: its kind, or that it is from earlier", () => {
		const fromEarlier = { ...quiz, appPosed: { kind: "review" as const, ref: { chatId: "c_old", toolCallId: "rv1" } } };
		assert.match(html({ pending: fromEarlier }), /<h2[^>]*>From earlier</);
		assert.match(html({ pending: quiz }), /Which planet is closest to the sun\?[\s\S]*<h2 class="lh-kind">Quiz</);
		assert.match(html({ pending: { ...quiz, input: { ...quizInput, type: "predict" } } }), /<h2[^>]*>Prediction</);
		assert.match(html({ pending: written }), /<h2[^>]*>Question</);
		assert.doesNotMatch(html({}), /<h2/, "with nothing asked there is no tag");
	});

	it("a refused answer from earlier says so in one quiet line", () => {
		assert.match(html({ reviewRefused: true }), /data-testid="review-refused"[^>]*>That question is no longer due, so nothing was saved\.</);
		assert.doesNotMatch(html(), /review-refused/);
	});

	it("with nothing waiting the box asks the teacher, by its name", () => {
		const out = html();
		assert.match(out, /data-testid="composer"[\s\S]*Your question[\s\S]*data-testid="composer-send"[^>]*disabled[^>]*>Ask Teacher</);
		assert.doesNotMatch(out, /data-size|lh-answer-line/);
		assert.equal(out.split('data-testid="math-box"').length - 1, 1, "one writing box");
		assert.match(html({}, named), />Ask marco</);
		assert.match(html({ value: "why?" }), /data-testid="composer-send"(?![^>]*disabled)[^>]*class="[^"]*lh-btn-main[^"]*"[^>]*>Ask Teacher</, "bright once there is something to ask");
		assert.match(html({ value: "why?", shown: shown(atStop) }), /data-testid="composer-send"(?![^>]*disabled)[^>]*class="lh-btn shrink-0 lh-btn-quiet"[^>]*>Ask Teacher</, "the next key stays the bright one");
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

	it("Stuck? leads the foot row above the box while a question or a problem waits; with nothing waiting and the teacher not busy the row is Try asking", () => {
		const keys = /data-testid="turn-foot"[^>]*><span[^>]*>Stuck\?<\/span>[\s\S]*?>I don(?:'|&#x27;)t know<[\s\S]*?>Give me a hint<[\s\S]*?>Explain it simpler<[\s\S]*data-testid="composer"/;
		for (const over of [{ pending: quiz }, { pending: written }, { pending: choice }, { problem }]) assert.match(html(over), keys, JSON.stringify(Object.keys(over)));
		const ideas = /data-testid="turn-foot"[^>]*><span[^>]*>Try asking<\/span>[\s\S]*?>Draw it<[\s\S]*?>Show a demo<[\s\S]*?>Look it up<[\s\S]*?>Quiz me<[\s\S]*data-testid="composer"/;
		for (const over of [{}, { shown: shown(atStop) }]) {
			assert.match(html(over), ideas, JSON.stringify(Object.keys(over)));
			assert.doesNotMatch(html(over), /Stuck\?/);
		}
		assert.doesNotMatch(html({ busy: true }), /turn-foot|Try asking|Stuck\?/, "the teacher is busy, so the box has no foot row");
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

	it("the lesson reads what is picked through the question's handle, for a line sent beside the question", async () => {
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
		assert.doesNotMatch(out, /discard-problem|Discard problem|skip-question/, "the way out is in the top bar's More");
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

	it("a homework problem lies on a plate beside the text and pinned over it, with no key of its own for its page", () => {
		const homework = { ...problem, line: null, part: "b" };
		assert.doesNotMatch(html({ problem: homework }), /<h2/, "a homework problem has no tag");
		for (const place of ["beside", "pinned", "left"] as const) {
			const plated = html({ problem: homework }, (n) => <TurnPlaceContext.Provider value={place}>{n}</TurnPlaceContext.Provider>);
			assert.match(plated, /data-testid="turn-sheet"[^>]*data-plate="true"/, place);
			assert.doesNotMatch(plated, /data-testid="turn-keys"|lesson-assignment/, "the top bar's Document opens its file");
		}
		assert.doesNotMatch(html({ problem: homework }, (n) => <TurnPlaceContext.Provider value="under">{n}</TurnPlaceContext.Provider>), /data-plate/);
	});

	it("an arriving problem steps in, except beside the text, where it glides in with its sheet", () => {
		const arriving = (place: TurnPlace) =>
			html({ problem }, (n) => (
				<TurnSlotsContext.Provider value={{ closing: false, stepIn: true }}>
					<TurnPlaceContext.Provider value={place}>{n}</TurnPlaceContext.Provider>
				</TurnSlotsContext.Provider>
			));
		assert.match(arriving("pinned"), /data-testid="turn-sheet"[^>]*class="[^"]*lh-block-in/);
		assert.doesNotMatch(arriving("left"), /lh-block-in/);
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
		assert.doesNotMatch(out, /open-problem|skip-question|discard-problem/, "the way out is in the top bar's More");

		const answers: QuestionAnswerData[] = [];
		await mounted(turn({ pending: asked, problem, onSubmitAnswer: (a) => answers.push(a) }), async (host) => {
			await act(async () => optionNamed(host, "Mercury").click());
			await click(host, "question-submit");
		});
		assert.equal(answers[0]?.correct, true);

		const answered = [...posed, result("q1", "quiz", answers[0], 34)];
		assert.equal(findPendingToolCall(projectView(answered)), null);
		assert.equal(activeProblemOf(answered)?.toolCallId, "p1");
		assert.match(html({ problem }), /data-mode="practice"[\s\S]*data-testid="open-problem"/);
		const concluded = [...answered, call("c1", "conclude", CONCLUDE_SOLVED, 35), result("c1", "conclude", null, 35)];
		assert.equal(activeProblemOf(concluded), null);
	});

	it("the task holds neither Skip question nor Discard problem in any state (the top bar's More has them); only a question that came through broken keeps its own skip", async () => {
		const code = { tool: "write_code", toolCallId: "w1", input: { question: "Write add.", language: "python" } };
		for (const over of [{ pending: quiz }, { pending: code }, { pending: written }, { pending: quiz, busy: true }, { problem }, { problem, busy: true }, { shown: shown(atStop) }]) {
			assert.doesNotMatch(html(over), /skip-question|discard-problem|Skip question|Discard problem|stop-turn/, JSON.stringify(Object.keys(over)));
		}

		const broken = { tool: "quiz", toolCallId: "bad", input: {} };
		assert.match(html({ pending: broken }), /data-testid="malformed-question"[\s\S]*data-testid="skip-broken-question"[^>]*>Skip question</);
		let skipped = 0;
		await mounted(turn({ pending: broken, onSkipQuestion: () => void skipped++ }), async (host) => {
			await click(host, "skip-broken-question");
		});
		assert.equal(skipped, 1);
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

	it("takes pictures and PDFs: the tray above the field, an icon-only plus inside the field", () => {
		const files = {
			...attachments,
			files: [
				{ id: "f1", attachment: { name: "graph.png", mimeType: "image/png", data: "iVBORw0KGgo=" } },
				{ id: "f2", attachment: { name: "notes.pdf", mimeType: "application/pdf", data: "JVBERi0=" } },
			],
		};
		const out = html({ problem, attachments: files });
		assert.match(out, /data-testid="attachment-tray"[\s\S]*data-testid="draft-image"[\s\S]*data-testid="draft-pdf"[\s\S]*data-testid="math-box"/);
		assert.match(out, /data-testid="attachment-tray"[\s\S]*class="lh-answer-box[^"]*lh-well"[\s\S]*data-testid="attach-button"[^>]*aria-label="Add pictures or PDFs" title="Add pictures or PDFs"[\s\S]*data-testid="math-box"[\s\S]*data-testid="composer-keys"[\s\S]*data-testid="composer-send"/);
		assert.equal(out.match(/<button[^>]*data-testid="attach-button"[^>]*>([\s\S]*?)<\/button>/)![1]!.replace(/<[^>]*>/g, ""), "", "an icon, no words");
		assert.equal(out.split('data-testid="attach-button"').length - 1, 1, "one attach button");
		const ask = html({ pending: choice });
		assert.match(ask, /class="lh-answer-box[\s\S]*data-testid="attach-button"[\s\S]*data-testid="composer-keys"[\s\S]*data-testid="question-submit"/, "in the field, before Submit answer");
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

	it("How sure shows only after a pick, as one line under the answers with the level in words, and comes into view", async () => {
		await mounted(turn({ pending: quiz }), async (host) => {
			assert.ok(host.querySelector('[data-testid="confidence-line"]') === null, "nothing before a pick");
			scrolledTo.length = 0;
			await act(async () => options(host)[1]!.click());
			const line = host.querySelector('[data-testid="confidence-line"]')!;
			assert.ok(scrolledTo.includes(line));
			assert.match(line.textContent ?? "", /^How sure\?/);
			assert.ok(options(host)[1]!.closest("[role=radiogroup]")!.nextElementSibling === line, "right under the answers");
			assert.equal(line.querySelector('[data-testid="confidence-level-1"]')!.getAttribute("title"), "1, Guessing");
			assert.equal(line.querySelector('[data-testid="confidence-level-5"]')!.getAttribute("title"), "5, Certain");
			assert.equal(line.textContent, "How sure?", "the end words are only in the titles, and no level is in words until one is picked");
			assert.equal(line.querySelectorAll('[role="radiogroup"] > button').length, 5, "five blocks");
			assert.equal(line.querySelector('[data-testid="confidence-word"]')!.textContent, "");
			await click(host, "confidence-level-4");
			assert.equal(line.querySelector('[data-testid="confidence-word"]')!.textContent, "Fairly sure", "the picked level in words");
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
	const column = ({ next = { line: null, key: null }, ...over }: Partial<SheetProps> = {}) => <TurnSheet {...turnProps(over)} spaceId={undefined} {...over} next={next} />;
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

	it("a key that changes while the sheet is first drawn, the page finding out it is pinned, swaps at once", async () => {
		function FoundPinned() {
			const [pinned, setPinned] = React.useState(false);
			React.useLayoutEffect(() => setPinned(true), []);
			return <TurnPlaceContext.Provider value={pinned ? "pinned" : "under"}>{turn({ busy: true })}</TurnPlaceContext.Provider>;
		}
		await mounted(<FoundPinned />, async (host) => {
			assert.equal(swap(host).getAttribute("data-state"), "open");
			assert.doesNotMatch(swap(host).className, /lh-rise|lh-fade/, "nothing fades or rises as the lesson opens");
			assert.match(swap(host).className, /hidden/, "pinned while the teacher works, it holds nothing");
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
			assert.ok(host.querySelector('[data-testid="turn-next-line"]') === null, "no line after a question");
			assert.ok(host.querySelector("h2") === null, "and nothing asked, so no tag");
			assert.match(host.querySelector('[data-testid="turn-sheet"]')!.className, /hidden/, "the task takes no room");
		});
	});

	const keptQuestion = (answer: QuestionAnswerData) => ({ kind: "question" as const, toolCallId: "q1", answer });
	const pickedVenus = keptQuestion(buildAnswer(quizQD, { values: ["Venus"] }));
	const optionRows = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="answered-turn"] [data-testid="question-option"]')];

	it("after an answer the question is kept, dimmed with the pick and its verdict, until the next thing swaps in", async () => {
		await mounted(named(column({ pending: quiz })), async (host, show) => {
			await show(named(column({ busy: true, next: null, kept: pickedVenus })));
			await exitPlays();
			const pane = host.querySelector('[data-testid="answered-turn"]')!;
			assert.equal(host.querySelector('[data-testid="your-turn"]')!.getAttribute("data-mode"), "kept");
			assert.match(host.querySelector("h2")!.textContent!, /Quiz/, "titled as the question was");
			assert.ok(pane.hasAttribute("inert"), "nothing in it can be pressed");
			assert.match(pane.textContent!, /Which planet is closest to the sun\?/);
			const picked = optionRows(host).filter((r) => r.getAttribute("aria-checked") === "true");
			assert.equal(picked.length, 1);
			assert.match(picked[0]!.textContent!, /Venus[\s\S]*Wrong/, "the verdict sits beside the pick");
			assert.equal(host.querySelectorAll('[data-testid="answer-result"]').length, 1);
			assert.equal(host.querySelector('[data-testid="composer-send"]')!.textContent, "Send", "the box stays, to steer what the teacher writes");
			assert.ok(host.querySelector('[data-testid="turn-foot"]') === null, "no help keys while the teacher writes");
			assert.ok(host.querySelector('[data-testid="turn-next-line"]') === null);
			await show(named(column({ pending: { ...quiz, toolCallId: "q2" } })));
			assert.equal(swap(host).getAttribute("data-state"), "closed", "the next question swaps in with the fade");
			await exitPlays();
			assert.ok(host.querySelector('[data-testid="answered-turn"]') === null);
			assert.ok(host.querySelector('[data-testid="question-dock"]'));
		});
	});

	it("once the reply lands, the key that goes on joins the kept question with no swap; the next state alone follows when it goes", async () => {
		await mounted(named(column({ busy: true, next: null, kept: pickedVenus })), async (host, show) => {
			const pane = host.querySelector('[data-testid="answered-turn"]')!;
			await show(named(column({ next: atStop, kept: pickedVenus })));
			assert.equal(swap(host).getAttribute("data-state"), "open", "nothing fades");
			assert.equal(host.querySelector('[data-testid="answered-turn"]'), pane);
			assert.equal(host.querySelector('[data-testid="turn-next-line"]')!.textContent, "Cross-validation is next.");
			assert.equal(host.querySelector('[data-testid="next-problem-button"]')!.textContent, "Continue");
			assert.ok(!host.querySelector('.lh-turn-scroll')!.contains(host.querySelector('[data-testid="next-problem-button"]')), "the key stays in sight under a long task");
			await show(named(column({ next: between })));
			await exitPlays();
			assert.ok(host.querySelector('[data-testid="answered-turn"]') === null);
			assert.equal(host.querySelector('[data-testid="next-problem-button"]')!.textContent, "Next problem");
		});
	});

	it("a problem that closes is kept where it stood, dimmed and not pressable, with no way out and no swap", async () => {
		const keptProblem = { kind: "problem" as const, toolCallId: problem.toolCallId, statement: problem.statement, piece: null, line: problem.line, discarded: false };
		await mounted(named(column({ problem })), async (host, show) => {
			const statement = host.querySelector('[data-testid="open-problem"]')!;
			await show(named(column({ busy: true, next: null, kept: keptProblem })));
			assert.equal(swap(host).getAttribute("data-state"), "open", "the same problem, so nothing fades");
			assert.equal(host.querySelector('[data-testid="open-problem"]'), statement, "its statement is not drawn anew");
			assert.ok(host.querySelector('[data-testid="kept-problem"]')!.hasAttribute("inert"));
			assert.match(host.querySelector("h2")!.textContent!, /Practice, problem 2/);
			assert.ok(host.querySelector('[data-testid="discard-problem"]') === null);
			assert.ok(host.querySelector('[data-testid="kept-problem-discarded"]') === null);
			assert.ok(host.querySelector('[data-testid="turn-foot"]') === null, "no help keys while the teacher writes");
			await show(named(column({ next: between, kept: { ...keptProblem, discarded: true } })));
			assert.equal(host.querySelector('[data-testid="kept-problem-discarded"]')!.textContent, "Discarded");
			assert.equal(host.querySelector('[data-testid="next-problem-button"]')!.textContent, "Next problem");
		});
	});

	it("a skipped question says Skipped instead of a pick; I don't know is its verdict alone", () => {
		const skipped = renderToStaticMarkup(named(column({ busy: true, next: null, kept: keptQuestion({ ...dismissedAnswer("quiz", quizInput.question), answeredAt: "2026-11-19T10:00:00Z" }) })));
		assert.match(skipped, /data-testid="answered-turn-skipped"[^>]*>Skipped</);
		assert.doesNotMatch(skipped, /question-option|answer-result/);
		const unsure = renderToStaticMarkup(named(column({ busy: true, next: null, kept: keptQuestion(buildAnswer(quizQD, { dontKnow: true })) })));
		assert.match(unsure, /data-testid="answer-result"[^>]*>Didn(?:'|&#x27;)t know</);
		assert.doesNotMatch(unsure, /question-option|answered-turn-skipped/);
	});

	it("a right pick reads Right; a prediction shows the pick with no verdict", () => {
		const right = renderToStaticMarkup(named(column({ busy: true, next: null, kept: keptQuestion(buildAnswer(quizQD, { values: ["Mercury"] })) })));
		assert.match(right, /aria-checked="true"[\s\S]*?Mercury[\s\S]*?data-testid="answer-result"[^>]*>Right</);
		const guess = renderToStaticMarkup(named(column({ busy: true, next: null, kept: keptQuestion(buildAnswer({ ...quizQD, questionType: "predict" }, { values: ["Venus"] })) })));
		assert.match(guess, /aria-checked="true"/);
		assert.doesNotMatch(guess, /answer-result/, "a guess is never marked");
	});
});

describe("the lesson page's pair", () => {
	const page = (turn: React.ReactNode | null, reading: React.ReactNode | null = <div data-testid="lesson-reading" />, open = true, place: TurnPlace = "beside", pin = false) =>
		renderToStaticMarkup(<LessonScroll steps={null} restKey="" busy={false} contextRef={{ current: null }} reading={reading} turn={turn} open={open} shutting={false} onShut={() => {}} onRest={() => {}} pin={pin} room={false} place={place} onPlace={() => {}} />);

	it("draws Your turn alone, in the middle at its width in the pair, while the lesson text draws nothing", () => {
		const alone = page(<aside data-testid="turn-sheet" />, null);
		assert.match(alone, /data-testid="lesson-column" class="[^"]*@min-\[1000px\]\/room:max-w-\(--lh-turn\)/);
		assert.match(alone, /lh-lesson-alone/);
		assert.doesNotMatch(alone, /lesson-reading|room:grid|lh-lesson-pair/);
	});

	it("open, Your turn is beside the text; in a narrow room it is under it", () => {
		const started = page(<aside data-testid="turn-sheet" />);
		assert.match(started, /data-testid="lesson-column" class="[^"]*@min-\[1000px\]\/room:grid/, "the pair");
		assert.match(started, /lh-lesson-pair/);
		assert.match(started, /class="lh-turn-fit min-w-0[^"]*"[^>]*><aside data-testid="turn-sheet"/, "drawn in the page when there is no window to move its parts in");
		assert.match(started, /class="lh-turn-top[^"]*"[\s\S]*class="lh-lesson-window[\s\S]*class="lh-turn-fit[\s\S]*class="lh-turn-foot/, "a top pin, the page and a pinned foot");
		assert.doesNotMatch(started, /room:hidden|lh-lesson-closed/, "never hidden: the box is always there");
	});

	it("with an open problem, no book: a left part for the problem beside the text and its writing row, with or without text", () => {
		for (const reading of [<div data-testid="lesson-reading" />, null]) {
			const split = page(<aside data-testid="turn-sheet" />, reading, true, "left", true);
			assert.match(split, /class="relative flex min-h-0 min-w-0 flex-1 flex-col lh-lesson-split"><div hidden="" class="lh-turn-left"><\/div>/, "the left part comes first, hidden until the page lays it out");
			assert.doesNotMatch(split, /room:grid|lh-lesson-pair|lh-lesson-alone|lh-lesson-closed/);
		}
		assert.doesNotMatch(page(<aside data-testid="turn-sheet" />), /lh-lesson-split/);
	});

	it("shut, the text is one page as wide as the open book's left page, from before the lesson starts", () => {
		const shut = page(<aside data-testid="turn-sheet" />, undefined, false, "pinned");
		assert.match(shut, /lh-lesson-closed/);
		assert.match(shut, /data-testid="lesson-column" class="[^"]*@min-\[1000px\]\/room:max-w-none/, "the column keeps the pair's width, so the text's inset never changes");
		assert.doesNotMatch(shut, /@min-\[1000px\]\/room:grid|lh-lesson-pair/);
		assert.match(shut, /room:max-w-\(--lh-text\)/, "the pinned Your turn is as wide as the page");
		const before = page(null, undefined, false, "under");
		assert.match(before, /lh-lesson-closed/);
		assert.doesNotMatch(before, /turn-sheet|@min-\[1000px\]\/room:grid/);
	});
});

describe("the reading pane", () => {
	const readingProps = (over: Partial<React.ComponentProps<typeof ReadingPane>> = {}): React.ComponentProps<typeof ReadingPane> => ({
		spaceId: undefined,
		stepNumbers: new Map(),
		stepNames: new Map(),
		echo: -1,
		messages: [],
		phases: [],
		status: "submitted",
		busy: true,
		stoppedEmpty: false,
		work: NO_LESSON_WORK,
		problemSheet: false,
		queuedSteers: [],
		arrivalsLive: false,
		pageMarks: new Map(),
		arrive: () => undefined,
		onDesk: () => {},
		...over,
	});
	const pane = (over: Partial<React.ComponentProps<typeof ReadingPane>> = {}) => renderToStaticMarkup(<ReadingPane {...readingProps(over)} />);

	const planned: React.ComponentProps<typeof ReadingPane>["messages"] = [{ id: "a1", role: "assistant", parts: [{ type: "tool-work_plan", toolCallId: "p", state: "output-available", input: { items: ["Read"], done: 0 } }] }];

	it("the desk while the teacher works, from the start", () => {
		assert.match(pane(), /data-testid="agent-at-work"/);
		assert.doesNotMatch(pane({ busy: false, status: "ready" }), /data-testid="agent-at-work"/);
	});

	it("while the teacher writes: the lines waiting for it under the desk, and Stop in the writing row after Send; none when idle", () => {
		const out = pane({ messages: planned, queuedSteers: [{ id: "s1", text: "and the variance?" }] });
		assert.match(out, /data-testid="agent-at-work"[\s\S]*data-testid="queued-steers"[\s\S]*?and the variance\?/);
		assert.doesNotMatch(out, /stop-turn/, "Stop is not in the text");
		assert.match(html({ busy: true, onStop: () => {} }), /data-testid="composer-keys"[^>]*>[\s\S]*data-testid="composer-send"[\s\S]*data-testid="stop-turn" class="lh-btn shrink-0">Stop</);
		assert.doesNotMatch(html(), /stop-turn/);
		assert.doesNotMatch(html({ busy: true }), /stop-turn/, "no Stop without a turn to stop");
	});

	it("at a stop while the teacher reads ahead, Stop stands before the next key, which stays the one bright key", () => {
		const out = html({ busy: true, onStop: () => {}, shown: shown(atStop) });
		assert.match(out, /data-testid="composer-keys"[\s\S]*data-testid="stop-turn" class="lh-btn shrink-0">Stop<[\s\S]*data-testid="next-problem-button" data-action="keep-going" class="lh-btn lh-btn-main shrink-0">Continue</);
		assert.equal(out.split("lh-btn-main").length - 1, 1, "one bright key");
	});

	it("Stop sends the stop once", async () => {
		let stops = 0;
		await mounted(turn({ busy: true, onStop: () => void stops++ }), async (host) => {
			await click(host, "stop-turn");
		});
		assert.equal(stops, 1);
	});

	it("no key that moves the lesson on at the foot of the text: those are in Your turn", () => {
		const stopped: React.ComponentProps<typeof ReadingPane>["messages"] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Limits" }] }];
		for (const over of [{ busy: false, status: "ready" as const, onStop: null }, { busy: false, status: "ready" as const, messages: stopped }]) {
			assert.doesNotMatch(pane(over), /next-problem-button|Start again|Continue/);
		}
	});

	it("an empty lesson says it is new, with no promise of a probe", () => {
		const out = pane({ busy: false, status: "ready" });
		assert.match(out, />New lesson</);
		assert.doesNotMatch(out, /see what you already know/);
	});

	it("is as tall as its text: no scroller and no fade of its own, the page scrolls instead", () => {
		assert.doesNotMatch(pane({ busy: false, status: "ready" }), /overflow|lh-scroll-fade|role="log"/);
	});

	it("the learner's line is a plain plate with no space color, while the turn sheet wears the lesson's space color", () => {
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
		assert.match(bubble, /data-testid="user-message" class="[^"]*lh-well/);
		assert.doesNotMatch(bubble, /data-testid="user-message"[^>]*style=|--lh-space-/);
		assert.match(inSpaces(named(<TurnSheet {...turnProps()} spaceId="spc_lesson" next={null} />)), /--lh-pale:[^"]*var\(--lh-space-5\)/);
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
	const sheet = (host: HTMLElement) => host.querySelector('[data-testid="page-piece"]')!;

	it("drawn to text, keeps the As printed key on the title line; pressed, it is a plate held down and the page one white sheet", async () => {
		await mounted(turn({ problem: printedProblem }), async (host) => {
			const key = host.querySelector<HTMLElement>('[data-testid="piece-printed"]')!;
			assert.equal(key.textContent, "As printed");
			assert.equal(key.parentElement!.parentElement, host.querySelector("h2")!.parentElement);
			assert.equal(key.getAttribute("aria-pressed"), "false");
			assert.equal(key.className, "lh-btn lh-btn-small");
			assert.doesNotMatch(sheet(host).className, /lh-printed/);
			await click(host, "piece-printed");
			assert.equal(key.getAttribute("aria-pressed"), "true");
			assert.match(key.className, /\[--lh-key:var\(--lh-key-hover\)\]/);
			assert.doesNotMatch(key.className, /lh-btn-main/, "never the heavy tile");
			assert.match(sheet(host).className, /lh-printed/);
			await click(host, "piece-printed");
			assert.doesNotMatch(sheet(host).className, /lh-printed/);
		});
	});

	it("on a plate, the page is the plate's sheet, edge to edge", () => {
		const out = html({ problem: printedProblem }, (n) => <TurnPlaceContext.Provider value="pinned">{n}</TurnPlaceContext.Provider>);
		assert.match(out, /data-testid="turn-sheet"[^>]*data-plate="true" data-sheet="true"/);
		assert.doesNotMatch(html({ problem }, (n) => <TurnPlaceContext.Provider value="pinned">{n}</TurnPlaceContext.Provider>), /data-sheet/, "a problem in words keeps the plate's inset");
	});

	it("has no As printed key for a typed problem", () => {
		assert.doesNotMatch(html({ problem }), /piece-printed/);
	});
});
