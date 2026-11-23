/** The Deadlines tab: which list a deadline goes in, and each row's words. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpaceDeadline, DeadlineProgress, RhythmGap } from "../../src/shared/core/index.ts";
import { addDeadlineHref, comingRows, deadlineLine, deadlineLists, seedFromSearch, withoutAddLink } from "../../src/frontend/components/space-page/deadlines-tab-model.ts";

// Wed Nov 11 2026, 4:12 PM local.
const NOW = new Date(2026, 10, 11, 16, 12).getTime();

function d(id: string, kind: SpaceDeadline["kind"], date: string, done = false): SpaceDeadline {
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

describe("the outline in Coming up", () => {
	const gap: RhythmGap = { spaceId: "spc_21", key: "spc_21:ddl_hw6:1", title: "Homework in CSE 21 this week?", line: "It came every week.", answer: "None this week", close: false, kind: "homework", day: "2026-11-13", name: "HW7", label: "HW7?" };
	const timed = { ...d("quiz", "quiz", "2026-11-13"), time: "10:00" };
	const rows = (coming: SpaceDeadline[], leaving = false, joined: readonly string[] = []) => comingRows(coming, [{ item: gap, leaving }], (d) => joined.includes(d.id)).map((r) => (r.kind === "gap" ? `${r.gap.label}${r.leaving ? " leaving" : ""}` : r.deadline.id));
	it("sits on its day, after what is due earlier that day and before what comes later", () => {
		assert.deepEqual(rows([timed, FINAL]), ["quiz", "HW7?", "final"]);
	});
	it("before a deadline due at the same day's end, first with nothing earlier, last with nothing later", () => {
		assert.deepEqual(rows([HW6, FINAL]), ["HW7?", "hw6", "final"]);
		assert.deepEqual(rows([FINAL]), ["HW7?", "final"]);
		assert.deepEqual(rows([]), ["HW7?"]);
	});
	it("one that is leaving keeps its place, but gives way at once to a deadline that joins on its day", () => {
		assert.deepEqual(rows([timed, FINAL], true), ["quiz", "HW7? leaving", "final"]);
		assert.deepEqual(rows([timed, HW6, FINAL], true), ["quiz", "HW7? leaving", "hw6", "final"]);
		assert.deepEqual(rows([timed, HW6, FINAL], true, ["hw6"]), ["quiz", "hw6", "final"]);
		assert.deepEqual(rows([timed, HW6, FINAL], true, ["final"]), ["quiz", "HW7? leaving", "hw6", "final"]);
	});
});

describe("the link that opens Add a deadline", () => {
	const read = (href: string) => new URLSearchParams(href.split("?")[1]);
	it("plain, it opens the empty dialog", () => {
		assert.equal(addDeadlineHref(), "/space/deadlines?add=1");
		assert.equal(seedFromSearch(read(addDeadlineHref())), undefined);
	});
	it("with a seed, the dialog opens with its kind, name and date", () => {
		const href = addDeadlineHref({ kind: "homework", name: "HW 7", date: "2026-11-23" });
		assert.ok(href.startsWith("/space/deadlines?add=1&"));
		assert.deepEqual(seedFromSearch(read(href)), { kind: "homework", name: "HW 7", date: "2026-11-23" });
		assert.deepEqual(seedFromSearch(read(addDeadlineHref({ kind: "quiz", name: "Quiz 4" }))), { kind: "quiz", name: "Quiz 4" });
	});
	it("a kind it does not know or a date that is no day is not used", () => {
		assert.equal(seedFromSearch(new URLSearchParams("add=1&kind=party&name=x")), undefined);
		assert.deepEqual(seedFromSearch(new URLSearchParams("add=1&kind=quiz&name=Q&date=soon")), { kind: "quiz", name: "Q" });
	});
	it("once open, the address keeps nothing of it", () => {
		assert.equal(String(withoutAddLink(new URLSearchParams("add=1&kind=quiz&name=Q&date=2026-11-23&lit=x"))), "lit=x");
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
