/** The lesson's answer box: its size, button, Enter, the way out and the Stuck? keys per state. */
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
		const empty = box({ kind: "problem", picked: false });
		assert.equal(empty.placeholder, "Your work");
		assert.deepEqual(empty.button, { action: "send", label: "Send", filled: false, disabled: true });
		assert.equal(empty.enter, null);
		assert.equal(empty.exit, "discard");
		assert.deepEqual(box({ kind: "problem", picked: false }, { hasText: true }).button, { action: "send", label: "Send", filled: true, disabled: false });
		assert.equal(box({ kind: "problem", picked: false }, { hasFiles: true }).enter, "send", "a picture alone is work");
		assert.equal(box({ kind: "problem", picked: false }, { hasText: true, busy: true }).button.disabled, true, "work waits for the teacher");
		assert.equal(box({ kind: "problem", picked: false }, { busy: true }).exit, "discard");
	});

	it("a pick among the problem's choices is enough to send, once the teacher is free", () => {
		assert.deepEqual(box({ kind: "problem", picked: true }).button, { action: "send", label: "Send", filled: true, disabled: false });
		assert.equal(box({ kind: "problem", picked: true }).enter, "send");
		assert.equal(box({ kind: "problem", picked: true }, { busy: true }).button.disabled, true);
	});
});

describe("lessonBox, the Attach button", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" };
	const ask = { question: "q", options: [{ label: "a" }, { label: "b" }] };

	it("shows only where what is sent carries the files", () => {
		assert.equal(box({ kind: "problem", picked: false }).attach, true, "work is sent with its files");
		assert.equal(box({ kind: "read-first" }).attach, false, "Check your understanding sends nothing");
		assert.equal(box(questionTurn("explain", { question: "why?", correctAnswer: "because" }, false)).attach, true, "a written answer");
		assert.equal(box(questionTurn("ask_user_question", { question: "what next?" }, false)).attach, true, "an open ask");
		assert.equal(box(questionTurn("ask_user_question", ask, true)).attach, true, "an ask with choices takes its own answer");
		assert.equal(box(questionTurn("quiz", quiz, true)).attach, false, "a quiz answer drops files");
		assert.equal(box(questionTurn("write_code", { question: "q" }, true)).attach, false, "a code answer drops files");
	});

	it("is hidden for an answer the app asked for, which is sent without files", () => {
		assert.equal(box(questionTurn("quiz", quiz, true, "opener")).attach, false);
		assert.equal(box(questionTurn("quiz", quiz, true, "review")).attach, false);
		assert.equal(box(questionTurn("explain", { question: "why?", correctAnswer: "because" }, false, "review")).attach, false);
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
		assert.equal(box({ kind: "choice", picked: true, ownAnswer: true }).placeholder, "Your reasoning (optional)", "with a pick the text is reasoning");
	});

	it("choices: Submit waits for a pick; the box text is reasoning", () => {
		const open = box({ kind: "choice", picked: false }, { hasText: true });
		assert.equal(open.placeholder, "Your reasoning (optional)");
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

describe("lessonBox, the box's size", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" };

	it("one line where the text is optional: choices, code and reading first", () => {
		assert.equal(box(questionTurn("quiz", quiz, false)).size, "line");
		assert.equal(box(questionTurn("ask_user_question", { question: "q", options: [{ label: "a" }, { label: "b" }] }, false)).size, "line", "an ask's own answer");
		assert.equal(box(questionTurn("write_code", { question: "q" }, true)).size, "line");
		assert.equal(box({ kind: "read-first" }).size, "line");
	});

	it("three lines where the text is the answer or the work", () => {
		assert.equal(box(questionTurn("explain", { question: "why?", correctAnswer: "because" }, false)).size, "lines");
		assert.equal(box(questionTurn("ask_user_question", { question: "what next?" }, false)).size, "lines", "an open ask");
		assert.equal(box({ kind: "problem", picked: false }).size, "lines");
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

describe("lessonBox, the Stuck? keys", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" };
	const free = { dontKnow: "answer", dontKnowDisabled: false, linesDisabled: false };

	it("a waiting question: I don't know answers it, the other two are lines to the teacher", () => {
		assert.deepEqual(box(questionTurn("quiz", quiz, false)).help, free);
		assert.deepEqual(box(questionTurn("explain", { question: "why?", correctAnswer: "because" }, false)).help, free, "a written answer");
		assert.deepEqual(box(questionTurn("ask_user_question", { question: "q", options: [{ label: "a" }, { label: "b" }] }, true)).help, free, "with a pick");
		assert.deepEqual(box(questionTurn("write_code", { question: "q" }, false)).help, free);
		assert.deepEqual(box(questionTurn("quiz", quiz, false, "opener")).help, free, "the next topic's opener");
	});

	it("an open problem: all three are lines to the teacher, and the problem stays open", () => {
		assert.deepEqual(box({ kind: "problem", picked: false }).help, { dontKnow: "send", dontKnowDisabled: false, linesDisabled: false });
		assert.deepEqual(box({ kind: "problem", picked: false }, { busy: true }).help, { dontKnow: "send", dontKnowDisabled: true, linesDisabled: true });
	});

	it("none while reading first", () => {
		assert.equal(box({ kind: "read-first" }).help, null);
	});

	it("while the teacher writes all wait, except I don't know on a question from earlier, which goes in like Submit", () => {
		assert.deepEqual(box(questionTurn("quiz", quiz, false), { busy: true }).help, { dontKnow: "answer", dontKnowDisabled: true, linesDisabled: true });
		assert.deepEqual(box(questionTurn("quiz", quiz, false, "opener"), { busy: true }).help, { dontKnow: "answer", dontKnowDisabled: true, linesDisabled: true });
		assert.deepEqual(box(questionTurn("quiz", quiz, false, "review"), { busy: true }).help, { dontKnow: "answer", dontKnowDisabled: false, linesDisabled: true });
	});
});
