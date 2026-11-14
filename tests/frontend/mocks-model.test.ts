/** A deadline's mocks on its page: which deadlines take them, when "Take a
 *  mock" is off, the mock box's numbers and what it sends. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MINUTES, QUESTIONS, clampTo, mockOffReason, mocksRemovedLine, newMockBody, takesMocks } from "../../src/frontend/components/deadline/mocks-model.ts";

describe("a deadline's mocks", () => {
	it("belong to tests and interviews, not to homework or projects", () => {
		assert.deepEqual((["exam", "quiz", "interview", "homework", "project"] as const).map(takesMocks), [true, true, true, false, false]);
	});
	it("are off, with the reason, only when there is nothing to write one from", () => {
		assert.equal(mockOffReason(true, false), null);
		assert.equal(mockOffReason(false, true), null);
		assert.equal(mockOffReason(false, false), "A mock is written from this deadline's study files or from what it's like, and it has neither yet.");
	});
	it("start at 5 questions and 45 minutes, kept in range as whole numbers", () => {
		assert.deepEqual([QUESTIONS.start, QUESTIONS.min, QUESTIONS.max], [5, 1, 10]);
		assert.deepEqual([MINUTES.start, MINUTES.min, MINUTES.max, MINUTES.step], [45, 5, 240, 5]);
		assert.equal(clampTo(QUESTIONS, 12, 5), 10);
		assert.equal(clampTo(QUESTIONS, 0, 5), 1);
		assert.equal(clampTo(MINUTES, 61.6, 45), 62);
		assert.equal(clampTo(MINUTES, Number.NaN, 45), 45, "nothing typed keeps the number");
	});
	it("are asked for with a time limit only when one was picked", () => {
		assert.deepEqual(newMockBody("ddl_1", 5, null), { deadlineId: "ddl_1", questions: 5 });
		assert.deepEqual(newMockBody("ddl_1", 3, 60), { deadlineId: "ddl_1", questions: 3, minutes: 60 });
	});
	it("go with their deadline, as its remove question says", () => {
		assert.equal(mocksRemovedLine(0), null);
		assert.equal(mocksRemovedLine(1), "Its mock is removed too.");
		assert.equal(mocksRemovedLine(3), "Its 3 mocks are removed too.");
	});
});
