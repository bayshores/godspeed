import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	EMPTY_LESSON_DRAFT,
	holdsDraft,
	parseLessonDraft,
	serializeLessonDraft,
	withComposer,
	withoutSettled,
	withProblem,
	withQuestion,
} from "../src/components/lesson/lesson-drafts-model.ts";
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

	it("holds Follow only for unsent text the lesson shows now", () => {
		const d = withProblem(withQuestion(EMPTY_LESSON_DRAFT, "q1", { form }), "p1", "work");
		assert.equal(holdsDraft(d, { questionId: "q1", problemId: null }), true);
		assert.equal(holdsDraft(d, { questionId: null, problemId: "p1" }), true);
		assert.equal(holdsDraft(d, { questionId: "q2", problemId: null }), false);
		assert.equal(holdsDraft(withComposer(EMPTY_LESSON_DRAFT, "   "), { questionId: null, problemId: null }), false);
		assert.equal(holdsDraft(withComposer(EMPTY_LESSON_DRAFT, "hey"), { questionId: null, problemId: null }), true);
	});
});
