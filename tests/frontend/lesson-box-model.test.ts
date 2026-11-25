/** The lesson's box: its keys, Enter, the way out and the Stuck? keys per state. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonBox, lessonIdeas, questionTurn, type BoxTurn } from "../../src/frontend/components/lesson/lesson-box-model.ts";
import { findPendingToolCall } from "../../src/shared/core/pending.ts";
import { projectView, withOpenReview } from "../../src/shared/core/view.ts";
import type { ReviewQuestion } from "../../src/shared/core/contracts/chat.ts";
import { call } from "../stop-fixtures.ts";

const box = (turn: BoxTurn, over: Partial<Parameters<typeof lessonBox>[0]> = {}) => lessonBox({ teacher: "Teacher", busy: false, hasText: false, hasFiles: false, turn, ...over });
type Box = ReturnType<typeof box>;
/** The key that answers (Submit answer), and the key that sends the box's words (Send, or the ask key). */
const submit = (view: Box) => view.keys.find((k) => k.action === "submit")!;
const send = (view: Box) => view.keys.find((k) => k.action === "send")!;

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
	it("one Send for work and questions alike, once there is something; Discard beside Your turn", () => {
		const empty = box({ kind: "problem", picked: false });
		assert.equal(empty.placeholder, "Your work or a question");
		assert.deepEqual(empty.keys, [{ action: "send", label: "Send", filled: false, disabled: true }]);
		assert.equal(empty.enter, null);
		assert.deepEqual(box({ kind: "problem", picked: false }, { hasText: true }).keys, [{ action: "send", label: "Send", filled: true, disabled: false }]);
		assert.equal(box({ kind: "problem", picked: false }, { hasFiles: true }).enter, "send", "a picture alone is work");
	});

	it("a pick among the problem's choices is enough to send", () => {
		assert.deepEqual(box({ kind: "problem", picked: true }).keys, [{ action: "send", label: "Send", filled: true, disabled: false }]);
		assert.equal(box({ kind: "problem", picked: true }).enter, "send");
	});

	it("while the teacher writes, words and picks steer the reply; files wait", () => {
		assert.equal(send(box({ kind: "problem", picked: false }, { hasText: true, busy: true })).disabled, false);
		assert.equal(box({ kind: "problem", picked: true }, { busy: true }).enter, "send");
		const withFile = box({ kind: "problem", picked: false }, { hasText: true, hasFiles: true, busy: true });
		assert.equal(send(withFile).disabled, true, "a steer carries no files");
		assert.equal(withFile.enter, null);
	});
});

describe("lessonIdeas, the Try asking lines", () => {
	it("four lines; a background job switched off in Settings takes its line with it", () => {
		assert.deepEqual(lessonIdeas({}), ["Draw it", "Show a demo", "Look it up", "Quiz me"]);
		assert.deepEqual(lessonIdeas({ demo: true, research: true }), lessonIdeas({}), "a job not named is on");
		assert.deepEqual(lessonIdeas({ demo: false, research: false }), ["Draw it", "Quiz me"]);
		assert.deepEqual(lessonIdeas({ visual: false, demo: false, research: false }), ["Quiz me"]);
	});
});

describe("lessonBox, nothing waiting", () => {
	it("one key that asks the teacher, by its name; no way out and no Stuck? keys", () => {
		const empty = box({ kind: "ask", nextKey: false });
		assert.equal(empty.placeholder, "Your question");
		assert.deepEqual(empty.keys, [{ action: "send", label: "Ask Teacher", filled: false, disabled: true }]);
		assert.equal(empty.enter, null);
		assert.equal(empty.help, null);
		assert.equal(empty.attach, true);
		assert.equal(send(box({ kind: "ask", nextKey: false }, { teacher: "Marco" })).label, "Ask Marco");
	});

	it("is the bright key once there is something to send, unless the next key shows above it", () => {
		assert.deepEqual(send(box({ kind: "ask", nextKey: false }, { hasText: true })), { action: "send", label: "Ask Teacher", filled: true, disabled: false });
		assert.equal(box({ kind: "ask", nextKey: false }, { hasFiles: true }).enter, "send", "a picture alone can be asked about");
		const beside = box({ kind: "ask", nextKey: true }, { hasText: true });
		assert.equal(send(beside).filled, false, "the next key stays the sheet's bright key");
		assert.equal(send(beside).disabled, false);
		assert.equal(beside.enter, "send");
	});

	it("while the teacher writes, words steer the reply; files wait", () => {
		const steer = box({ kind: "ask", nextKey: false }, { teacher: "Claude", busy: true });
		assert.equal(steer.placeholder, "Tell Claude what to focus on");
		assert.deepEqual(send(steer), { action: "send", label: "Send", filled: false, disabled: true });
		assert.equal(steer.attach, false, "a steer carries no files, so none can be added");
		assert.equal(send(box({ kind: "ask", nextKey: false }, { hasText: true, busy: true })).disabled, false);
		assert.equal(box({ kind: "ask", nextKey: false }, { hasText: true, busy: true }).enter, "send");
		assert.equal(send(box({ kind: "ask", nextKey: false }, { hasText: true, hasFiles: true, busy: true })).disabled, true, "a steer carries no files");
		assert.equal(send(box({ kind: "ask", nextKey: false }, { hasFiles: true, busy: true })).disabled, true);
	});
});

describe("lessonBox, the Attach button", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e" };
	const ask = { question: "q", options: [{ label: "a" }, { label: "b" }] };

	it("shows only where what is sent carries the files", () => {
		assert.equal(box({ kind: "problem", picked: false }).attach, true, "work is sent with its files");
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
	it("two keys in every question state: the ask key, then Submit answer; one is bright, the ask key only when Enter asks", () => {
		const turns: BoxTurn[] = [{ kind: "choice", picked: false }, { kind: "choice", picked: true }, { kind: "choice", picked: true, ownAnswer: true }, { kind: "written", takesFiles: true }];
		for (const turn of turns) {
			for (const over of [{}, { hasText: true }, { busy: true, hasText: true }]) {
				const view = box(turn, over);
				assert.deepEqual(view.keys.map((k) => k.label), ["Ask Teacher", "Submit answer"]);
				assert.deepEqual(view.keys.map((k) => k.filled), view.enter === "send" ? [true, false] : [false, true]);
			}
		}
	});

	it("an ask with choices: the box text is its own answer until a pick, then reasoning", () => {
		assert.equal(box({ kind: "choice", picked: false, ownAnswer: true }).placeholder, "An answer or a question");
		assert.equal(submit(box({ kind: "choice", picked: true, ownAnswer: true }, { hasText: true })).disabled, false);
		assert.equal(box({ kind: "choice", picked: true, ownAnswer: true }).placeholder, "Your reasoning or a question", "with a pick the text is reasoning");
		assert.equal(box({ kind: "choice", picked: true, ownAnswer: true }, { hasText: true }).enter, "submit");
	});

	it("choices: words with nothing picked can only be a question; with a pick Enter submits them as reasoning", () => {
		const empty = box({ kind: "choice", picked: false });
		assert.equal(empty.placeholder, "Your reasoning or a question");
		assert.equal(submit(empty).disabled, true);
		assert.equal(send(empty).disabled, true, "nothing to ask yet");
		assert.equal(empty.enter, null);

		const asking = box({ kind: "choice", picked: false }, { hasText: true });
		assert.equal(send(asking).disabled, false);
		assert.equal(submit(asking).disabled, true);
		assert.equal(asking.enter, "send");
		assert.deepEqual([send(asking).filled, submit(asking).filled], [true, false], "the bright key is the one Enter presses");
		assert.deepEqual([send(empty).filled, submit(empty).filled], [false, true]);
		const busy = box({ kind: "choice", picked: false }, { hasText: true, busy: true });
		assert.equal(send(busy).disabled, true, "a question beside the open one waits for the teacher");
		assert.equal(busy.enter, null);

		const picked = box({ kind: "choice", picked: true }, { hasText: true });
		assert.equal(submit(picked).disabled, false);
		assert.equal(send(picked).disabled, false, "the words can still be asked instead");
		assert.equal(picked.enter, "submit");
		assert.equal(send(box({ kind: "choice", picked: true })).disabled, true);
	});

	it("written: the box text is the answer, or a question through the ask key", () => {
		const empty = box({ kind: "written", takesFiles: true });
		assert.equal(empty.placeholder, "An answer or a question");
		assert.equal(submit(empty).disabled, true);
		assert.equal(send(empty).disabled, true);
		const typed = box({ kind: "written", takesFiles: true }, { hasText: true });
		assert.equal(typed.enter, "submit");
		assert.equal(send(typed).disabled, false);
		assert.equal(submit(box({ kind: "written", takesFiles: true }, { hasFiles: true })).disabled, false, "a picture can be the answer");
		assert.equal(submit(box({ kind: "written", takesFiles: false }, { hasFiles: true })).disabled, true);
	});

	it("teacher writing over a question: nothing submits or asks, Skip question stays", () => {
		const view = box({ kind: "choice", picked: true }, { busy: true, hasText: true });
		assert.equal(submit(view).disabled, true);
		assert.equal(send(view).disabled, true);
		assert.equal(view.enter, null);
	});
});

describe("lessonBox, the opener the app posed", () => {
	const quiz = { question: "q", options: [{ label: "a" }, { label: "b" }], correctAnswer: "a", explanation: "e", type: "predict" };

	it("is a choice marked as the app's", () => {
		assert.deepEqual(questionTurn("quiz", quiz, false, "opener"), { kind: "choice", picked: false, appPosed: "opener" });
	});

	it("keeps Skip question while a turn runs; Submit waits for the teacher", () => {
		const view = box(questionTurn("quiz", quiz, true, "opener"), { busy: true, hasText: true });
		assert.equal(submit(view).disabled, true);
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
		assert.equal(submit(busy).disabled, false);
		assert.equal(busy.enter, "submit");
		assert.equal(submit(box(questionTurn("quiz", quiz, false, "review"), { busy: true })).disabled, true, "nothing picked");
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

	it("while the teacher writes all wait, except I don't know on a question from earlier, which goes in like Submit", () => {
		assert.deepEqual(box(questionTurn("quiz", quiz, false), { busy: true }).help, { dontKnow: "answer", dontKnowDisabled: true, linesDisabled: true });
		assert.deepEqual(box(questionTurn("quiz", quiz, false, "opener"), { busy: true }).help, { dontKnow: "answer", dontKnowDisabled: true, linesDisabled: true });
		assert.deepEqual(box(questionTurn("quiz", quiz, false, "review"), { busy: true }).help, { dontKnow: "answer", dontKnowDisabled: false, linesDisabled: true });
	});
});

describe("lessonBox, a My words ask", () => {
	it("the key that ends the day comes first, Save is the main key once the words fit", () => {
		const ready = box({ kind: "words", ready: true, leave: "Done for today" }).keys;
		assert.deepEqual(ready.map((k) => [k.action, k.filled]), [["leave", false], ["skip", false], ["save", true]]);
		assert.equal(box({ kind: "words", ready: false, leave: null }).keys.some((k) => k.action === "leave"), false);
	});
});
