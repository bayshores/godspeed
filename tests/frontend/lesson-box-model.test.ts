/** The lesson's answer box: its button, Enter and the way out per state. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonBox, questionTurn, type BoxTurn } from "../../src/frontend/components/lesson/lesson-box-model.ts";
import { findPendingToolCall } from "../../src/shared/core/pending.ts";
import { projectView, withOpenReview } from "../../src/shared/core/view.ts";
import type { ReviewQuestion } from "../../src/shared/core/contracts/chat.ts";
import { call } from "../stop-fixtures.ts";

const box = (turn: BoxTurn, over: Partial<Parameters<typeof lessonBox>[0]> = {}) => lessonBox({ busy: false, hasText: false, hasFiles: false, turn, ...over });

describe("questionTurn", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" };

	it("choices are picked above the box", () => {
		assert.deepEqual(questionTurn("quiz", quiz, false), { kind: "choice", picked: false });
		assert.deepEqual(questionTurn("quiz", quiz, true), { kind: "choice", picked: true });
		assert.deepEqual(questionTurn("ask_user_question", { question: "q", options: [{ label: "a" }, { label: "b" }] }, true), { kind: "choice", picked: true, ownAnswer: true }, "an ask takes its own answer in the box");
	});

	it("an explain question and an open ask are written in the box", () => {
		assert.deepEqual(questionTurn("explain", { question: "why?", correctAnswer: "because" }, false), { kind: "written", takesFiles: true });
		assert.equal(questionTurn("ask_user_question", { question: "what next?" }, false).kind, "written");
	});

	it("a broken question is never ready to submit", () => {
		assert.deepEqual(questionTurn("explain", {}, true), { kind: "choice", picked: true });
		assert.deepEqual(questionTurn("ask_user_question", null, false), { kind: "choice", picked: false });
	});
});

describe("lessonBox, a problem", () => {
	it("one Send for the work, once there is some and the teacher is free; Discard beside Your turn", () => {
		const empty = box({ kind: "problem" });
		assert.equal(empty.placeholder, "Your work");
		assert.deepEqual(empty.button, { action: "send", label: "Send", filled: false, disabled: true });
		assert.equal(empty.enter, null);
		assert.equal(empty.exit, "discard");
		assert.deepEqual(box({ kind: "problem" }, { hasText: true }).button, { action: "send", label: "Send", filled: true, disabled: false });
		assert.equal(box({ kind: "problem" }, { hasFiles: true }).enter, "send", "a picture alone is work");
		assert.equal(box({ kind: "problem" }, { hasText: true, busy: true }).button.disabled, true, "work waits for the teacher");
		assert.equal(box({ kind: "problem" }, { busy: true }).exit, "discard");
	});
});

describe("lessonBox, a question", () => {
	it("read first: the box holds thoughts, Enter opens the check", () => {
		const view = box({ kind: "read-first" });
		assert.equal(view.placeholder, "Whatever comes to mind as you read.");
		assert.deepEqual(view.button, { action: "reveal", label: "Check your understanding", filled: true, disabled: false });
		assert.equal(view.enter, "reveal");
		assert.equal(view.exit, "skip");
	});

	it("an ask with choices: the box text is its own answer until a pick, then reasoning", () => {
		assert.equal(box({ kind: "choice", picked: false, ownAnswer: true }).placeholder, "Pick one above, or type your own answer");
		assert.equal(box({ kind: "choice", picked: true, ownAnswer: true }, { hasText: true }).button.disabled, false);
		assert.equal(box({ kind: "choice", picked: true, ownAnswer: true }).placeholder, "Your reasoning", "with a pick the text is reasoning");
	});

	it("choices: Submit waits for a pick; the box text is reasoning", () => {
		const open = box({ kind: "choice", picked: false }, { hasText: true });
		assert.equal(open.placeholder, "Your reasoning");
		assert.equal(open.button.label, "Submit answer");
		assert.equal(open.button.disabled, true);
		assert.equal(open.enter, null);

		const picked = box({ kind: "choice", picked: true });
		assert.equal(picked.button.disabled, false);
		assert.equal(picked.enter, "submit");
		assert.equal(picked.exit, "skip");
	});

	it("written: the box text is the answer", () => {
		const empty = box({ kind: "written", takesFiles: true });
		assert.equal(empty.placeholder, "Your answer");
		assert.equal(empty.button.disabled, true);
		assert.equal(box({ kind: "written", takesFiles: true }, { hasText: true }).enter, "submit");
		assert.equal(box({ kind: "written", takesFiles: true }, { hasFiles: true }).button.disabled, false, "a picture can be the answer");
		assert.equal(box({ kind: "written", takesFiles: false }, { hasFiles: true }).button.disabled, true);
	});

	it("teacher writing over a question: nothing submits, Skip question stays", () => {
		const view = box({ kind: "choice", picked: true }, { busy: true, hasText: true });
		assert.equal(view.button.disabled, true);
		assert.equal(view.enter, null);
		assert.equal(view.exit, "skip");
	});
});

describe("lessonBox, the opener the app posed", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e", type: "predict" };

	it("is a choice marked as the app's", () => {
		assert.deepEqual(questionTurn("quiz", quiz, false, "opener"), { kind: "choice", picked: false, appPosed: "opener" });
	});

	it("keeps Skip question while a turn runs; Submit waits for the teacher", () => {
		const view = box(questionTurn("quiz", quiz, true, "opener"), { busy: true, hasText: true });
		assert.equal(view.exit, "skip");
		assert.equal(view.button.disabled, true);
		assert.equal(box(questionTurn("quiz", quiz, false, "opener"), { busy: true }).enter, null);
	});
});

describe("lessonBox, a question from earlier", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" };
	const teacherQuiz = { ...quiz, question: "The teacher's?" };
	const fromEarlier: ReviewQuestion = { of: { chatId: "c_old", toolCallId: "rv1" }, nodeId: "bayes", topic: "Bayes' rule", quiz };
	const view = projectView([call("q1", "quiz", teacherQuiz, 1)]);

	it("shows first, then the teacher's question once it is answered or skipped", () => {
		const first = findPendingToolCall(withOpenReview(view, fromEarlier))!;
		assert.equal(first.toolCallId, "review_c_old_rv1");
		assert.deepEqual(questionTurn(first.tool, first.input, false, first.appPosed?.kind), { kind: "choice", picked: false, appPosed: "review" });
		const then = findPendingToolCall(withOpenReview(view, null))!;
		assert.equal(then.toolCallId, "q1");
		assert.equal(then.appPosed, undefined);
	});

	it("takes its answer while the teacher writes, and the way out stays Skip question", () => {
		const busy = box(questionTurn("quiz", quiz, true, "review"), { busy: true });
		assert.equal(busy.button.disabled, false);
		assert.equal(busy.enter, "submit");
		assert.equal(busy.exit, "skip");
		assert.equal(box(questionTurn("quiz", quiz, false, "review"), { busy: true }).button.disabled, true, "nothing picked");
	});
});
