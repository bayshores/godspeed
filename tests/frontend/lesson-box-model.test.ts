/** The lesson's one writing box: buttons, Enter and the way out per state. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonBox, questionTurn, type BoxTurn } from "../../src/frontend/components/lesson/lesson-box-model.ts";

const box = (turn: BoxTurn, over: Partial<Parameters<typeof lessonBox>[0]> = {}) =>
	lessonBox({ name: "marco", busy: false, waitingForAgent: false, hasText: false, hasFiles: false, turn, ...over });

describe("questionTurn", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" };

	it("choices are picked above the box", () => {
		assert.deepEqual(questionTurn("quiz", quiz, false), { kind: "choice", picked: false });
		assert.deepEqual(questionTurn("quiz", quiz, true), { kind: "choice", picked: true });
		assert.deepEqual(questionTurn("ask_user_question", { question: "q", options: [{ label: "a" }, { label: "b" }] }, true), { kind: "choice", picked: true });
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

describe("lessonBox, nothing to answer", () => {
	it("idle: one Send, filled once there is something to send", () => {
		const empty = box({ kind: "none" });
		assert.equal(empty.placeholder, "Message marco");
		assert.equal(empty.left, null);
		assert.deepEqual(empty.right, { action: "send", label: "Send", filled: false, disabled: true });
		assert.equal(empty.enter, null);
		assert.equal(empty.exit, null);

		const typed = box({ kind: "none" }, { hasText: true });
		assert.deepEqual(typed.right, { action: "send", label: "Send", filled: true, disabled: false });
		assert.equal(typed.enter, "send");
		assert.equal(box({ kind: "none" }, { hasFiles: true }).enter, "send", "files alone can be sent");
	});

	it("between problems: Send moves left, the go-ahead is the main button", () => {
		const pause = box({ kind: "none", next: "Next problem" });
		assert.deepEqual(pause.left, { action: "send", label: "Send", filled: false, disabled: true });
		assert.deepEqual(pause.right, { action: "next", label: "Next problem", filled: true, disabled: false });
		assert.equal(pause.enter, "next", "Enter in an empty box moves on");
		assert.equal(box({ kind: "none", next: "Continue" }, { hasText: true }).enter, "send", "typing makes Enter a send again");
	});

	it("teacher writing: typed text steers, an empty Enter stops", () => {
		const empty = box({ kind: "none" }, { busy: true });
		assert.deepEqual(empty.right, { action: "send", label: "Send when ready", filled: false, disabled: true });
		assert.equal(empty.enter, "stop");
		assert.equal(empty.exit, "stop");

		const typed = box({ kind: "none" }, { busy: true, hasText: true });
		assert.equal(typed.right.disabled, false);
		assert.equal(typed.enter, "send");
	});

	it("teacher writing with files waiting: no steer, no stop, and a note", () => {
		const files = box({ kind: "none" }, { busy: true, hasFiles: true });
		assert.equal(files.enter, null);
		assert.equal(files.right.disabled, true);
		assert.equal(files.note, "Send pictures after the teacher finishes");
		assert.equal(box({ kind: "none" }, { busy: true, hasFiles: true, hasText: true }).enter, null, "a steer carries no files");
	});

	it("busy outranks the pause", () => {
		const view = box({ kind: "none", next: "Next problem" }, { busy: true });
		assert.equal(view.left, null);
		assert.equal(view.enter, "stop");
		assert.equal(view.right.action, "send");
	});

	it("waiting for an agent: plain Send", () => {
		assert.equal(box({ kind: "none" }, { busy: true, waitingForAgent: true }).right.label, "Send");
	});
});

describe("lessonBox, a problem", () => {
	it("one Send for the work, Discard beside Your turn", () => {
		const view = box({ kind: "problem" }, { hasText: true });
		assert.equal(view.placeholder, "Message marco, or type your work");
		assert.equal(view.left, null);
		assert.deepEqual(view.right, { action: "send", label: "Send", filled: true, disabled: false });
		assert.equal(view.exit, "discard");
		assert.equal(box({ kind: "problem" }, { busy: true }).exit, "stop");
	});
});

describe("lessonBox, a question", () => {
	it("read first: the box holds thoughts, Enter opens the check", () => {
		const view = box({ kind: "read-first" });
		assert.equal(view.placeholder, "Whatever comes to mind as you read.");
		assert.deepEqual(view.left, { action: "send", label: "Ask marco", filled: false, disabled: true });
		assert.deepEqual(view.right, { action: "reveal", label: "Check your understanding", filled: true, disabled: false });
		assert.equal(view.enter, "reveal");
		assert.equal(view.exit, "skip");
	});

	it("choices: Submit waits for a pick; the box text is reasoning or a question", () => {
		const open = box({ kind: "choice", picked: false }, { hasText: true });
		assert.equal(open.placeholder, "Your reasoning, or a question for marco");
		assert.equal(open.right.label, "Submit answer");
		assert.equal(open.right.disabled, true);
		assert.equal(open.left?.disabled, false, "the text can be asked");
		assert.equal(open.enter, null, "Enter never sends a question by itself");

		const picked = box({ kind: "choice", picked: true });
		assert.equal(picked.right.disabled, false);
		assert.equal(picked.enter, "submit");
		assert.equal(picked.exit, "skip");
	});

	it("written: the box text is the answer", () => {
		const empty = box({ kind: "written", takesFiles: true });
		assert.equal(empty.placeholder, "Type your answer, or a question for marco");
		assert.equal(empty.right.disabled, true);
		assert.equal(box({ kind: "written", takesFiles: true }, { hasText: true }).enter, "submit");
		assert.equal(box({ kind: "written", takesFiles: true }, { hasFiles: true }).right.disabled, false, "a picture can be the answer");
		assert.equal(box({ kind: "written", takesFiles: false }, { hasFiles: true }).right.disabled, true);
	});

	it("teacher writing over a question: nothing submits or asks, Stop is the way out", () => {
		const view = box({ kind: "choice", picked: true }, { busy: true, hasText: true });
		assert.equal(view.right.disabled, true);
		assert.equal(view.left?.disabled, true);
		assert.equal(view.exit, "stop");
		assert.equal(view.enter, null);
		assert.equal(box({ kind: "choice", picked: true }, { busy: true }).enter, "stop");
	});
});

describe("lessonBox at a stop", () => {
	it("has no way out beside Your turn, idle or while the teacher reads ahead", () => {
		const idle = box({ kind: "stop" });
		assert.equal(idle.exit, null);
		assert.equal(idle.placeholder, "Message marco");
		assert.deepEqual(idle.right, { action: "send", label: "Send", filled: false, disabled: true });
		const busy = box({ kind: "stop" }, { busy: true });
		assert.equal(busy.exit, null);
		assert.equal(busy.enter, null, "Enter in an empty box never stops the reading");
		assert.deepEqual(busy.right, { action: "send", label: "Send when ready", filled: false, disabled: true });
		assert.equal(box({ kind: "stop" }, { busy: true, hasText: true }).enter, "send", "a typed question waits as a steer");
	});
});

describe("lessonBox, the opener the app posed", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e", type: "predict" };

	it("is a choice marked as the app's", () => {
		assert.deepEqual(questionTurn("quiz", quiz, false, true), { kind: "choice", picked: false, appPosed: true });
	});

	it("keeps Skip question and Ask Teacher while a turn runs; Ask and Submit wait for the teacher", () => {
		const view = box(questionTurn("quiz", quiz, true, true), { busy: true, hasText: true });
		assert.equal(view.exit, "skip");
		assert.equal(view.left?.label, "Ask marco");
		assert.equal(view.left?.disabled, true);
		assert.equal(view.right.disabled, true);
		assert.equal(box(questionTurn("quiz", quiz, false, true), { busy: true }).enter, null);
		assert.equal(box(questionTurn("quiz", quiz, true, true)).exit, "skip");
	});
});
