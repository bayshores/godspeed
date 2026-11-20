/** "Your turn" with nothing to answer: what is next, its key and what the key does, what stays while the teacher writes, and where the sheet is drawn. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastAnswered, turnDrawn, turnNext, turnShown } from "../../src/frontend/components/lesson/turn-next-model.ts";
import { dismissedAnswer, projectView, type LessonStop, type LhMessage, type QuestionAnswerData } from "../../src/shared/core/index.ts";
import { call, CONCLUDE_SOLVED, keepGoing, marker, OPENER_QUIZ, regularizationEnds, result, text, userText } from "../stop-fixtures.ts";

const stop: LessonStop = { kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "reg", stopOf: "c1", next: "Cross-validation", activeMinutes: 48, keptGoing: false };
const idle = { stop: null, homework: false, goLabel: "Continue", busy: false, error: false, nothingWritten: false };

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
		assert.deepEqual(turnNext({ ...idle, homework: true, goLabel: "Start problem 4", stop: { ...problem, next: "problem 4" } }), { line: null, key: { label: "Start problem 4", action: "keep-going" } });
	});

	it("the last topic ends the day", () => {
		assert.deepEqual(turnNext({ ...idle, stop: { ...stop, kind: "end", next: null } }), { line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" } });
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
	const answered = { toolCallId: "q1", answer: { kind: "quiz", questionText: "Which?", dontKnow: false, answers: [], answeredAt: "2026-11-19T10:00:00Z" } as QuestionAnswerData };

	it("shows the next state whenever there is one, even right after an answer", () => {
		assert.deepEqual(turnShown({ next, answered, lastLine: null }), { kind: "next", next, dim: false });
	});

	it("while the teacher writes: the question just answered, else the last next line dimmed with no key", () => {
		assert.deepEqual(turnShown({ next: null, answered, lastLine: "Old line." }), { kind: "answered", answered });
		assert.deepEqual(turnShown({ next: null, answered: null, lastLine: "Old line." }), { kind: "next", next: { line: "Old line.", key: null }, dim: true });
	});
});

describe("lastAnswered", () => {
	const QUIZ = { question: "Which planet is closest to the sun?", options: [{ label: "Venus" }, { label: "Mercury" }], correctAnswer: "Mercury", explanation: "Innermost." };
	const answer = (picked: string): QuestionAnswerData => ({
		kind: "quiz",
		questionText: QUIZ.question,
		options: [{ index: 1, label: "Venus" }, { index: 2, label: "Mercury" }],
		dontKnow: false,
		answers: [{ index: picked === "Venus" ? 1 : 2, label: picked, value: picked }],
		correctIndices: [2],
		correct: picked === "Mercury",
		answeredAt: "2026-11-19T10:00:00Z",
	});
	const asked = [text("t0", "The planets, in order.", 1), call("q1", "quiz", QUIZ, 2)];
	const of = (record: LhMessage[]) => lastAnswered(record, projectView(record));

	it("is the question he answered, as its card reads it, while the teacher writes on after it", () => {
		const record = [...asked, result("q1", "quiz", answer("Venus"), 3), text("t1", "Not quite.", 4), call("g1", "grep", {}, 4), result("g1", "grep", null, 4)];
		const shown = of(record);
		assert.equal(shown?.toolCallId, "q1");
		assert.equal(shown?.answer.answers[0]?.label, "Venus");
		assert.equal(shown?.answer.questionText, QUIZ.question);
	});

	it("is a skipped question too", () => {
		const record = [...asked, result("q1", "quiz", { ...dismissedAnswer("quiz", QUIZ.question), answeredAt: "2026-11-19T10:00:00Z" }, 3)];
		assert.equal(of(record)?.answer.dismissed, true);
	});

	it("is null once he did something else since: a line, Keep going, the next problem", () => {
		const answered = [...asked, result("q1", "quiz", answer("Mercury"), 3)];
		assert.equal(of([...answered, userText("u1", "Why?", 4)]), null);
		assert.equal(of([...answered, keepGoing("c1", 4)]), null);
		assert.equal(of([...answered, marker("n1", "practice-next", {}, 4)]), null);
		assert.equal(of([text("t0", "Hi.", 1)]), null, "nothing answered yet");
	});

	it("skips what the learner did not do: a refused question call and the app's own notes", () => {
		const record = [...asked, result("q1", "quiz", answer("Venus"), 3), call("q2", "quiz", { question: "Bad" }, 4), result("q2", "quiz", null, 4, true), marker("a1", "app-note", {}, 5)];
		assert.equal(of(record)?.toolCallId, "q1");
	});

	it("finds an opener's answer in the view, where the opener's question lives", () => {
		const record = [...regularizationEnds(), keepGoing("c1", 50), marker("oa1", "opener-answer", { topicDoneCallId: "t1", answer: { ...answer("Mercury"), questionText: OPENER_QUIZ.question } }, 51)];
		assert.equal(of(record)?.toolCallId, "opener_t1");
		assert.equal(of([...regularizationEnds(), call("c2", "conclude", CONCLUDE_SOLVED, 52)]), null, "no question answered");
	});
});
