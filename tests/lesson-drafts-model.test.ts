import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	EMPTY_LESSON_DRAFT,
	holdsDraft,
	parseLessonDraft,
	serializeLessonDraft,
	withComposer,
	withoutEndedQuestions,
	withoutSettled,
	withProblem,
	withQuestion,
} from "../src/components/lesson/lesson-drafts-model.ts";
import { forgetLessonDraft } from "../src/components/lesson/use-lesson-drafts.ts";
import { newAnswerResult, type LhMessage, type QuestionAnswerData, type QuestionFormDraft } from "../src/core/index.ts";

const form: QuestionFormDraft = { selection: { selected: new Set([1]), otherSelected: true, dontKnow: false }, thinking: "reasoning", other: "custom answer", text: "", confidenceIndex: 4 };
const answer = { dontKnow: true } as unknown as QuestionAnswerData;

describe("lesson drafts", () => {
	it("keeps each channel by its own id and drops what becomes empty", () => {
		let d = withComposer(EMPTY_LESSON_DRAFT, "half a message");
		d = withQuestion(d, "q1", { form });
		d = withQuestion(d, "q1", { readingThinking: "noted while reading" });
		d = withProblem(d, "p1", "my work");
		assert.deepEqual(d.questions.q1, { form, readingThinking: "noted while reading" });
		assert.equal(d.questions.q2, undefined, "a different question never inherits the draft");
		assert.equal(d.problems.p1, "my work");
		const empty = { selection: { selected: new Set<number>(), otherSelected: false, dontKnow: false }, thinking: " ", other: "", text: "" };
		d = withQuestion(d, "q1", { form: empty, readingThinking: "" });
		d = withProblem(d, "p1", "  ");
		assert.deepEqual(d.questions, {});
		assert.deepEqual(d.problems, {});
	});

	it("survives storage: the selection Set round-trips, garbage reads as empty", () => {
		const d = withProblem(withQuestion(withComposer(EMPTY_LESSON_DRAFT, "hi"), "q1", { form, readingThinking: "r" }), "p1", "work");
		const back = parseLessonDraft(serializeLessonDraft(d));
		assert.deepEqual(back, d);
		assert.ok(back.questions.q1!.form!.selection.selected instanceof Set);
		assert.equal(serializeLessonDraft(EMPTY_LESSON_DRAFT), null, "nothing to keep removes the key");
		assert.deepEqual(parseLessonDraft("{not json"), EMPTY_LESSON_DRAFT);
		assert.deepEqual(parseLessonDraft(null), EMPTY_LESSON_DRAFT);
		assert.deepEqual(parseLessonDraft('{"questions":{"q1":{"form":{"selection":"bad"}}},"problems":{"p1":3}}'), EMPTY_LESSON_DRAFT);
	});

	it("drops a question only once the server saved its answer, and a problem once it is no longer active", () => {
		const d = withProblem(withQuestion(EMPTY_LESSON_DRAFT, "q1", { form }), "p1", "work");
		const optimistic = { ...newAnswerResult("q1", "quiz", answer), id: "c_local_1" } as LhMessage;
		assert.equal(withoutSettled(d, [optimistic], "p1"), d, "this window's optimistic answer is not confirmed yet");
		const saved = newAnswerResult("q1", "quiz", answer) as LhMessage;
		const next = withoutSettled(d, [saved], "p1");
		assert.deepEqual(next.questions, {});
		assert.equal(next.problems.p1, "work");
		assert.deepEqual(withoutSettled(d, [], null).problems, {}, "a discarded or finished problem's draft goes");
	});

	it("read back, keeps only the question the saved record still waits on", () => {
		const asks = (id: string, callId: string, stopReason = "toolUse") =>
			({ id, role: "assistant", stopReason, content: [{ type: "toolCall", id: callId, name: "quiz", arguments: {} }] }) as unknown as LhMessage;
		const d = withQuestion(withQuestion(withQuestion(EMPTY_LESSON_DRAFT, "skipped", { form }), "stopped", { form }), "open", { form });
		const record = [
			asks("a1", "skipped"),
			newAnswerResult("skipped", "quiz", { ...answer, dismissed: true }) as LhMessage,
			asks("a2", "stopped", "aborted"),
			{ id: "a3", role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Let's go on." }] } as unknown as LhMessage,
			asks("a4", "open"),
		];
		assert.deepEqual(Object.keys(withoutEndedQuestions(d, record).questions), ["open"]);
		assert.deepEqual(withoutEndedQuestions(d, record.slice(0, 4)).questions, {}, "nothing waits: every question draft goes");
		const kept = withQuestion(EMPTY_LESSON_DRAFT, "open", { form });
		assert.equal(withoutEndedQuestions(kept, record), kept);
	});

	it("a deleted lesson's saved drafts are removed", () => {
		const store = new Map([["lh:lesson-draft:l1", "{}"], ["lh:lesson-draft:l2", "{}"]]);
		(globalThis as { localStorage?: unknown }).localStorage = { removeItem: (k: string) => store.delete(k) };
		try {
			forgetLessonDraft("l1");
			assert.deepEqual([...store.keys()], ["lh:lesson-draft:l2"]);
		} finally {
			delete (globalThis as { localStorage?: unknown }).localStorage;
		}
		assert.doesNotThrow(() => forgetLessonDraft("l2"), "no storage: nothing to remove");
	});

	it("holds Follow only for unsent text the lesson shows now", () => {
		const d = withProblem(withQuestion(EMPTY_LESSON_DRAFT, "q1", { form }), "p1", "work");
		assert.equal(holdsDraft(d, { questionId: "q1", problemId: null }), true);
		assert.equal(holdsDraft(d, { questionId: null, problemId: "p1" }), true);
		assert.equal(holdsDraft(d, { questionId: "q2", problemId: null }), false);
		assert.equal(holdsDraft(withComposer(EMPTY_LESSON_DRAFT, "   "), { questionId: null, problemId: null }), false);
		assert.equal(holdsDraft(withComposer(EMPTY_LESSON_DRAFT, "hey"), { questionId: null, problemId: null }), true);
	});
});
