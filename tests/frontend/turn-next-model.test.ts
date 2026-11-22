/** "Your turn" with nothing to answer: what is next, its key and what the key does, what stays while the teacher writes, and where the sheet is drawn. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookOpen, heldTask, turnDrawn, turnNext, turnShown } from "../../src/frontend/components/lesson/turn-next-model.ts";
import type { VaultNote } from "../../src/frontend/components/vault/note-pages-model.ts";
import { dismissedAnswer, projectView, type LessonStop, type LhMessage, type QuestionAnswerData } from "../../src/shared/core/index.ts";
import { call, CONCLUDE_SOLVED, keepGoing, marker, OPENER_QUIZ, regularizationEnds, result, text, userText } from "../stop-fixtures.ts";

const stop: LessonStop = { kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "reg", stopOf: "c1", next: "Cross-validation", activeMinutes: 48, keptGoing: false };
const idle = { stop: null, problemList: false, goLabel: "Continue", busy: false, error: false, nothingWritten: false, notes: null, obsidian: true };

describe("turnNext", () => {
	it("at a topic stop: what is next, and the go-ahead's label keeps going, also while the teacher reads ahead or an error shows", () => {
		for (const over of [{}, { busy: true }, { error: true }]) {
			assert.deepEqual(turnNext({ ...idle, ...over, stop }), { line: "Cross-validation is next.", key: { label: "Continue", action: "keep-going" } }, JSON.stringify(over));
		}
	});

	it("at a problem stop: the next step, nothing in practice, and no line for homework, whose key names the problem", () => {
		const problem: LessonStop = { ...stop, kind: "problem" };
		assert.equal(turnNext({ ...idle, stop: problem })?.line, "Next is Cross-validation.");
		assert.deepEqual(turnNext({ ...idle, goLabel: "Next problem", stop: { ...problem, next: null } }), { line: null, key: { label: "Next problem", action: "keep-going" } });
		assert.deepEqual(turnNext({ ...idle, problemList: true, goLabel: "Start problem 4", stop: { ...problem, next: "problem 4" } }), { line: null, key: { label: "Start problem 4", action: "keep-going" } });
	});

	it("the last topic ends the day", () => {
		assert.deepEqual(turnNext({ ...idle, stop: { ...stop, kind: "end", next: null } }), { line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" } });
	});

	it("the last topic shows the lesson's pages and whether they are saved, and a words ask is the line", () => {
		const end = { ...stop, kind: "end", next: null } as const;
		const page = (topicId: string, saving: boolean): VaultNote => ({ topicId, name: "Stars and bars", recall: null, color: "#888", kind: "godspeed", path: "A/B.md", saving });
		const saving = [page("t1", false), page("t2", true)];
		assert.equal(turnNext({ ...idle, stop: end, notes: { pages: saving, asks: [] } })?.notes?.saved, "Saving to Obsidian");
		assert.equal(turnNext({ ...idle, stop: end, notes: { pages: [page("t1", false)], asks: [] } })?.notes?.saved, "Saved to Obsidian");
		const asked = turnNext({ ...idle, stop: end, notes: { pages: saving, asks: [{ topicId: "t1", name: "Stars and bars", maxLength: 600 }] } });
		assert.equal(asked?.line, "Explain stars and bars in your own words.");
		assert.equal(asked?.key?.action, "done-for-today");
		assert.equal(turnNext({ ...idle, stop: end, notes: { pages: [], asks: [] } })?.notes, undefined);
	});

	it("with no stop: the go-ahead once the teacher is done, none beside an error line, and nothing while the teacher writes", () => {
		assert.deepEqual(turnNext(idle), { line: null, key: { label: "Continue", action: "next" } });
		assert.deepEqual(turnNext({ ...idle, error: true }), { line: null, key: null });
		assert.deepEqual(turnNext({ ...idle, goLabel: null }), { line: null, key: null });
		assert.equal(turnNext({ ...idle, busy: true }), null);
	});

	it("Start again after a first reply stopped with nothing written, unless the go-ahead or an error line is up", () => {
		const stopped = { ...idle, goLabel: null, nothingWritten: true };
		assert.deepEqual(turnNext(stopped), { line: null, key: { label: "Start again", action: "start-again" } });
		assert.equal(turnNext({ ...stopped, goLabel: "Continue" })?.key?.action, "next");
		assert.deepEqual(turnNext({ ...stopped, error: true }), { line: null, key: null });
	});
});

describe("turnDrawn", () => {
	it("is not drawn before the lesson starts, then stays for the whole lesson, so the box is always there", () => {
		assert.equal(turnDrawn({ started: false, holds: false }), false);
		assert.equal(turnDrawn({ started: true, holds: false }), true);
	});

	it("is drawn before the start too once it holds something to press", () => {
		assert.equal(turnDrawn({ started: false, holds: true }), true);
	});
});

describe("turnShown", () => {
	const next = { line: "Cross-validation is next.", key: { label: "Continue", action: "keep-going" as const } };

	it("shows the next state whenever there is one", () => {
		assert.deepEqual(turnShown({ next, lastLine: null }), { next, dim: false });
	});

	it("while the teacher writes: the last next line dimmed with no key", () => {
		assert.deepEqual(turnShown({ next: null, lastLine: "Old line." }), { next: { line: "Old line.", key: null }, dim: true });
	});
});

describe("heldTask", () => {
	const QUIZ = { question: "Which planet is closest to the sun?", options: [{ label: "Venus" }, { label: "Mercury" }], correctAnswer: "Mercury", explanation: "Innermost." };
	const picked: QuestionAnswerData = {
		kind: "quiz",
		questionText: QUIZ.question,
		options: [{ index: 1, label: "Venus" }, { index: 2, label: "Mercury" }],
		dontKnow: false,
		answers: [{ index: 1, label: "Venus", value: "Venus" }],
		correctIndices: [2],
		correct: false,
		answeredAt: "2026-11-19T10:00:00Z",
	};
	const answered = [text("t0", "The planets, in order.", 1), call("q1", "quiz", QUIZ, 2), result("q1", "quiz", picked, 3), text("t1", "Not quite.", 4)];
	const posed = [call("p1", "problem", { statement: "Fit lambda." }, 10), result("p1", "problem", null, 10)];
	const concluded = [...posed, call("c1", "conclude", CONCLUDE_SOLVED, 20), result("c1", "conclude", null, 20), text("t2", "Right, and here is why.", 21)];
	const stopped = (id: string, words: string, minutes: number) => ({ ...(text(id, words, minutes) as object), stopReason: "aborted" }) as LhMessage;
	const idle = { busy: false, goOn: true };
	const of = (record: LhMessage[], s = idle) => heldTask(record, projectView(record), s);

	it("keeps the question he answered or skipped, through the teacher's reply, his own lines and a question from earlier", () => {
		const held = of(answered);
		assert.equal(held?.kind, "question");
		assert.equal(held?.toolCallId, "q1");
		assert.equal(held?.kind === "question" && held.answer.answers[0]?.label, "Venus");
		const talk = [...answered, userText("u1", "Why not Venus?", 5), text("t2", "It is second.", 6), marker("rv1", "review", {}, 7)];
		assert.equal(of(talk)?.toolCallId, "q1", "a line and its reply are about the task");
		const skipped = [text("t0", "Hi.", 1), call("q1", "quiz", QUIZ, 2), result("q1", "quiz", { ...dismissedAnswer("quiz", QUIZ.question), answeredAt: "2026-11-19T10:00:00Z" }, 3)];
		const skip = of(skipped);
		assert.equal(skip?.kind === "question" && skip.answer.dismissed, true);
		const refused = [...answered, call("q2", "quiz", { question: "Bad" }, 5), result("q2", "quiz", null, 5, true), marker("a1", "app-note", {}, 6)];
		assert.equal(of(refused)?.toolCallId, "q1", "a refused question call and the app's own notes are not his doing");
	});

	it("keeps a problem from the moment it is concluded, and one he discarded", () => {
		const closing = concluded.slice(0, -1);
		assert.deepEqual(of(closing, { busy: true, goOn: false }), { kind: "problem", toolCallId: "p1", input: { statement: "Fit lambda." }, details: null, discarded: false });
		assert.equal(of(concluded)?.toolCallId, "p1");
		const dropped = of([...posed, marker("d1", "problem-dismissed", {}, 12)]);
		assert.equal(dropped?.kind === "problem" && dropped.discarded, true);
		assert.equal(of(posed), null, "a problem still open is not kept, it is the page's task");
	});

	it("lets it go once he went on and the reply to that landed whole with words", () => {
		const wentOn = [...concluded, marker("n1", "practice-next", {}, 22)];
		assert.equal(of(wentOn, { busy: true, goOn: false })?.toolCallId, "p1", "the reply is on its way");
		assert.equal(of([...wentOn, text("t3", "Before the next one, a word on bias.", 23)], { busy: true, goOn: false })?.toolCallId, "p1", "still being written");
		assert.equal(of([...wentOn, text("t3", "Before the next one, a word on bias.", 23)]), null);
		assert.equal(of([...answered, keepGoing("c1", 5), text("t3", "Cross-validation splits the data.", 6)]), null);
	});

	it("keeps it when the reply to going on was stopped, failed or said nothing", () => {
		const wentOn = [...concluded, marker("n1", "practice-next", {}, 22)];
		assert.equal(of([...wentOn, stopped("t3", "Before the", 23)])?.toolCallId, "p1", "a stopped reply");
		assert.equal(of(wentOn)?.toolCallId, "p1", "no reply at all");
		assert.equal(of([...wentOn, text("t3", "A word first.", 23), call("g1", "grep", {}, 24), result("g1", "grep", null, 24), stopped("t4", "", 25)])?.toolCallId, "p1", "words in a reply that never ended");
	});

	it("gives way to what comes next, and to nothing left to go on to", () => {
		const next = [...concluded, marker("n1", "practice-next", {}, 22), call("p2", "problem", { statement: "Now ridge." }, 23), result("p2", "problem", null, 23)];
		assert.equal(of(next), null, "the next problem is open");
		assert.equal(of(concluded, { busy: false, goOn: false }), null, "after the last problem no key stands");
		assert.equal(of([text("t0", "Hi.", 1)]), null, "nothing finished yet");
	});

	it("is the newer of a question and a problem", () => {
		const both = [...concluded, call("q1", "quiz", QUIZ, 30), result("q1", "quiz", picked, 31)];
		assert.equal(of(both)?.kind, "question");
		assert.equal(of([...answered, ...concluded])?.kind, "problem");
	});

	it("finds an opener's answer in the view", () => {
		const record = [...regularizationEnds(), keepGoing("c1", 50), marker("oa1", "opener-answer", { topicDoneCallId: "t1", answer: { ...picked, questionText: OPENER_QUIZ.question } }, 51)];
		assert.equal(of(record)?.toolCallId, "opener_t1");
	});
});

describe("bookOpen", () => {
	const shut = { question: null, problem: false, held: false } as const;

	it("is open for the teacher's question, an open problem and a kept task", () => {
		assert.equal(bookOpen({ ...shut, question: "teacher" }), true);
		assert.equal(bookOpen({ ...shut, problem: true }), true);
		assert.equal(bookOpen({ ...shut, held: true }), true);
	});

	it("stays as it is for a question from earlier, and is shut with nothing to work on", () => {
		assert.equal(bookOpen({ ...shut, question: "review" }), false);
		assert.equal(bookOpen({ ...shut, question: "review", held: true }), true);
		assert.equal(bookOpen(shut), false);
	});
});
