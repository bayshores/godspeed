/**
 * The Lessons block on Progress: its rows in order, the rows shown with
 * "Show all", an unfinished lesson's chip, and the edits shown before the
 * payload has them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keyLabel, lessonOrder, pendingEdits, shownRows, statusChip, withEdits } from "../../src/frontend/components/overview/lesson-record-model.ts";
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

describe("lessonOrder", () => {
	it("unfinished first, then studied, each newest first", () => {
		const ordered = lessonOrder([lesson("a", 1), lesson("b", 4, { unfinished: true }), lesson("c", 3), lesson("d", 2, { unfinished: true })]);
		assert.deepEqual(ids(ordered), ["b", "d", "c", "a"]);
		assert.deepEqual(lessonOrder([]), []);
	});
});

describe("shownRows", () => {
	const many = (n: number) => Array.from({ length: n }, (_, i) => lesson(`l${i}`, 1));

	it("the first 8 rows and Show all naming the total", () => {
		const { rows, showAll } = shownRows(many(13), false);
		assert.equal(rows.length, 8);
		assert.equal(showAll, 13);
	});

	it("one hidden row is shown instead of hidden", () => {
		assert.deepEqual(shownRows(many(9), false), { rows: many(9), showAll: null });
		assert.equal(shownRows(many(10), false).showAll, 10);
	});

	it("Show all shows every row and no button", () => {
		assert.deepEqual(shownRows(many(13), true), { rows: many(13), showAll: null });
	});
});

describe("statusChip", () => {
	it("the plan's step, Homework for homework, Started before the first step and with no plan", () => {
		assert.equal(statusChip({ kind: "teach", step: { done: 3, total: 5 } }), "Step 3 of 5");
		assert.equal(statusChip({ kind: "homework", step: { done: 2, total: 4 } }), "Homework");
		assert.equal(statusChip({ kind: "teach", step: { done: 0, total: 5 } }), "Started");
		assert.equal(statusChip({ kind: "study" }), "Started");
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
