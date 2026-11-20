import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenDeadline } from "../../src/frontend/components/deadlines-model.ts";
import { homeLists } from "../../src/frontend/components/home-page/home-page-model.ts";
import { cutColumn, weekColumns } from "../../src/frontend/components/home-page/week-columns-model.ts";

// Mon Nov 16 2026, 2:00 PM local.
const NOW = new Date(2026, 10, 16, 14, 0).getTime();

function d(id: string, date: string, extra: Partial<OpenDeadline> = {}): OpenDeadline {
	return { id, kind: "homework", name: id, date, fileIds: [], done: false, spaceId: "c21", spaceName: "CSE 21", ...extra };
}

const week = (open: OpenDeadline[], done: OpenDeadline[] = []) => weekColumns(homeLists(open, done, NOW), NOW);
const ids = (day: { items: { deadline: OpenDeadline }[] }) => day.items.map((i) => i.deadline.id);

describe("weekColumns", () => {
	it("seven days from today, today marked, Monday to Sunday on a Monday", () => {
		const days = week([]);
		assert.deepEqual(days.map((x) => x.day), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
		assert.deepEqual(days.map((x) => x.short), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
		assert.deepEqual(days.map((x) => x.date), [16, 17, 18, 19, 20, 21, 22], "each head carries its date, so Sun here is never taken for an earlier Sunday");
		assert.deepEqual(days.map((x) => x.today), [true, false, false, false, false, false, false]);
		assert.equal(days[0]!.long, "Monday, today");
		assert.equal(days[1]!.long, "Tuesday");
	});

	it("starts on today on any day, so a Sunday still sees the week ahead", () => {
		const sunday = new Date(2026, 10, 22, 9).getTime();
		assert.deepEqual(weekColumns({ today: [], done: [], later: [] }, sunday).map((x) => x.short), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
	});

	it("each day holds what is due on it, by time", () => {
		const days = week([d("night", "2026-11-18", { time: "23:00" }), d("morning", "2026-11-18", { time: "08:00" }), d("sun", "2026-11-22")]);
		assert.deepEqual(ids(days[2]!), ["morning", "night"]);
		assert.deepEqual(ids(days[6]!), ["sun"]);
		assert.deepEqual(ids(days[1]!), []);
	});

	it("today: late first (oldest first), then what is still due today by time, then what was done today", () => {
		const done = d("ticked", "2026-11-20", { done: true, doneAt: new Date(NOW - 60_000).toISOString() });
		const days = week([d("tonight", "2026-11-16", { time: "21:00" }), d("thismorning", "2026-11-16", { time: "09:00" }), d("lastweek", "2026-11-12"), d("later", "2026-11-16", { time: "17:00" })], [done]);
		assert.deepEqual(ids(days[0]!), ["lastweek", "thismorning", "later", "tonight", "ticked"]);
		assert.deepEqual(days[0]!.items.map((i) => [i.late, i.done]), [[true, false], [true, false], [false, false], [false, false], [false, true]]);
		assert.deepEqual(ids(days[4]!), [], "one ticked done shows only in today's column");
	});

	it("what a screen reader hears, and the time alone under the name in a wide week", () => {
		const days = week([d("HW 4", "2026-11-12"), d("Quiz 2", "2026-11-19", { kind: "quiz", time: "17:00", spaceName: "Linear Algebra" })], [d("PS1", "2026-11-17", { done: true, doneAt: new Date(NOW).toISOString() })]);
		assert.deepEqual(days[0]!.items.map((i) => i.label), ["HW 4, CSE 21, was due Thu Nov 12, late", "PS1, CSE 21, due tomorrow, done"]);
		assert.equal(days[3]!.items[0]!.label, "Quiz 2, Linear Algebra, the quiz is on Thursday at 5:00 PM");
		assert.equal(days[3]!.items[0]!.detail, "5:00 PM");
		assert.equal(days[0]!.items[0]!.detail, null, "no time, no line");
	});

	it("Later comes eighth, by date, each with its date under the name", () => {
		const columns = week([d("final", "2026-12-08", { time: "09:00" }), d("soon", "2026-11-17"), d("project", "2026-11-29")]);
		assert.equal(columns.length, 8);
		const later = columns[7]!;
		assert.deepEqual([later.day, later.short, later.date, later.long, later.today], [null, "Later", null, "Later", false]);
		assert.deepEqual(ids(later), ["project", "final"]);
		assert.deepEqual(later.items.map((i) => i.detail), ["Nov 29", "Dec 8"]);
		assert.equal(later.items[0]!.label, "project, CSE 21, due Sunday Nov 29");
		assert.deepEqual(ids(columns[1]!), ["soon"]);
	});

	it("nothing after the week, no Later column", () => {
		assert.equal(week([d("soon", "2026-11-17")]).length, 7);
	});
});

describe("cutColumn", () => {
	it("four or fewer show whole", () => {
		assert.deepEqual(cutColumn([1, 2, 3, 4]), { first: [1, 2, 3, 4], rest: [] });
		assert.deepEqual(cutColumn([]), { first: [], rest: [] });
	});

	it("more than four show three, and the rest wait behind the key", () => {
		assert.deepEqual(cutColumn([1, 2, 3, 4, 5]), { first: [1, 2, 3], rest: [4, 5] });
	});
});
