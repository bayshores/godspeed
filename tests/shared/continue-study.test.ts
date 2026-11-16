import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadlineStudyLabel, studyLabel } from "../../src/shared/core/continue-study.ts";

describe("studyLabel", () => {
	it("Study, or Continue once a session for the deadline started", () => {
		assert.equal(studyLabel(undefined), "Study");
		assert.equal(studyLabel({ chatId: "c", done: 2, total: 4 }), "Continue");
		assert.equal(studyLabel({ chatId: "c" }), "Continue");
	});
});

describe("deadlineStudyLabel", () => {
	it("names the deadline, with done of total topics once a session started", () => {
		assert.equal(deadlineStudyLabel(undefined, "Midterm"), "Study for Midterm");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 0, total: 4 }, "Midterm"), "Continue studying for Midterm, 0 of 4 topics");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 0, total: 1 }, "Quiz"), "Continue studying for Quiz, 0 of 1 topic");
		// No plan yet: nothing to count.
		assert.equal(deadlineStudyLabel({ chatId: "c" }, "Midterm"), "Continue studying for Midterm");
	});
});
