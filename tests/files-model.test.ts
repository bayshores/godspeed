/**
 * The Files page's pure helpers (redesign plan, Phase 6): the row's state
 * from a file's status and coverage, the coverage bar, the hash anchor,
 * the two sections and the home-folder shortening.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassFile, FileCoverage } from "../src/core/index.ts";
import {
	canRemove,
	canRetry,
	confirmCopy,
	dropCopy,
	fileAnchorId,
	fileIdFromHash,
	fileState,
	shortenHome,
	fileBrowserName,
	splitByKind,
	studiedFill,
} from "../src/components/files/files-model.ts";

function file(over: Partial<ClassFile>): ClassFile {
	return { id: "f_1", origin: "copied", name: "L1.pdf", path: "f_1/L1.pdf", kind: "study", contentFp: "", status: "ready", addedAt: "", ...over };
}
const cov = (facts: number, inLessons: number): FileCoverage => ({ fileId: "f_1", name: "L1.pdf", facts, inLessons, share: facts ? inLessons / facts : null });

describe("files-model", () => {
	it("fileState follows the pipeline status", () => {
		assert.deepEqual(fileState(file({ status: "extracting" }), undefined, true), { kind: "building" });
		assert.deepEqual(fileState(file({ status: "pending" }), undefined, true), { kind: "waiting", label: "Waiting" });
		assert.deepEqual(fileState(file({ status: "pending" }), undefined, false), { kind: "waiting", label: "Waiting for your agent" }, "no agent is teaching");
		assert.deepEqual(fileState(file({ status: "pending", kind: "info" }), undefined, false), { kind: "none" }, "course info has nothing to do");
		assert.deepEqual(fileState(file({ status: "failed", error: "boom" }), undefined, true), { kind: "failed", label: "Failed", error: "boom" });
		assert.deepEqual(fileState(file({ status: "needs-whisper", error: "Run brew" }), undefined, true), {
			kind: "failed",
			label: "Needs a speech tool",
			install: "brew install whisper-cpp ffmpeg",
		});
		assert.deepEqual(fileState(file({ status: "ready" }), cov(10, 4), true), { kind: "coverage", facts: 10, inLessons: 4, share: 0.4 });
		assert.deepEqual(fileState(file({ status: "ready" }), undefined, true), { kind: "none" }, "no coverage yet: nothing");
		assert.deepEqual(fileState(file({ status: "ready", kind: "info" }), cov(10, 4), true), { kind: "none" }, "course info shows no coverage");
	});

	it("confirmCopy says how many files and facts go before Unlink, Remove and Move to Course info", () => {
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
			action: "Remove",
		});
		assert.equal(
			confirmCopy({ kind: "remove", file: files[3]! }, "CSE 21", files, coverage).body,
			"It leaves CSE 21. Your original file is not touched. This cannot be undone.",
			"course info has no facts",
		);

		assert.deepEqual(confirmCopy({ kind: "move", file: files[0]! }, "CSE 21", files, coverage), {
			title: "Move to Course info?",
			body: "Its 30 facts leave the graph. The teacher can still read it.",
			action: "Move",
		});
	});

	it("studiedFill is the share of facts that came up in lessons", () => {
		assert.equal(studiedFill({ facts: 22, inLessons: 0 }), 0);
		assert.equal(studiedFill({ facts: 10, inLessons: 4 }), 0.4);
		assert.equal(studiedFill({ facts: 0, inLessons: 0 }), 0, "no facts: an empty bar");
	});

	it("dropCopy says what a drop will do", () => {
		assert.deepEqual(dropCopy("study", { type: "finder", count: 2 }), { title: "Drop to add 2 files as study material" });
		assert.deepEqual(dropCopy("info", { type: "finder", count: 1 }), { title: "Drop to add 1 file as course info" });
		assert.deepEqual(dropCopy("study", { type: "finder", count: 0 }), { title: "Drop to add files as study material" });
		assert.deepEqual(dropCopy("info", { type: "row", facts: 28 }), {
			title: "Move to Course info",
			detail: "Its 28 facts leave the graph. The teacher can still read it.",
		});
		assert.equal(dropCopy("info", { type: "row", facts: null }).detail, "Its facts leave the graph. The teacher can still read it.");
		assert.deepEqual(dropCopy("study", { type: "row", facts: null }), { title: "Move to Study material", detail: "It gets turned into facts for the graph." });
	});

	it("Retry and Remove follow the old dialog's rules", () => {
		assert.equal(canRetry(file({ status: "failed" })), true);
		assert.equal(canRetry(file({ status: "needs-whisper" })), true);
		assert.equal(canRetry(file({ status: "pending" })), true);
		assert.equal(canRetry(file({ status: "ready" })), false);
		assert.equal(canRemove(file({ origin: "copied" })), true);
		assert.equal(canRemove(file({ origin: "linked" })), false);
	});

	it("the hash anchor round-trips (the Overview's /class/files#file-<id>)", () => {
		assert.equal(fileAnchorId("f_abc"), "file-f_abc");
		assert.equal(fileIdFromHash("#file-f_abc"), "f_abc");
		assert.equal(fileIdFromHash("#file-f%5Fabc"), "f_abc");
		assert.equal(fileIdFromHash("#other"), null);
		assert.equal(fileIdFromHash(""), null);
	});

	it("splitByKind keeps class order", () => {
		const files = [file({ id: "a" }), file({ id: "b", kind: "info" }), file({ id: "c" })];
		const { study, info } = splitByKind(files);
		assert.deepEqual(study.map((f) => f.id), ["a", "c"]);
		assert.deepEqual(info.map((f) => f.id), ["b"]);
	});

	it("shortenHome", () => {
		assert.equal(shortenHome("/Users/me/School/CSE 21"), "~/School/CSE 21");
		assert.equal(shortenHome("/home/me/x"), "~/x");
		assert.equal(shortenHome("/Volumes/USB/x"), "/Volumes/USB/x");
	});

	it("fileBrowserName", () => {
		assert.equal(fileBrowserName("darwin"), "Finder");
		assert.equal(fileBrowserName("win32"), "File Explorer");
		assert.equal(fileBrowserName("linux"), "Files");
	});
});
