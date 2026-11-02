/**
 * The deadline page's material check: covered files in numbered series with
 * the numbers that look missing, every study file when none are covered,
 * and what is still reading, failed or course info.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadlineMaterial, materialSummary, rightLabel, syllabusCheckMessage } from "../src/components/deadline/deadline-model.ts";

type Kind = "study" | "info";
type Status = "pending" | "extracting" | "ready" | "failed" | "needs-whisper";
const f = (id: string, name: string, kind: Kind = "study", status: Status = "ready") => ({ id, name, kind, status });

const FILES = [
	f("d1", "Day1 intro.pdf"),
	f("d2", "Day2 sums.pdf", "study", "extracting"),
	f("d4", "Day4 perms.pdf"),
	f("l1", "Lecture01_2026-09-25.srt"),
	f("l2", "Lecture02_2026-09-28.srt", "study", "failed"),
	f("h1", "HW1_F26.pdf", "info"),
	f("h2", "HW2_F26.pdf", "info"),
	f("syl", "syllabus.txt", "info"),
	f("other", "Notes.pdf"),
];

describe("the deadline's material", () => {
	it("groups covered files into series with slots, gaps marked missing", () => {
		const m = deadlineMaterial(FILES, ["d1", "d2", "d4", "l1", "l2", "h1", "h2", "syl"], [{ fileId: "d1", facts: 12 }, { fileId: "l1", facts: 5 }, { fileId: "zzz", facts: 99 }]);
		assert.equal(m.allStudy, false);
		const day = m.series.find((s) => s.label === "Day")!;
		assert.deepEqual(day.slots.map((s) => [s.number, s.state]), [[1, "ready"], [2, "reading"], [3, "missing"], [4, "ready"]]);
		assert.deepEqual([day.present, day.last], [3, 4]);
		assert.deepEqual(m.series.find((s) => s.label === "Lecture")!.slots.map((s) => s.state), ["ready", "failed"]);
		assert.equal(m.series.find((s) => s.label === "HW · F26")!.infoOnly, true);
		assert.deepEqual(m.loose, [{ id: "syl", name: "syllabus.txt", state: "info" }]);
		assert.deepEqual([m.studyFiles, m.infoFiles, m.reading, m.failed, m.facts, m.missing], [5, 3, 1, 1, 17, 1]);
		assert.equal(materialSummary(m), "Day 3 looks missing, 1 file couldn't be read, 1 still being read.");
	});
	it("with no covered files it shows every study file", () => {
		const m = deadlineMaterial(FILES, [], []);
		assert.equal(m.allStudy, true);
		assert.equal(m.infoFiles, 0);
		assert.ok(m.loose.some((x) => x.name === "Notes.pdf"));
	});
	it("says so when nothing looks missing, or when there are no files", () => {
		assert.equal(materialSummary(deadlineMaterial([f("a", "Day1.pdf"), f("b", "Day2.pdf")], [], [])), "Nothing looks missing from the file names.");
		assert.equal(materialSummary(deadlineMaterial([], [], [])), "No study files yet.");
	});
	it("labels and the syllabus check message", () => {
		assert.equal(rightLabel({ right: 2, answered: 5 }), "2 of 5 right");
		assert.equal(rightLabel({ right: 0, answered: 0 }), "not tested");
		const msg = syllabusCheckMessage("CSE 21", { name: "Midterm", when: "Fri Nov 6, 7:00 PM" });
		assert.match(msg, /CSE 21 files for Midterm \(Fri Nov 6, 7:00 PM\)/);
		assert.match(msg, /syllabus/);
	});
});
