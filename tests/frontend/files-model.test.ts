/**
 * The Files page's pure helpers: the row's state from a file's status and
 * coverage, the coverage bar, the groups found from file names (a
 * lecture's notes and transcript paired), search, dates and the summary
 * line.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpaceFile, FileCoverage } from "../../src/shared/core/index.ts";
import { groupFileSeries } from "../../src/shared/core/file-series.ts";
import { fileGroups, pairSeries } from "../../src/shared/core/file-groups.ts";
import {
	canRemove,
	canRetry,
	confirmCopy,
	dropTitle,
	filesSummary,
	fileState,
	filterGroups,
	kindNote,
	listRules,
	shortDate,
	fileBrowserName,
	studiedFill,
} from "../../src/frontend/components/files/files-model.ts";

function file(over: Partial<SpaceFile>): SpaceFile {
	return { id: "f_1", origin: "copied", name: "L1.pdf", path: "f_1/L1.pdf", kind: "study", contentFp: "", status: "ready", addedAt: "", ...over };
}
const named = (names: string[]) => names.map((name, i) => file({ id: `f${i}`, name, path: `f${i}/${name}` }));
const CSE21 = named([
	"Day1 intro_counting_annotated.pdf",
	"Lecture01_2026-09-25.srt",
	"Day2 sum_product_annotated.pdf",
	"Lecture02_2026-09-28.srt",
	"Day3 permutations.pdf",
	"Lecture03.srt",
	"Week 1 Evening Discussion.pdf",
	"Week 2 Evening Discussion.pdf",
	"Week 2 Morning Discussion_annotated.pdf",
	"06_Counting.pdf",
	"07_Discrete_Probability.pdf",
	"01_The_Foundations_Logic_and_Proofs.pdf",
	"HW1_F26.pdf",
	"HW2_F26.pdf",
	"syllabus.txt",
	"Digital_Note_Sheet_STUDENT_GUIDE.pdf",
]);
const cov = (facts: number, inLessons: number): FileCoverage => ({ fileId: "f_1", name: "L1.pdf", facts, inLessons, share: facts ? inLessons / facts : null });

describe("files-model", () => {
	it("fileState follows the pipeline status", () => {
		assert.deepEqual(fileState(file({ status: "extracting" }), undefined, true), { kind: "building" });
		assert.deepEqual(fileState(file({ status: "pending" }), undefined, true), { kind: "waiting", label: "Waiting" });
		assert.deepEqual(fileState(file({ status: "pending" }), undefined, false), { kind: "waiting", label: "Waiting for your agent" }, "no agent is teaching");
		assert.deepEqual(fileState(file({ status: "pending", kind: "info" }), undefined, false), { kind: "none" }, "space info has nothing to do");
		assert.deepEqual(fileState(file({ status: "failed", error: "boom" }), undefined, true), { kind: "failed", label: "Failed", error: "boom" });
		assert.deepEqual(fileState(file({ status: "needs-whisper", error: "Run brew" }), undefined, true), {
			kind: "failed",
			label: "Needs a speech tool",
			install: "brew install whisper-cpp ffmpeg",
		});
		assert.deepEqual(fileState(file({ status: "ready" }), cov(10, 4), true), { kind: "coverage", facts: 10, inLessons: 4, share: 0.4 });
		assert.deepEqual(fileState(file({ status: "ready" }), undefined, true), { kind: "none" }, "no coverage yet: nothing");
		assert.deepEqual(fileState(file({ status: "ready", kind: "info" }), cov(10, 4), true), { kind: "none" }, "space info shows no coverage");
		const covered = file({ name: "CSE21_Lecture_01_2026-09-25.mp4", transcriptId: "f_t" });
		assert.deepEqual(fileState(covered, undefined, true), { kind: "transcript", label: "Uses its transcript" });
	});

	it("confirmCopy says how many files and facts go before Unlink, Remove and Move to Space info", () => {
		const files = [
			file({ id: "a", origin: "linked" }),
			file({ id: "b", origin: "linked" }),
			file({ id: "c", name: "HW.pdf" }),
			file({ id: "d", name: "Syllabus.pdf", kind: "info" }),
		];
		const coverage = new Map<string, FileCoverage>([
			["a", { ...cov(30, 0), fileId: "a" }],
			["b", { ...cov(1, 0), fileId: "b" }],
			["c", { ...cov(1, 0), fileId: "c" }],
		]);
		const none = new Map<string, FileCoverage>();
		const unlink = confirmCopy({ kind: "unlink" }, "CSE 21", files, coverage);
		assert.equal(unlink.title, "Unlink this folder?");
		assert.equal(unlink.body, "Its 2 files leave CSE 21, along with the 31 facts built from them. The folder on your computer is not touched. This cannot be undone.");
		assert.match(unlink.note!, /use Pick folder again instead/);
		assert.equal(unlink.action, "Unlink");
		assert.match(confirmCopy({ kind: "unlink" }, "CSE 21", files, none).body, /^Its 2 files leave CSE 21, along with the facts built from them\./, "counts not loaded yet");
		assert.equal(confirmCopy({ kind: "unlink" }, "CSE 21", [files[2]!], coverage).body, "The folder on your computer is not touched. This cannot be undone.", "nothing linked yet");

		const remove = confirmCopy({ kind: "remove", file: files[2]! }, "CSE 21", files, coverage);
		assert.deepEqual(remove, {
			title: "Remove HW.pdf?",
			body: "It leaves CSE 21, along with the 1 fact built from it. Your original file is not touched. This cannot be undone.",
			action: "Remove file",
			danger: true,
		});
		assert.equal(
			confirmCopy({ kind: "remove", file: files[3]! }, "CSE 21", files, coverage).body,
			"It leaves CSE 21. Your original file is not touched. This cannot be undone.",
			"space info has no facts",
		);

		assert.deepEqual(confirmCopy({ kind: "move", file: files[0]! }, "CSE 21", files, coverage), {
			title: "Move to Space info?",
			body: "Its 30 facts leave the graph. The teacher can still read it.",
			action: "Move file",
			danger: false,
		});
		const empty = new Map<string, FileCoverage>([["a", { ...cov(0, 0), fileId: "a" }]]);
		assert.equal(confirmCopy({ kind: "move", file: files[0]! }, "CSE 21", files, empty).body, "The teacher can still read it.", "no facts: nothing to lose");
		assert.equal(confirmCopy({ kind: "move", file: files[0]! }, "CSE 21", files, none).body, "Its facts leave the graph. The teacher can still read it.", "counts not loaded yet");
	});

	it("studiedFill is the share of facts that came up in lessons", () => {
		assert.equal(studiedFill({ facts: 22, inLessons: 0 }), 0);
		assert.equal(studiedFill({ facts: 10, inLessons: 4 }), 0.4);
		assert.equal(studiedFill({ facts: 0, inLessons: 0 }), 0, "no facts: an empty bar");
	});

	it("kindNote says what each kind does", () => {
		assert.equal(kindNote("study"), "Turned into facts");
		assert.equal(kindNote("info"), "Read by the teacher only");
	});

	it("listRules: solid beside an open section, dotted between folded ones, none above the first", () => {
		assert.deepEqual(listRules([]), []);
		assert.deepEqual(listRules([true, true, false, false, false]), [null, "solid", "solid", "dotted", "dotted"]);
		assert.deepEqual(listRules([false, false, true]), [null, "dotted", "solid"]);
	});

	it("dropTitle says what a drop will do", () => {
		assert.equal(dropTitle("study", 2), "Add 2 files as study material");
		assert.equal(dropTitle("info", 1), "Add 1 file as space info");
		assert.equal(dropTitle("study", 0), "Add files as study material");
	});

	it("the menu's Retry is only for a stuck file (a failed row has its own); Remove only for copies", () => {
		assert.equal(canRetry(file({ status: "failed" })), false);
		assert.equal(canRetry(file({ status: "needs-whisper" })), false);
		assert.equal(canRetry(file({ status: "pending" })), true);
		assert.equal(canRetry(file({ status: "ready" })), false);
		assert.equal(canRemove(file({ origin: "copied" })), true);
		assert.equal(canRemove(file({ origin: "linked" })), false);
	});

	it("groups follow the name series; a lecture's notes and transcript share an entry with the transcript's date", () => {
		const groups = fileGroups(CSE21);
		assert.deepEqual(
			groups.map((g) => [g.label, g.count, g.items.map((i) => i.label)]),
			[
				["HW, F26", 2, ["HW 1", "HW 2"]],
				["Lecture", 6, ["Lecture 1", "Lecture 2", "Lecture 3"]],
				["Numbered", 3, ["1", "6", "7"]],
				["Week, Discussion", 3, ["Week 1", "Week 2"]],
				["Other", 2, [null, null]],
			],
		);
		const lectures = groups[1]!;
		assert.deepEqual(lectures.items[0]!.files.map((f) => f.name), ["Day1 intro_counting_annotated.pdf", "Lecture01_2026-09-25.srt"], "notes first");
		assert.deepEqual(lectures.items.map((i) => i.date), ["2026-09-25", "2026-09-28", null]);
		assert.equal(groups[3]!.items[1]!.files.length, 2, "two files with one number stay in one entry");
		assert.deepEqual(groups[4]!.items.map((i) => i.files[0]!.name), ["Digital_Note_Sheet_STUDENT_GUIDE.pdf", "syllabus.txt"]);
		assert.deepEqual(fileGroups([]), []);
		const infoFirst = [file({ id: "h1", name: "HW1.pdf", kind: "info" }), file({ id: "h2", name: "HW2.pdf", kind: "info" }), file({ id: "w1", name: "Week 1.pdf" }), file({ id: "w2", name: "Week 2.pdf" })];
		assert.deepEqual(fileGroups(infoFirst).map((g) => g.label), ["Week", "HW"], "groups with study material come first");
		assert.deepEqual(
			fileGroups([file({ id: "x", name: "syllabus.txt" })]).map((g) => g.label),
			["Other"],
			"only other files: one group",
		);
	});

	it("pairSeries pairs a transcript series with the one notes series most like it, never on a tie", () => {
		const { series } = groupFileSeries(CSE21);
		const pairs = pairSeries(series);
		assert.deepEqual([...pairs].map(([t, n]) => [t.label, n.label]), [["Lecture", "Day"]]);
		// Two notes series equally like the transcripts: no pair.
		const tie = groupFileSeries(named(["Lecture01.srt", "Lecture02.srt", "Day1.pdf", "Day2.pdf", "Notes1.pdf", "Notes2.pdf"]));
		assert.equal(pairSeries(tie.series).size, 0);
		// Too few shared numbers: no pair.
		const apart = groupFileSeries(named(["Lecture01.srt", "Lecture02.srt", "Lecture03.srt", "Day3.pdf", "Day7.pdf", "Day8.pdf"]));
		assert.equal(pairSeries(apart.series).size, 0);
		// A series mixing notes and transcripts pairs with nothing.
		const mixed = groupFileSeries(named(["Lecture01.srt", "Lecture02.pdf", "Day1.pdf", "Day2.pdf"]));
		assert.equal(pairSeries(mixed.series).size, 0);
	});

	it("chapters named by their number, or numbers on other dates, never pair with lecture transcripts", () => {
		const { series } = groupFileSeries(named(["01_Logic.pdf", "02_Sets.pdf", "03_Algorithms.pdf", "Lecture01.srt", "Lecture02.srt", "Lecture03.srt"]));
		assert.equal(pairSeries(series).size, 0);
		const weeks = groupFileSeries(named(["2026-09-30 Week 1.pdf", "2026-10-07 Week 2.pdf", "Lecture01_2026-09-25.srt", "Lecture02_2026-09-28.srt"]));
		assert.equal(pairSeries(weeks.series).size, 0);
	});

	it("linked files in no series are grouped by their subfolder, by date; lone and root files stay in Other", () => {
		const linked = (id: string, path: string) => file({ id, origin: "linked", path, name: path.split("/").pop()! });
		const groups = fileGroups([
			linked("b", "Lecture slides/2026-09-28 Permutations (lecture slides).pdf"),
			linked("a", "Lecture slides/2026-09-25 Intro and Counting (lecture slides).pdf"),
			linked("c", "Midterm practice/practice exam.pdf"),
			linked("d", "syllabus.txt"),
		]);
		assert.deepEqual(
			groups.map((g) => [g.label, g.items.map((i) => [i.date, i.files[0]!.id])]),
			[
				["Lecture slides", [["2026-09-25", "a"], ["2026-09-28", "b"]]],
				["Other", [[null, "c"], [null, "d"]]],
			],
		);
	});

	it("filterGroups keeps entries with a matching file name, any case, and drops empty groups", () => {
		const groups = fileGroups(CSE21);
		assert.deepEqual(
			filterGroups(groups, "lecture02").map((g) => [g.label, g.items.map((i) => i.label), g.count]),
			[["Lecture", ["Lecture 2"], 2]],
			"matching the transcript keeps the notes beside it",
		);
		assert.deepEqual(filterGroups(groups, "  SYLLABUS ").map((g) => g.label), ["Other"]);
		assert.deepEqual(filterGroups(groups, "nothing like this"), []);
		assert.equal(filterGroups(groups, " ").length, groups.length);
	});

	it("shortDate is a calendar day with its weekday", () => {
		assert.equal(shortDate("2026-09-25"), "Fri Sep 25");
		assert.equal(shortDate("2026-11-01"), "Sun Nov 1");
	});

	it("filesSummary counts files by kind", () => {
		assert.equal(filesSummary([file({ id: "a" }), file({ id: "b", kind: "info" }), file({ id: "c" })]), "3 files, 2 study material, 1 space info");
		assert.equal(filesSummary([file({ id: "a" })]), "1 file, 1 study material, 0 space info");
		assert.equal(filesSummary([]), "0 files");
	});


	it("fileBrowserName", () => {
		assert.equal(fileBrowserName("darwin"), "Finder");
		assert.equal(fileBrowserName("win32"), "File Explorer");
		assert.equal(fileBrowserName("linux"), "Files");
	});
});
