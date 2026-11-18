import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LessonProgress } from "../../src/shared/core/index.ts";
import { studiedLine } from "../../src/frontend/components/home-page/studied-model.ts";

/** A local moment in Nov 2026. */
const at = (day: number, h = 12, m = 0) => new Date(2026, 10, day, h, m);

function lesson(chatId: string, ...times: Date[]): LessonProgress {
	return {
		chatId,
		title: chatId,
		kind: "study",
		updatedAt: "",
		answers: times.map((t, i) => ({ chatId, toolCallId: `q${i}`, outcome: "right", answeredAt: t.toISOString() })),
		right: times.length,
		answered: times.length,
		score: null,
	};
}
const space = (...lessons: LessonProgress[]) => ({ lessons });

describe("studiedLine", () => {
	it("counts today and the six days before it, local midnight the boundary", () => {
		// Friday the 13th: the window starts Saturday the 7th at 00:00.
		const line = studiedLine([space(lesson("l", at(6, 23, 55), at(7, 0, 5), at(13, 9)))], at(13).getTime());
		assert.equal(line, "You studied 2 of the last 7 days and answered 2 questions.");
	});

	it("runs across a Monday: Sunday and the days before it still count", () => {
		assert.equal(studiedLine([space(lesson("l", at(15, 20), at(10, 9)))], at(16, 8).getTime()), "You studied 2 of the last 7 days and answered 2 questions.");
	});

	it("answers from several spaces on one day count as one day and all count as answers", () => {
		const line = studiedLine([space(lesson("a", at(10, 9), at(10, 10))), space(lesson("b", at(10, 20)), lesson("c", at(12, 8)))], at(13).getTime());
		assert.equal(line, "You studied 2 of the last 7 days and answered 4 questions.");
	});

	it("a day with an answer only in a lesson with no space counts", () => {
		assert.equal(studiedLine([space(), space(lesson("loose", at(12, 9)))], at(13).getTime()), "You studied 1 of the last 7 days and answered 1 question.");
	});

	it("a lesson listed twice counts once", () => {
		const twice = lesson("a", at(11));
		assert.equal(studiedLine([space(twice, twice)], at(13).getTime()), "You studied 1 of the last 7 days and answered 1 question.");
	});

	it("no answers in the last 7 days", () => {
		assert.equal(studiedLine([space(lesson("old", at(2)))], at(13).getTime()), "No studying in the last 7 days.");
	});
});
