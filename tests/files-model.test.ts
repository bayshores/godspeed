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
	dropCopy,
	fileAnchorId,
	fileIdFromHash,
	fileState,
	shortenHome,
	splitByKind,
	studiedFill,
} from "../src/components/files/files-model.ts";

function file(over: Partial<ClassFile>): ClassFile {
	return { id: "f_1", origin: "copied", name: "L1.pdf", path: "f_1/L1.pdf", kind: "study", contentFp: "", status: "ready", addedAt: "", ...over };
}
const cov = (facts: number, inLessons: number): FileCoverage => ({ fileId: "f_1", name: "L1.pdf", facts, inLessons, share: facts ? inLessons / facts : null });

describe("files-model", () => {
	it("fileState follows the pipeline status", () => {
		assert.deepEqual(fileState(file({ status: "extracting" }), undefined), { kind: "building" });
		assert.deepEqual(fileState(file({ status: "pending" }), undefined), { kind: "waiting" });
		assert.deepEqual(fileState(file({ status: "pending", kind: "info" }), undefined), { kind: "none" }, "course info has nothing to do");
		assert.deepEqual(fileState(file({ status: "failed", error: "boom" }), undefined), { kind: "failed", label: "Failed", error: "boom" });
		assert.deepEqual(fileState(file({ status: "needs-whisper" }), undefined), { kind: "failed", label: "Needs whisper" });
		assert.deepEqual(fileState(file({ status: "ready" }), cov(10, 4)), { kind: "coverage", facts: 10, inLessons: 4, share: 0.4 });
		assert.deepEqual(fileState(file({ status: "ready" }), undefined), { kind: "none" }, "no coverage yet: nothing");
		assert.deepEqual(fileState(file({ status: "ready", kind: "info" }), cov(10, 4)), { kind: "none" }, "course info shows no coverage");
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
});
