/**
 * A deadline in the Add / Edit deadline dialog: Save sends a new deadline
 * whole and an edited one as only the fields that changed; a draft that
 * can't be saved is caught first; the date, time and file-day labels.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpaceDeadline } from "../../src/shared/core/index.ts";
import {
	addBody,
	changedFields,
	clockLabel,
	deadlineDateLabel,
	draftChanged,
	draftFrom,
	draftProblem,
	dueLabel,
	fileDayLabel,
	filterFiles,
	kindLabel,
	NEW_DEADLINE,
	toggleFile,
	updateBody,
	type DeadlineDraft,
} from "../../src/frontend/components/space-deadlines-model.ts";

const MIDTERM: SpaceDeadline = { id: "exm_1", kind: "exam", name: "Midterm 1", date: "2026-10-29", time: "19:00", fileIds: ["f1", "f2"], done: false };
const HW: SpaceDeadline = { id: "ddl_2", kind: "homework", name: "HW 3", date: "2026-11-02", fileIds: ["f1"], done: true, doneAt: "2026-10-28T10:00:00.000Z" };

const draft = (over: Partial<DeadlineDraft>): DeadlineDraft => ({ kind: "quiz", name: "Quiz", date: "2026-11-02", time: "", fileIds: [], done: false, ...over });

describe("space-deadlines-model", () => {
	it("a draft carries kind, time ('' for none) and done", () => {
		assert.deepEqual(draftFrom(MIDTERM), { kind: "exam", name: "Midterm 1", date: "2026-10-29", time: "19:00", fileIds: ["f1", "f2"], done: false });
		assert.equal(draftFrom(HW).time, "");
		assert.equal(draftFrom(HW).done, true);
	});

	it("an unchanged draft sends nothing and is not a change", () => {
		assert.deepEqual(updateBody(MIDTERM, draftFrom(MIDTERM)), {});
		assert.equal(draftChanged(MIDTERM, draftFrom(MIDTERM)), false);
		assert.equal(draftChanged(null, NEW_DEADLINE), false);
	});

	it("an edited deadline sends only the changed fields, with the name trimmed", () => {
		const d = { ...draftFrom(MIDTERM), name: " Midterm A ", kind: "quiz" as const, fileIds: ["f2", "f1", "f3"] };
		assert.deepEqual(updateBody(MIDTERM, d), { kind: "quiz", name: "Midterm A", fileIds: ["f2", "f1", "f3"] });
		assert.equal(draftChanged(MIDTERM, d), true);
	});

	it("a cleared time sends null; done and undone send done", () => {
		assert.deepEqual(updateBody(MIDTERM, { ...draftFrom(MIDTERM), time: "", done: true }), { time: null, done: true });
		assert.deepEqual(updateBody(HW, { ...draftFrom(HW), time: "17:00", done: false }), { time: "17:00", done: false });
	});

	it("a reordered file list is not a change", () => {
		assert.deepEqual(updateBody(MIDTERM, { ...draftFrom(MIDTERM), fileIds: ["f2", "f1"] }), {});
	});

	it("a new deadline sends its fields; no time sends none", () => {
		assert.deepEqual(addBody(draft({ name: " Quiz 2 ", fileIds: ["f3"], time: "09:30" })), { kind: "quiz", name: "Quiz 2", date: "2026-11-02", time: "09:30", fileIds: ["f3"] });
		assert.deepEqual(addBody(draft({})), { kind: "quiz", name: "Quiz", date: "2026-11-02", fileIds: [] });
		assert.equal(draftChanged(null, { ...NEW_DEADLINE, name: "HW" }), true);
	});

	it("changedFields: only fields that differ by value", () => {
		const seeded = { name: "CSE 21", signature: null as { kind: string; value: string } | null, rules: ["a"] };
		assert.deepEqual(changedFields(seeded, { ...seeded, rules: ["a"] }), {});
		assert.deepEqual(changedFields(seeded, { ...seeded, name: "CSE 29", rules: ["a", "b"] }), { name: "CSE 29", rules: ["a", "b"] });
		assert.deepEqual(changedFields({ ...seeded, signature: { kind: "math", value: "x" } }, seeded), { signature: null });
	});

	it("draftProblem: a deadline needs a name, a real date, and a real time or none", () => {
		assert.equal(draftProblem(draftFrom(MIDTERM)), null);
		assert.equal(draftProblem(draft({ name: " " })), "A deadline needs a name.");
		assert.equal(draftProblem(draft({ date: "" })), "A deadline needs a date.");
		assert.equal(draftProblem(draft({ date: "2026-02-30" })), "A deadline needs a date.");
		assert.equal(draftProblem(draft({ time: "25:00" })), "The time needs to look like 23:59, or be left empty.");
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
		assert.equal(fileDayLabel("Lecture 11 2026-10-27.pdf"), "Oct 27");
		assert.equal(fileDayLabel("Syllabus.pdf"), "");
	});

	it("filterFiles keeps names with every word of the filter, any case", () => {
		const files = [{ name: "Lecture01_2026-09-25.srt" }, { name: "06_Counting.pdf" }, { name: "HW3 counting.pdf" }];
		assert.deepEqual(filterFiles(files, "counting").map((f) => f.name), ["06_Counting.pdf", "HW3 counting.pdf"]);
		assert.deepEqual(filterFiles(files, "hw3 COUNT").map((f) => f.name), ["HW3 counting.pdf"]);
		assert.equal(filterFiles(files, "  ").length, 3);
	});

	it("toggleFile keeps space order and leaves unknown ids alone", () => {
		const order = ["f1", "f2", "f3"];
		assert.deepEqual(toggleFile(["f3"], "f1", order), ["f1", "f3"]);
		assert.deepEqual(toggleFile(["f1", "f3"], "f1", order), ["f3"]);
		assert.deepEqual(toggleFile(["gone", "f2"], "f1", order), ["f1", "f2", "gone"]);
	});
});
