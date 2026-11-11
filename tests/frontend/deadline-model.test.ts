/**
 * The deadline page's "What's on it": covered files as class days by week,
 * the class days before it that it doesn't cover (unless left out), the
 * left-out ones, and the summary line.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverageMessage, deadlineMaterial, materialSummary, rightLabel, shortDate, whenLine } from "../../src/frontend/components/deadline/deadline-model.ts";

type Kind = "study" | "info";
type Status = "pending" | "extracting" | "ready" | "failed" | "needs-whisper";
const f = (id: string, name: string, kind: Kind = "study", status: Status = "ready") => ({ id, name, kind, status });

const FILES = [
	f("s1", "2026-09-25 Intro and Counting (lecture slides).pdf"),
	f("t1", "CSE 21 Lecture 01 (2026-09-25) transcript.pdf"),
	f("s2", "2026-09-28 Permutations (lecture slides).pdf", "study", "extracting"),
	f("l2", "Lecture02_2026-09-28 (e1).srt"),
	f("d1", "2026-09-30 Week 1 Discussion (evening discussion).pdf"),
	f("s3", "2026-09-30 Combinations (lecture slides).pdf"),
	f("s4", "2026-10-05 Combinatorial Identities (lecture slides).pdf", "study", "failed"),
	f("s5", "2026-10-21 Sorting (lecture slides).pdf"),
	f("s6", "2026-10-23 Searching (lecture slides).pdf"),
	f("s7", "2026-11-09 Graphs (lecture slides).pdf"),
	f("pe", "Midterm practice exam.pdf"),
	f("syl", "syllabus.txt", "info"),
];

const deadline = (over: Partial<{ fileIds: string[]; leftOutIds: string[]; kind: "exam" | "homework"; date: string }> = {}) => ({
	id: "mid",
	kind: "exam" as const,
	date: "2026-11-04",
	fileIds: ["s1", "t1", "s2", "l2", "d1", "s3", "s4", "pe"],
	...over,
});

describe("what a deadline covers", () => {
	it("groups covered files into class days by week, with each day's title, parts and worst state", () => {
		const d = deadline();
		const m = deadlineMaterial(FILES, d, [d], [{ fileId: "s1", facts: 12 }, { fileId: "t1", facts: 5 }, { fileId: "zzz", facts: 99 }]);
		assert.deepEqual(m.weeks.map((w) => [w.number, w.days.map((x) => x.date)]), [[1, ["2026-09-25", "2026-09-28", "2026-09-30"]], [2, ["2026-10-05"]]]);
		const first = m.weeks[0]!.days[0]!;
		assert.equal(first.title, "Intro and Counting", "the day's topic, not the transcript's 'CSE 21 Lecture 01'");
		assert.deepEqual(first.parts, ["lecture slides", "transcript"]);
		assert.equal(m.weeks[0]!.days[1]!.state, "reading");
		assert.equal(m.weeks[0]!.days[1]!.title, "Permutations", "not 'Lecture02'");
		assert.deepEqual(m.weeks[0]!.days[1]!.parts, ["lecture slides"], "no code like 'e1' as a part");
		assert.equal(m.weeks[0]!.days[2]!.title, "Combinations", "a lecture beats a discussion on the same day");
		assert.deepEqual(m.weeks[0]!.days[2]!.parts, ["evening discussion", "lecture slides"]);
		assert.equal(m.weeks[1]!.days[0]!.state, "failed");
		assert.deepEqual(m.undated.map((x) => x.title), ["Midterm practice exam.pdf"]);
		assert.deepEqual([m.classDays, m.files, m.reading, m.failed, m.facts], [4, 8, 1, 1, 17]);
		assert.equal(materialSummary(m), "4 class days, 8 files, 1 still being read, 1 couldn't be read");
	});

	it("flags study days before an exam that it doesn't cover, and stops once they're left out", () => {
		const d = deadline();
		const m = deadlineMaterial(FILES, d, [d], []);
		assert.deepEqual(m.notIncluded.map((x) => x.title), ["Sorting", "Searching"], "not course info, not after the exam");
		const out = deadline({ leftOutIds: ["s5"] });
		const later = deadlineMaterial(FILES, out, [out], []);
		assert.deepEqual(later.notIncluded.map((x) => x.title), ["Searching"]);
		assert.deepEqual(later.leftOut.map((x) => x.title), ["Sorting"]);
	});

	it("an exam's check starts after the class's previous exam", () => {
		const first = { id: "m1", kind: "exam" as const, date: "2026-10-10", fileIds: [] };
		const d = deadline({ date: "2026-11-20", fileIds: ["s5"] });
		const m = deadlineMaterial(FILES, d, [first, d], []);
		assert.deepEqual(m.notIncluded.map((x) => x.title), ["Searching", "Graphs"]);
	});

	it("other deadlines are checked from their first covered day; nothing linked means no check", () => {
		const hw = deadline({ kind: "homework", date: "2026-10-25", fileIds: ["s5"] });
		assert.deepEqual(deadlineMaterial(FILES, hw, [hw], []).notIncluded.map((x) => x.title), ["Searching"]);
		const none = deadline({ fileIds: [] });
		const m = deadlineMaterial(FILES, none, [none], []);
		assert.deepEqual([m.weeks.length, m.notIncluded.length, m.files], [0, 0, 0]);
		assert.equal(materialSummary(m), "0 files");
	});

	it("labels, dates and the message Ask sends", () => {
		assert.equal(rightLabel({ right: 2, answered: 5 }), "2 of 5 right");
		assert.equal(rightLabel({ right: 0, answered: 0 }), "not tested");
		assert.equal(rightLabel(undefined), "not tested");
		assert.equal(whenLine({ kind: "exam", date: "2026-12-08", time: "23:59" }), "Exam, Tuesday Dec 8, 11:59 PM");
		assert.equal(whenLine({ kind: "homework", date: "2026-11-13" }), "Homework, Friday Nov 13");
		assert.equal(shortDate("2026-09-25"), "Sep 25");
		const msg = coverageMessage("CSE 21", { name: "Midterm", when: "Wed Nov 4, 6:30 PM" });
		assert.match(msg, /^Work out what Midterm \(Wed Nov 4, 6:30 PM\) in CSE 21 covers from my files/);
		assert.match(msg, /tell me which file you went by/);
	});
});
