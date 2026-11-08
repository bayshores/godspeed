import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { continueStudyFor, deadlineStudyLabel, type DeadlineSession } from "../../src/shared/core/continue-study.ts";

const session = (chatId: string, deadlineId: string, createdAt: string, done: number, total: number): DeadlineSession => ({ chatId, deadlineId, createdAt, done, total });

describe("continueStudyFor", () => {
	it("the latest session started from the deadline, while unfinished", () => {
		const sessions = [
			session("old", "mid", "2026-11-01T10:00:00.000Z", 1, 4),
			session("new", "mid", "2026-11-02T10:00:00.000Z", 0, 4),
			session("other", "quiz", "2026-11-03T10:00:00.000Z", 0, 2),
		];
		assert.deepEqual(continueStudyFor("mid", sessions), { chatId: "new", done: 0, total: 4 });
		assert.deepEqual(continueStudyFor("quiz", sessions), { chatId: "other", done: 0, total: 2 });
	});

	it("none once the latest is finished, even with an older unfinished one", () => {
		const sessions = [session("old", "mid", "2026-11-01T10:00:00.000Z", 1, 4), session("new", "mid", "2026-11-02T10:00:00.000Z", 4, 4)];
		assert.equal(continueStudyFor("mid", sessions), null);
	});

	it("none without a session from that deadline", () => {
		assert.equal(continueStudyFor("mid", []), null);
		assert.equal(continueStudyFor("mid", [session("x", "quiz", "2026-11-01T10:00:00.000Z", 0, 3)]), null);
	});
});

describe("deadlineStudyLabel", () => {
	it("Study, or Continue studying with done of total topics", () => {
		assert.equal(deadlineStudyLabel(undefined, "Midterm"), "Study for Midterm");
		assert.equal(deadlineStudyLabel(undefined), "Study");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 0, total: 4 }, "Midterm"), "Continue studying for Midterm, 0 of 4 topics");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 2, total: 4 }), "Continue studying, 2 of 4 topics");
		assert.equal(deadlineStudyLabel({ chatId: "c", done: 0, total: 1 }), "Continue studying, 0 of 1 topic");
	});
});
