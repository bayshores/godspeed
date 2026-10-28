/**
 * "Ready for what's due" (Class Overview, plan 2026-10-28 Phase 3): which
 * deadlines the runway shows (the next 5, or 4 and "+N later"), the gap
 * and meta labels, the ring tooltip lines and the "Most needed" topic.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeadlineProgress } from "../src/core/index.ts";
import {
	gapLabel,
	joinAnd,
	mostNeeded,
	ringMeta,
	ringTitle,
	runwayStops,
	stopMeta,
	studiedFacts,
	upcomingDeadlines,
} from "../src/components/overview/runway-model.ts";

const NOW = new Date(2026, 9, 28, 16, 12).getTime();

type Topic = DeadlineProgress["topics"][number];
function d(id: string, date: string, extra: Partial<DeadlineProgress> = {}): DeadlineProgress {
	return {
		id,
		kind: "homework",
		name: id,
		date,
		done: false,
		daysUntil: 0,
		files: [],
		topicIds: [],
		counts: { strong: 0, shaky: 0, weak: 0, untested: 0 },
		workOnNext: [],
		ready: null,
		topics: [],
		...extra,
	};
}
const t = (id: string, rate: number | null): Topic => ({ id, name: id, rate });

describe("upcomingDeadlines + runwayStops", () => {
	it("open deadlines still ahead, soonest first (no done, no overdue)", () => {
		const list = [d("b", "2026-11-02"), d("past", "2026-10-28", { time: "09:00" }), d("a", "2026-10-28"), d("done", "2026-10-29", { done: true })];
		assert.deepEqual(upcomingDeadlines(list, NOW).map((x) => x.id), ["a", "b"]);
	});
	it("up to 5: all of them", () => {
		const five = ["a", "b", "c", "d", "e"].map((id) => d(id, "2026-11-01"));
		assert.deepEqual(runwayStops(five), { stops: five, later: 0 });
	});
	it("more than 5: the next 4 and '+N later'", () => {
		const seven = ["a", "b", "c", "d", "e", "f", "g"].map((id) => d(id, "2026-11-01"));
		const { stops, later } = runwayStops(seven);
		assert.deepEqual(stops.map((x) => x.id), ["a", "b", "c", "d"]);
		assert.equal(later, 3);
		assert.equal(runwayStops(seven.slice(0, 6)).later, 2);
	});
});

describe("labels", () => {
	it("gaps: '1 day', '2 days', nothing on the same day", () => {
		assert.equal(gapLabel("2026-10-28", "2026-10-29"), "1 day");
		assert.equal(gapLabel("2026-10-28", "2026-10-30"), "2 days");
		assert.equal(gapLabel("2026-10-28", "2026-10-28"), "");
	});
	it("meta: the date, 'Exam · date' for exams", () => {
		assert.equal(stopMeta({ kind: "homework", date: "2026-10-30" }), "Fri Oct 30");
		assert.equal(stopMeta({ kind: "exam", date: "2026-11-05" }), "Exam · Thu Nov 5");
	});
	it("ring tooltip: 'Midterm 2 · 38% ready' and 'Thu Nov 5, 7:00 PM · Lecture 4'", () => {
		const m = d("Midterm 2", "2026-11-05", { time: "19:00", ready: 0.38, files: [{ id: "f", name: "Lecture 4.pdf" }] });
		assert.equal(ringTitle(m), "Midterm 2 · 38% ready");
		assert.equal(ringMeta(m), "Thu Nov 5, 7:00 PM · Lecture 4");
		assert.equal(ringMeta({ ...m, files: [{ id: "a", name: "a" }, { id: "b", name: "b" }] }), "Thu Nov 5, 7:00 PM · 2 files");
		assert.equal(ringTitle({ name: "Reading", ready: null }), "Reading");
		assert.equal(ringMeta({ date: "2026-10-30", files: [] }), "Fri Oct 30");
	});
	it("joinAnd", () => {
		assert.equal(joinAnd(["Midterm 2"]), "Midterm 2");
		assert.equal(joinAnd(["Midterm 2", "HW 5"]), "Midterm 2 and HW 5");
		assert.equal(joinAnd(["Midterm 2", "HW 5", "the final"]), "Midterm 2, HW 5 and the final");
	});
	it("studied facts: came up in a lesson, of all", () => {
		assert.deepEqual(studiedFacts([{ inLessons: true }, { inLessons: false }, { inLessons: true }]), { studied: 2, total: 3 });
	});
});

describe("mostNeeded", () => {
	it("the lowest rate wins, untested counting as 0", () => {
		const list = [d("HW 5", "2026-10-30", { topics: [t("sets", 0.2), t("logic", 0.9)] }), d("Midterm 2", "2026-11-05", { topics: [t("proofs", null)] })];
		assert.deepEqual(mostNeeded(list), { topicId: "proofs", name: "proofs", deadlines: ["Midterm 2"] });
	});
	it("a tie goes to the topic more deadlines cover, then the name", () => {
		const list = [
			d("HW 5", "2026-10-30", { topics: [t("b", 0.1), t("a", 0.1)] }),
			d("Midterm 2", "2026-11-05", { topics: [t("b", 0.1)] }),
			d("Final", "2026-12-10", { topics: [t("b", 0.1), t("c", 0.1)] }),
		];
		assert.deepEqual(mostNeeded(list), { topicId: "b", name: "b", deadlines: ["HW 5", "Midterm 2", "Final"] });
		assert.equal(mostNeeded([d("x", "2026-11-01", { topics: [t("z", 0.1), t("y", 0.1)] })])!.topicId, "y");
	});
	it("no topics: none", () => {
		assert.equal(mostNeeded([d("x", "2026-11-01")]), null);
		assert.equal(mostNeeded([]), null);
	});
});
