/**
 * The Edit class dialog's deadline drafts (plan 2026-10-28; exams before
 * that): Save turns the drafts into the deadline routes' writes; drafts
 * that can't be saved are caught first; the row's date, time and
 * file-count labels.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClassDeadline } from "../src/core/index.ts";
import {
	changedFields,
	clockLabel,
	deadlineDateLabel,
	deadlineWrites,
	draftProblem,
	draftsFrom,
	dropRemoved,
	dueLabel,
	filesLabel,
	hasUnsavedChanges,
	kindLabel,
	toggleFile,
	type DeadlineDraft,
} from "../src/components/class-deadlines-model.ts";

const SAVED: ClassDeadline[] = [
	{ id: "exm_1", kind: "exam", name: "Midterm 1", date: "2026-10-29", time: "19:00", fileIds: ["f1", "f2"], done: false },
	{ id: "ddl_2", kind: "homework", name: "HW 3", date: "2026-11-02", fileIds: ["f1"], done: true, doneAt: "2026-10-28T10:00:00.000Z" },
];

const draft = (over: Partial<DeadlineDraft>): DeadlineDraft => ({
	key: "new-1",
	kind: "quiz",
	name: "Quiz",
	date: "2026-11-02",
	time: "",
	fileIds: [],
	done: false,
	...over,
});

describe("class-deadlines-model", () => {
	it("drafts carry kind, time ('' for none) and done", () => {
		assert.deepEqual(draftsFrom(SAVED).map((d) => [d.key, d.kind, d.time, d.done]), [
			["exm_1", "exam", "19:00", false],
			["ddl_2", "homework", "", true],
		]);
	});

	it("unchanged drafts write nothing", () => {
		assert.deepEqual(deadlineWrites(SAVED, draftsFrom(SAVED)), []);
		assert.deepEqual(deadlineWrites(undefined, []), []);
	});

	it("removals first, then adds and only the changed fields", () => {
		const drafts = draftsFrom(SAVED).filter((d) => d.id !== "ddl_2");
		drafts[0] = { ...drafts[0]!, name: " Midterm A ", kind: "quiz", fileIds: ["f2", "f1", "f3"] };
		drafts.push(draft({ fileIds: ["f3"], time: "09:30" }));
		assert.deepEqual(deadlineWrites(SAVED, drafts), [
			{ op: "remove", id: "ddl_2" },
			{ op: "update", key: "exm_1", id: "exm_1", body: { kind: "quiz", name: "Midterm A", fileIds: ["f2", "f1", "f3"] } },
			{ op: "add", key: "new-1", body: { kind: "quiz", name: "Quiz", date: "2026-11-02", time: "09:30", fileIds: ["f3"] }, done: false },
		]);
	});

	it("a cleared time writes null; done and undone write done", () => {
		const drafts = draftsFrom(SAVED);
		drafts[0] = { ...drafts[0]!, time: "", done: true };
		drafts[1] = { ...drafts[1]!, done: false, time: "17:00" };
		assert.deepEqual(deadlineWrites(SAVED, drafts), [
			{ op: "update", key: "exm_1", id: "exm_1", body: { time: null, done: true } },
			{ op: "update", key: "ddl_2", id: "ddl_2", body: { time: "17:00", done: false } },
		]);
	});

	it("a new deadline with no time sends none; a ticked one says so", () => {
		assert.deepEqual(deadlineWrites([], [draft({ done: true })]), [
			{ op: "add", key: "new-1", body: { kind: "quiz", name: "Quiz", date: "2026-11-02", fileIds: [] }, done: true },
		]);
	});

	it("a reordered file list is not a change", () => {
		const drafts = draftsFrom(SAVED);
		drafts[0] = { ...drafts[0]!, fileIds: ["f2", "f1"] };
		assert.deepEqual(deadlineWrites(SAVED, drafts), []);
	});

	it("a created draft (id set after its POST) is never added twice", () => {
		const after: ClassDeadline[] = [{ id: "ddl_9", kind: "quiz", name: "Quiz", date: "2026-11-02", fileIds: [], done: false }];
		assert.deepEqual(deadlineWrites(after, [draft({ id: "ddl_9" })]), []);
	});

	it("diffs against the seeded copy, so an agent's change while the dialog is open survives", () => {
		// The agent added ddl_new and edited exm_1 after the drafts were seeded
		// from SAVED; the learner only ticked HW 3 undone.
		const drafts = draftsFrom(SAVED);
		drafts[1] = { ...drafts[1]!, done: false };
		assert.deepEqual(deadlineWrites(SAVED, drafts), [{ op: "update", key: "ddl_2", id: "ddl_2", body: { done: false } }]);
	});

	it("a draft whose deadline is gone from the saved copy is never added back as new", () => {
		const drafts = draftsFrom(SAVED);
		drafts[0] = { ...drafts[0]!, name: "Midterm A" };
		assert.deepEqual(deadlineWrites([SAVED[1]!], drafts), []);
	});

	it("dropRemoved: a removed deadline the learner didn't edit leaves the drafts and the copy; an edited one stays", () => {
		const drafts = draftsFrom(SAVED);
		assert.equal(dropRemoved(SAVED, drafts, new Set()), null, "nothing removed");
		assert.deepEqual(dropRemoved(SAVED, drafts, new Set(["ddl_2"])), { seeded: [SAVED[0]!], drafts: [drafts[0]!] });
		const edited = [drafts[0]!, { ...drafts[1]!, done: false }];
		assert.equal(dropRemoved(SAVED, edited, new Set(["ddl_2"])), null, "the learner's edit waits for Save");
		const reordered = [{ ...drafts[0]!, fileIds: ["f2", "f1"] }, drafts[1]!];
		assert.deepEqual(dropRemoved(SAVED, reordered, new Set(["exm_1"]))?.drafts, [drafts[1]!], "a reordered file list is not an edit");
		assert.deepEqual(dropRemoved(SAVED, [drafts[0]!], new Set(["ddl_2"])), { seeded: [SAVED[0]!], drafts: [drafts[0]!] }, "already removed in the dialog");
	});

	it("hasUnsavedChanges: a field or a deadline differs; an untouched blank new row doesn't count", () => {
		const seeded = { fields: { name: "CSE 21", rules: [] as string[] }, deadlines: SAVED };
		const blank = draft({ name: "", date: "", kind: "homework" });
		assert.equal(hasUnsavedChanges(seeded, { name: "CSE 21", rules: [] }, draftsFrom(SAVED)), false);
		assert.equal(hasUnsavedChanges(seeded, { name: "CSE 21", rules: [] }, [...draftsFrom(SAVED), blank]), false);
		assert.equal(hasUnsavedChanges(seeded, { name: "CSE 21", rules: [] }, [...draftsFrom(SAVED), { ...blank, name: "HW" }]), true);
		assert.equal(hasUnsavedChanges(seeded, { name: "CSE 21", rules: ["Use LaTeX"] }, draftsFrom(SAVED)), true);
		assert.equal(hasUnsavedChanges(seeded, { name: "CSE 21", rules: [] }, draftsFrom(SAVED).slice(1)), true, "a removed deadline");
	});

	it("changedFields: only fields that differ by value", () => {
		const seeded = { name: "CSE 21", signature: null as { kind: string; value: string } | null, rules: ["a"] };
		assert.deepEqual(changedFields(seeded, { ...seeded, rules: ["a"] }), {});
		assert.deepEqual(changedFields(seeded, { ...seeded, name: "CSE 29", rules: ["a", "b"] }), { name: "CSE 29", rules: ["a", "b"] });
		assert.deepEqual(changedFields({ ...seeded, signature: { kind: "math", value: "x" } }, seeded), { signature: null });
	});

	it("draftProblem: every deadline needs a name, a real date, and a real time or none", () => {
		assert.equal(draftProblem(draftsFrom(SAVED)), null);
		assert.equal(draftProblem([draft({ name: " " })]), "Each deadline needs a name.");
		assert.equal(draftProblem([draft({ date: "" })]), "Quiz needs a date.");
		assert.equal(draftProblem([draft({ date: "2026-02-30" })]), "Quiz needs a date.");
		assert.equal(draftProblem([draft({ time: "25:00" })]), "Quiz needs a time like 23:59, or no time.");
	});

	it("labels: calendar date with no time-zone shift, 12-hour clock, kind", () => {
		assert.equal(deadlineDateLabel("2026-10-29"), "Thu Oct 29");
		assert.equal(deadlineDateLabel("2026-12-09"), "Wed Dec 9");
		assert.equal(deadlineDateLabel(""), "");
		assert.equal(clockLabel("23:59"), "11:59 PM");
		assert.equal(clockLabel("00:05"), "12:05 AM");
		assert.equal(clockLabel("12:00"), "12:00 PM");
		assert.equal(clockLabel(""), "");
		assert.equal(dueLabel("2026-10-30", "23:59"), "Fri Oct 30, 11:59 PM");
		assert.equal(dueLabel("2026-10-30", undefined), "Fri Oct 30");
		assert.equal(kindLabel("homework"), "Homework");
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
