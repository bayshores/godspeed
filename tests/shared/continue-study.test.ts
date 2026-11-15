import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadlineStudyLabel } from "../../src/shared/core/continue-study.ts";

describe("deadlineStudyLabel", () => {
	it("Study, or Continue studying with done of total topics", () => {
		assert.equal(deadlineStudyLabel(undefined, "Midterm"), "Study for Midterm");
		assert.equal(deadlineStudyLabel(undefined), "Study");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 0, total: 4 }, "Midterm"), "Continue studying for Midterm, 0 of 4 topics");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 2, total: 4 }), "Continue studying, 2 of 4 topics");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 0, total: 1 }), "Continue studying, 0 of 1 topic");
	});
});
