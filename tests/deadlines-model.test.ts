/**
 * Open deadlines across classes (plan 2026-10-28, Phase 3): the sidebar's
 * Due soon pick, Home's Coming up groups (Overdue / Today / Tomorrow /
 * dates / Later), the head summary and the short labels.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	comingUpGroups,
	dueSoon,
	dueUnderLabel,
	itemsSummary,
	longDateLine,
	nextDueText,
	whenLabel,
	type OpenDeadline,
} from "../src/components/deadlines-model.ts";

// Wed Oct 28 2026, 4:12 PM local.
const NOW = new Date(2026, 9, 28, 16, 12).getTime();

function d(id: string, date: string, time?: string, extra: Partial<OpenDeadline> = {}): OpenDeadline {
	return { id, kind: "homework", name: id, date, ...(time ? { time } : {}), fileIds: [], done: false, classId: "c1", className: "CSE 21", ...extra };
}

describe("dueSoon", () => {
	it("overdue first, then the soonest, at most 4; done ones never", () => {
		const list = [
			d("later", "2026-11-20"),
			d("today5", "2026-10-28", "17:00"),
			d("late", "2026-10-27", "09:00"),
			d("fri", "2026-10-30"),
			d("tomorrow", "2026-10-29", "08:00"),
			d("done", "2026-10-28", "18:00", { done: true }),
		];
		assert.deepEqual(dueSoon(list).map((x) => x.id), ["late", "today5", "tomorrow", "fri"]);
	});
	it("a deadline with no time sorts as 23:59", () => {
		assert.deepEqual(dueSoon([d("noTime", "2026-10-28"), d("at11pm", "2026-10-28", "23:00")]).map((x) => x.id), ["at11pm", "noTime"]);
	});
});

describe("comingUpGroups", () => {
	const list = [
		d("passedToday", "2026-10-28", "09:00"),
		d("yesterday", "2026-10-27"),
		d("tonight", "2026-10-28"),
		d("tomorrow", "2026-10-29", "11:59"),
		d("fri", "2026-10-30"),
		d("fri2", "2026-10-30", "10:00"),
		d("day14", "2026-11-11"),
		d("day15", "2026-11-12"),
		d("done", "2026-10-29", undefined, { done: true }),
	];
	it("Overdue, Today, Tomorrow · date, each date, Later (more than 14 days)", () => {
		const groups = comingUpGroups(list, NOW);
		assert.deepEqual(
			groups.map((g) => [g.label, g.items.map((x) => x.id)]),
			[
				["Overdue", ["yesterday", "passedToday"]],
				["Today", ["tonight"]],
				["Tomorrow · Thu Oct 29", ["tomorrow"]],
				["Fri Oct 30", ["fri2", "fri"]],
				["Wed Nov 11", ["day14"]],
				["Later", ["day15"]],
			],
		);
		assert.equal(groups[0]!.overdue, true);
		assert.ok(groups.slice(1).every((g) => !g.overdue));
	});
	it("empty groups are left out", () => {
		assert.deepEqual(comingUpGroups([d("fri", "2026-10-30")], NOW).map((g) => g.key), ["2026-10-30"]);
		assert.deepEqual(comingUpGroups([], NOW), []);
	});
});

describe("labels", () => {
	it("Coming up's head: '6 items · 1 overdue'", () => {
		assert.equal(itemsSummary([d("a", "2026-10-27"), d("b", "2026-10-30"), d("c", "2026-10-31")], NOW), "3 items · 1 overdue");
		assert.equal(itemsSummary([d("b", "2026-10-30")], NOW), "1 item");
	});
	it("the meta line: the time, or the weekday with no time", () => {
		assert.equal(whenLabel(d("a", "2026-10-30", "17:00")), "5:00 PM");
		assert.equal(whenLabel(d("a", "2026-10-30")), "Fri");
	});
	it("under Home's countdown: the time, or 'was due Fri 11:59 PM' once overdue", () => {
		assert.equal(dueUnderLabel(d("a", "2026-10-30", "23:59"), false), "11:59 PM");
		assert.equal(dueUnderLabel(d("a", "2026-10-23", "23:59"), true), "was due Fri 11:59 PM");
		assert.equal(dueUnderLabel(d("a", "2026-10-23"), true), "was due Fri");
	});
	it("a class block's Next due", () => {
		assert.equal(nextDueText(d("Reading quiz", "2026-10-28", "17:00"), NOW), "Reading quiz, today 5:00 PM");
		assert.equal(nextDueText(d("HW 5", "2026-10-29"), NOW), "HW 5, tomorrow");
		assert.equal(nextDueText(d("Midterm 2", "2026-11-05", "19:00"), NOW), "Midterm 2, Thu Nov 5, 7:00 PM");
	});
	it("Home's date line", () => {
		assert.equal(longDateLine(NOW), "Wednesday, October 28 · 4:12 PM");
		assert.equal(longDateLine(new Date(2026, 9, 28, 0, 5).getTime()), "Wednesday, October 28 · 12:05 AM");
	});
});
