/**
 * The Edit class dialog's exam drafts (redesign plan, Phase 6): Save turns
 * the drafts into the exam routes' writes; drafts that can't be saved are
 * caught first; the row's date and file-count labels.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassExam } from "../src/core/index.ts";
import { draftProblem, draftsFrom, examDateLabel, examWrites, filesLabel, toggleFile } from "../src/components/class-exams-model.ts";

const SAVED: ClassExam[] = [
	{ id: "exm_1", name: "Midterm 1", date: "2026-10-29", fileIds: ["f1", "f2"] },
	{ id: "exm_2", name: "Final", date: "2026-12-09", fileIds: ["f1"] },
];

describe("class-exams-model", () => {
	it("unchanged drafts write nothing", () => {
		assert.deepEqual(examWrites(SAVED, draftsFrom(SAVED)), []);
		assert.deepEqual(examWrites(undefined, []), []);
	});

	it("removals first, then adds and only the changed fields", () => {
		const drafts = draftsFrom(SAVED).filter((d) => d.id !== "exm_2");
		drafts[0] = { ...drafts[0]!, name: " Midterm A ", fileIds: ["f2", "f1", "f3"] };
		drafts.push({ key: "new-1", name: "Quiz", date: "2026-11-02", fileIds: ["f3"] });
		assert.deepEqual(examWrites(SAVED, drafts), [
			{ op: "remove", id: "exm_2" },
			{ op: "update", key: "exm_1", id: "exm_1", body: { name: "Midterm A", fileIds: ["f2", "f1", "f3"] } },
			{ op: "add", key: "new-1", body: { name: "Quiz", date: "2026-11-02", fileIds: ["f3"] } },
		]);
	});

	it("a reordered file list is not a change", () => {
		const drafts = draftsFrom(SAVED);
		drafts[0] = { ...drafts[0]!, fileIds: ["f2", "f1"] };
		assert.deepEqual(examWrites(SAVED, drafts), []);
	});

	it("a created draft (id set after its POST) is never added twice", () => {
		const after: ClassExam[] = [{ id: "exm_9", name: "Quiz", date: "2026-11-02", fileIds: [] }];
		assert.deepEqual(examWrites(after, [{ key: "new-1", id: "exm_9", name: "Quiz", date: "2026-11-02", fileIds: [] }]), []);
	});

	it("draftProblem: every exam needs a name and a real date", () => {
		assert.equal(draftProblem(draftsFrom(SAVED)), null);
		assert.equal(draftProblem([{ key: "n", name: " ", date: "2026-10-29", fileIds: [] }]), "Each exam needs a name.");
		assert.equal(draftProblem([{ key: "n", name: "Quiz", date: "", fileIds: [] }]), "Quiz needs a date.");
		assert.equal(draftProblem([{ key: "n", name: "Quiz", date: "2026-02-30", fileIds: [] }]), "Quiz needs a date.");
	});

	it("examDateLabel reads the calendar date with no time-zone shift", () => {
		assert.equal(examDateLabel("2026-10-29"), "Thu Oct 29");
		assert.equal(examDateLabel("2026-12-09"), "Wed Dec 9");
		assert.equal(examDateLabel(""), "");
		assert.equal(filesLabel(1), "1 file");
		assert.equal(filesLabel(3), "3 files");
	});

	it("toggleFile keeps class order and leaves unknown ids alone", () => {
		const order = ["f1", "f2", "f3"];
		assert.deepEqual(toggleFile(["f3"], "f1", order), ["f1", "f3"]);
		assert.deepEqual(toggleFile(["f1", "f3"], "f1", order), ["f3"]);
		assert.deepEqual(toggleFile(["gone", "f2"], "f1", order), ["f1", "f2", "gone"]);
	});
});
