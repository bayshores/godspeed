/**
 * A space's lessons on Progress: unfinished beside finished, the rows shown
 * with "Show all", the day a finished row names, an unfinished row's
 * blocks, its key, and the edits shown before the payload has them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayWord, keyLabel, pendingEdits, shownRows, splitLessons, stepBlocks, withEdits } from "../../src/frontend/components/overview/lesson-record-model.ts";
import type { LessonProgress } from "../../src/shared/core/index.ts";

const lesson = (chatId: string, day: number, over: Partial<LessonProgress> = {}): LessonProgress => ({
	chatId,
	title: `Lesson ${chatId}`,
	kind: "teach",
	updatedAt: `2026-11-${String(day).padStart(2, "0")}T12:00:00Z`,
	answers: [],
	right: 0,
	answered: 0,
	score: null,
	...over,
});

const ids = (lessons: readonly LessonProgress[]) => lessons.map((l) => l.chatId);

describe("splitLessons", () => {
	it("the unfinished and the finished apart, each newest first", () => {
		const { unfinished, finished } = splitLessons([lesson("a", 1), lesson("b", 4, { unfinished: true }), lesson("c", 3), lesson("d", 2, { unfinished: true })]);
		assert.deepEqual(ids(unfinished), ["b", "d"]);
		assert.deepEqual(ids(finished), ["c", "a"]);
	});
});

describe("shownRows", () => {
	const many = (n: number) => Array.from({ length: n }, (_, i) => lesson(`l${i}`, 1));

	it("the first rows up to the limit and Show all naming the total", () => {
		const { rows, showAll } = shownRows(many(15), 12, false);
		assert.equal(rows.length, 12);
		assert.equal(showAll, 15);
		assert.equal(shownRows(many(5), 3, false).rows.length, 3);
	});

	it("one hidden row is shown instead of hidden", () => {
		assert.deepEqual(shownRows(many(4), 3, false), { rows: many(4), showAll: null });
		assert.equal(shownRows(many(5), 3, false).showAll, 5);
	});

	it("Show all shows every row and no button", () => {
		assert.deepEqual(shownRows(many(13), 12, true), { rows: many(13), showAll: null });
	});
});

describe("dayWord", () => {
	const now = new Date(2026, 10, 17, 9, 0).getTime();
	const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

	it("Today, Yesterday, then the month and day, with the year once it is another year's", () => {
		assert.equal(dayWord(at(2026, 10, 17, 1), now), "Today");
		assert.equal(dayWord(at(2026, 10, 16, 23), now), "Yesterday");
		assert.equal(dayWord(at(2026, 10, 14), now), "Nov 14");
		assert.equal(dayWord(at(2025, 11, 30), now), "Dec 30, 2025");
		assert.equal(dayWord("not a date", now), "");
	});
});

describe("stepBlocks", () => {
	const problems = (id: string) => (id === "hw" ? { done: 1, total: 4 } : undefined);

	it("a homework shows its deadline's problems; any other lesson its plan's steps", () => {
		assert.deepEqual(stepBlocks({ kind: "homework", deadlineId: "hw", step: { done: 2, total: 3 } }, problems), { done: 1, total: 4 });
		assert.deepEqual(stepBlocks({ kind: "teach", step: { done: 2, total: 3 } }, problems), { done: 2, total: 3 });
	});

	it("a homework with no deadline found falls back to its steps; nothing to draw is null", () => {
		assert.deepEqual(stepBlocks({ kind: "homework", deadlineId: "gone", step: { done: 1, total: 2 } }, problems), { done: 1, total: 2 });
		assert.equal(stepBlocks({ kind: "practice" }, problems), null);
		assert.equal(stepBlocks({ kind: "teach", step: { done: 0, total: 0 } }, problems), null);
	});
});

describe("keyLabel", () => {
	it("Work on it for homework, Continue for every other unfinished lesson", () => {
		assert.equal(keyLabel({ kind: "homework" }), "Work on it");
		for (const kind of ["teach", "study", "practice"] as const) assert.equal(keyLabel({ kind }), "Continue");
	});
});

describe("edits before the payload has them", () => {
	const lessons = [lesson("a", 1), lesson("b", 2), lesson("c", 3)];

	it("a rename shows the new title; a delete or move hides the row", () => {
		const shown = withEdits(lessons, { a: "Renamed", b: null });
		assert.deepEqual(
			shown.map((l) => [l.chatId, l.title]),
			[
				["a", "Renamed"],
				["c", "Lesson c"],
			],
		);
	});

	it("an edit stays until the payload agrees, then goes", () => {
		const edits = { a: "Renamed", b: null };
		assert.equal(pendingEdits(edits, lessons), edits, "nothing agrees yet: the same object");
		const read = [{ ...lessons[0]!, title: "Renamed" }, lessons[2]!];
		assert.deepEqual(pendingEdits(edits, read), {});
		assert.deepEqual(pendingEdits({ x: "Gone elsewhere" }, lessons), {}, "a rename of a lesson no longer here goes too");
	});
});
