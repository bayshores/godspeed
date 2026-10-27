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
	coverageBar,
	factsLabel,
	fileAnchorId,
	fileIdFromHash,
	fileState,
	shortenHome,
	splitByKind,
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

	it("coverageBar: unstudied files are white, others fill by share", () => {
		assert.deepEqual(coverageBar({ facts: 22, inLessons: 0, share: 0 }), { unstudied: true, fill: 0 });
		assert.deepEqual(coverageBar({ facts: 10, inLessons: 4, share: 0.4 }), { unstudied: false, fill: 0.4 });
		assert.deepEqual(coverageBar({ facts: 0, inLessons: 0, share: null }), { unstudied: false, fill: 0 }, "no facts: an empty bar");
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

	it("shortenHome and factsLabel", () => {
		assert.equal(shortenHome("/Users/me/School/CSE 21"), "~/School/CSE 21");
		assert.equal(shortenHome("/home/me/x"), "~/x");
		assert.equal(shortenHome("/Volumes/USB/x"), "/Volumes/USB/x");
		assert.equal(factsLabel(1), "1 fact");
		assert.equal(factsLabel(24), "24 facts");
	});
});
