/** The Deadlines tab: which list a deadline goes in, and each row's words. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassDeadline, DeadlineProgress } from "../../src/shared/core/index.ts";
import { deadlineLine, deadlineLists } from "../../src/frontend/components/class-page/deadlines-tab-model.ts";

// Wed Nov 11 2026, 4:12 PM local.
const NOW = new Date(2026, 10, 11, 16, 12).getTime();

function d(id: string, kind: ClassDeadline["kind"], date: string, done = false): ClassDeadline {
	return { id, kind, name: id, date, fileIds: [], done };
}
const HW6 = d("hw6", "homework", "2026-11-13");
const FINAL = d("final", "exam", "2026-12-08");
const HW5 = d("hw5", "homework", "2026-11-06", true);
const TEST1 = d("test1", "exam", "2026-10-20", true);
const QUIZ3 = d("quiz3", "quiz", "2026-10-29");
const EARLY = d("early", "homework", "2026-11-20", true);

describe("the Deadlines tab's lists", () => {
	it("Coming up: not done and not yet due, soonest first", () => {
		assert.deepEqual(deadlineLists([FINAL, QUIZ3, HW6, HW5], NOW).coming.map((x) => x.id), ["hw6", "final"]);
	});
	it("Done or past: done ones and missed ones, latest first", () => {
		assert.deepEqual(deadlineLists([TEST1, FINAL, QUIZ3, HW5, EARLY], NOW).past.map((x) => x.id), ["early", "hw5", "quiz3", "test1"]);
	});
});

describe("a deadline row's line", () => {
	const problems = { problems: { done: 2, total: 7 }, ready: 0.5 } as DeadlineProgress;
	const ready = { ready: 0.19 } as DeadlineProgress;
	it("coming up: kind, day, and how far along", () => {
		assert.equal(deadlineLine(HW6, problems, NOW), "Homework, due Friday Nov 13. 2 of 7 problems done");
		assert.equal(deadlineLine(FINAL, ready, NOW), "Exam, Tuesday Dec 8. 19% ready");
		assert.equal(deadlineLine(FINAL, undefined, NOW), "Exam, Tuesday Dec 8");
	});
	it("done or past: kind and day only", () => {
		assert.equal(deadlineLine(HW5, problems, NOW), "Homework, was due Friday Nov 6");
		assert.equal(deadlineLine(TEST1, ready, NOW), "Exam, Tuesday Oct 20");
		assert.equal(deadlineLine(QUIZ3, undefined, NOW), "Quiz, Thursday Oct 29");
	});
});
