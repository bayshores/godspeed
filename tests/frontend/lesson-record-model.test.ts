/**
 * The Lessons block on Progress: its two groups, the rows each shows with
 * "Show all", the step line, and the edits shown before the payload has them.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupRows, keyLabel, lessonGroups, pendingEdits, stepLine, withEdits } from "../../src/frontend/components/overview/lesson-record-model.ts";
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

describe("lessonGroups", () => {
	it("Unfinished then Studied, each newest first, sized 3 and 5", () => {
		const groups = lessonGroups([lesson("a", 1), lesson("b", 4, { unfinished: true }), lesson("c", 3), lesson("d", 2, { unfinished: true })]);
		assert.deepEqual(
			groups.map((g) => [g.name, ids(g.lessons), g.size]),
			[
				["Unfinished", ["b", "d"], 3],
				["Studied", ["c", "a"], 5],
			],
		);
	});

	it("a group with no lessons is left out; no lessons, no groups", () => {
		assert.deepEqual(
			lessonGroups([lesson("a", 1)]).map((g) => g.name),
			["Studied"],
		);
		assert.deepEqual(
			lessonGroups([lesson("a", 1, { unfinished: true })]).map((g) => g.name),
			["Unfinished"],
		);
		assert.deepEqual(lessonGroups([]), []);
	});
});

describe("groupRows", () => {
	const many = (n: number) => Array.from({ length: n }, (_, i) => lesson(`l${i}`, 1));

	it("the first rows and Show all naming the group's total", () => {
		const { rows, showAll } = groupRows(many(8), 5, false);
		assert.equal(rows.length, 5);
		assert.equal(showAll, 8);
	});

	it("one hidden row is shown instead of hidden", () => {
		assert.deepEqual(groupRows(many(6), 5, false), { rows: many(6), showAll: null });
		assert.equal(groupRows(many(4), 3, false).showAll, null);
		assert.equal(groupRows(many(5), 3, false).showAll, 5);
	});

	it("Show all shows every row and no button", () => {
		assert.deepEqual(groupRows(many(8), 5, true), { rows: many(8), showAll: null });
	});
});

describe("stepLine", () => {
	it("Step 3 of 5 from the plan's step", () => {
		assert.equal(stepLine({ kind: "teach", step: { done: 3, total: 5 } }), "Step 3 of 5");
	});

	it("nothing before the first step, with no plan, or for homework", () => {
		assert.equal(stepLine({ kind: "teach", step: { done: 0, total: 5 } }), null);
		assert.equal(stepLine({ kind: "study" }), null);
		assert.equal(stepLine({ kind: "homework", step: { done: 2, total: 4 } }), null);
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
