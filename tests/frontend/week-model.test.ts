import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LessonProgress } from "../../src/shared/core/index.ts";
import { weekStrip } from "../../src/frontend/components/home-page/week-model.ts";

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

describe("weekStrip", () => {
	it("Monday to Sunday around a Friday, today marked", () => {
		const week = weekStrip([], at(13).getTime());
		assert.deepEqual(week.days.map((d) => d.day), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
		assert.deepEqual(week.days.map((d) => d.name[0]).join(""), "MTWTFSS");
		assert.deepEqual(week.days.filter((d) => d.today).map((d) => d.day), ["2026-11-13"]);
	});

	it("on a Sunday the week is the one ending that day", () => {
		const week = weekStrip([], at(15, 22).getTime());
		assert.equal(week.days[0]!.day, "2026-11-09");
		assert.equal(week.days[6]!.today, true);
	});

	it("local midnight is the boundary: a Sunday-night answer is last week, a Monday 00:05 answer this week", () => {
		const week = weekStrip([space(lesson("l", at(8, 23, 55), at(9, 0, 5)))], at(13).getTime());
		assert.deepEqual(week.days.filter((d) => d.studied).map((d) => d.day), ["2026-11-09"]);
		assert.equal(week.sentence, "You studied 1 day this week and answered 1 question.");
	});

	it("answers from several spaces on one day fill one square and all count", () => {
		const week = weekStrip([space(lesson("a", at(10, 9), at(10, 10))), space(lesson("b", at(10, 20)), lesson("c", at(12, 8)))], at(13).getTime());
		assert.deepEqual(week.days.filter((d) => d.studied).map((d) => d.name), ["Tuesday", "Thursday"]);
		assert.equal(week.sentence, "You studied 2 days this week and answered 4 questions.");
		assert.equal(week.label, "You studied on Tuesday and Thursday.");
	});

	it("a day with an answer only in a lesson with no space is studied and its questions count", () => {
		const week = weekStrip([space(), space(lesson("loose", at(12, 9), at(12, 10)))], at(13).getTime());
		assert.deepEqual(week.days.filter((d) => d.studied).map((d) => d.name), ["Thursday"]);
		assert.equal(week.sentence, "You studied 1 day this week and answered 2 questions.");
	});

	it("a lesson listed twice counts once", () => {
		const twice = lesson("a", at(11));
		assert.equal(weekStrip([space(twice, twice)], at(13).getTime()).sentence, "You studied 1 day this week and answered 1 question.");
	});

	it("no answers this week", () => {
		const week = weekStrip([space(lesson("old", at(2)))], at(13).getTime());
		assert.equal(week.sentence, "No studying yet this week.");
		assert.equal(week.days.some((d) => d.studied), false);
	});
});
