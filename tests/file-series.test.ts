/**
 * Numbered series found in file names: the CSE 21 names group the way a
 * person would group them, and gaps are the numbers a series skips.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupFileSeries, seriesGaps } from "../src/core/file-series.ts";

const named = (names: string[]) => names.map((name, i) => ({ id: `f${i}`, name }));

const CSE21 = named([
	"Day1 intro_counting_annotated.pdf",
	"Day2 sum_product_annotated.pdf",
	"Day10_expected_value.pdf",
	"Week 1 Evening Discussion.pdf",
	"Week 2 Evening Discussion.pdf",
	"Week 2 Morning Discussion_annotated.pdf",
	"Week 3 Evening Discussion.pdf",
	"06_Counting.pdf",
	"07_Discrete_Probability.pdf",
	"01_The_Foundations_Logic_and_Proofs.pdf",
	"Lecture01_2026-09-25.srt",
	"Lecture02_2026-09-28.srt",
	"Lecture04_2026-10-02.srt",
	"syllabus.txt",
	"CSE21_HW2_Practice_Problems.pdf",
	"CSE21_HW3_Practice_Problems.pdf",
	"CSE21_HW3_Practice_Problems_expanded.pdf",
	"HW1_F26.pdf",
	"HW2_F26.pdf",
	"Digital_Note_Sheet_STUDENT_GUIDE.pdf",
]);

describe("file series", () => {
	const { series, other } = groupFileSeries(CSE21);
	const by = (label: string) => series.find((s) => s.label === label);

	it("groups each naming pattern, in number order", () => {
		assert.deepEqual(
			series.map((s) => [s.label, s.items.map((i) => i.number)]),
			[
				["CSE21 HW · Practice Problems", [2, 3]],
				["Day", [1, 2, 10]],
				["HW · F26", [1, 2]],
				["Lecture", [1, 2, 4]],
				["Numbered", [1, 6, 7]],
				["Week · Discussion", [1, 2, 3]],
			],
		);
		assert.deepEqual(other.map((f) => f.name), ["Digital_Note_Sheet_STUDENT_GUIDE.pdf", "syllabus.txt"]);
	});
	it("one number can hold two files, and a date in the name is kept", () => {
		assert.equal(by("Week · Discussion")!.items[1]!.files.length, 2);
		assert.equal(by("CSE21 HW · Practice Problems")!.items[1]!.files.length, 2);
		assert.deepEqual(by("Lecture")!.items.map((i) => i.date), ["2026-09-25", "2026-09-28", "2026-10-02"]);
		assert.equal(by("Day")!.items[0]!.date, null);
	});
	it("gaps are the numbers a series skips before its last", () => {
		assert.deepEqual(seriesGaps(by("Lecture")!), [3]);
		assert.deepEqual(seriesGaps(by("Day")!), [3, 4, 5, 6, 7, 8, 9]);
		assert.deepEqual(seriesGaps({ items: [{ number: 0, files: [], date: null }, { number: 2, files: [], date: null }] }), [1]);
		assert.deepEqual(seriesGaps({ items: [{ number: 3, files: [], date: null }, { number: 4, files: [], date: null }] }), [1, 2]);
	});
	it("labels use words only, never a dash or a number", () => {
		const { series: s } = groupFileSeries(named(["Rosen 6.2 — Probability theory.pdf", "Rosen 7.1 — Discrete probability.pdf"]));
		assert.deepEqual(s.map((x) => x.label), ["Rosen · Probability"]);
	});
	it("a lone numbered file or one repeated number is not a series", () => {
		const { series: s, other: o } = groupFileSeries(named(["Notes 1.pdf", "Exam 2025.pdf", "Exam 2025 answers.pdf"]));
		assert.deepEqual(s, []);
		assert.equal(o.length, 3);
		assert.deepEqual(groupFileSeries([]), { series: [], other: [] });
	});
});
