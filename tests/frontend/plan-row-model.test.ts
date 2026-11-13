import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeworkProblemLine, homeworkRow, jumpTarget, practiceRow, rightCountLabel, stepsRow } from "../../src/frontend/components/lesson/plan-row-model.ts";
import type { HomeworkProblem, LessonStop, PlanStepBar } from "../../src/shared/core/index.ts";

const bar: PlanStepBar = {
	currentIndex: 1,
	steps: [
		{ id: "a", title: "The update rule", status: "visited", answers: [{ toolCallId: "c1", outcome: "right" }, { toolCallId: "c2", outcome: "wrong", level: 4 }] },
		{ id: "b", title: "Gradient as an expectation", status: "current", answers: [] },
		{ id: "c", title: "Variance", status: "upcoming", answers: [] },
	],
};

describe("the plan row's logic", () => {
	it("'n of m right' counts graded answers only", () => {
		assert.equal(rightCountLabel(bar.steps[0]!.answers), "1 of 2 right");
		assert.equal(rightCountLabel([]), null);
		assert.equal(rightCountLabel([{ toolCallId: "e", outcome: "ungraded" }]), null, "explain answers are not graded");
	});

	it("only a done step with an answer jumps back", () => {
		assert.equal(jumpTarget(bar.steps[0]!), "c1");
		assert.equal(jumpTarget(bar.steps[1]!), null, "the current step does not jump");
		assert.equal(jumpTarget({ ...bar.steps[0]!, answers: [] }), null);
	});

	it("a plan lesson's row: the step, a block per step, the current step's name", () => {
		const row = stepsRow(bar)!;
		assert.equal(row.count, "Step 2 of 3");
		assert.deepEqual(row.blocks.map((b) => [b.tone, b.jump]), [["done", "c1"], ["current", null], ["later", null]]);
		assert.equal(row.here, "Gradient as an expectation");
		assert.equal(stepsRow({ steps: [], currentIndex: -1 }), null);
		assert.equal(stepsRow({ ...bar, currentIndex: -1, steps: bar.steps.map((s) => ({ ...s, status: "upcoming" as const })) })!.count, "Step 0 of 3", "before the first question");
	});

	it("a homework row: done count, tones by problem, the open problem's name", () => {
		const problems: HomeworkProblem[] = [
			{ number: "1", title: "Gradient", text: "", done: true },
			{ number: "2b", title: "Step size", text: "", done: false },
			{ number: "3", title: "Momentum", text: "", done: false },
		];
		const row = homeworkRow(problems, "2b")!;
		assert.equal(row.count, "1 of 3 done");
		assert.deepEqual(row.blocks.map((b) => b.tone), ["done", "current", "later"]);
		assert.equal(row.here, "Problem 2b");
		assert.equal(homeworkRow(problems, null)!.here, null);
		assert.equal(homeworkRow([], null), null);
		assert.equal(homeworkRow([{ number: "Ex. 4", title: "Sums", text: "", done: false }], "Ex. 4")!.here, "Ex. 4", "a name the assignment wrote stays");
	});

	it("a practice row: solved in ink, missed light, the count only once a problem is finished", () => {
		const row = practiceRow({ blocks: ["solved", "missed", "current"], solved: 1, finished: 2 })!;
		assert.equal(row.count, "1 of 2 solved");
		assert.deepEqual(row.blocks.map((b) => b.tone), ["done", "later", "current"]);
		assert.equal(practiceRow({ blocks: ["current"], solved: 0, finished: 0 })!.count, null);
		assert.equal(practiceRow({ blocks: [], solved: 0, finished: 0 }), null);
	});

	it("the line over an open homework problem names the assignment, the problem and the part", () => {
		assert.equal(homeworkProblemLine("HW6", 7, "3", null), "HW6, problem 3 of 7");
		assert.equal(homeworkProblemLine("HW6", 7, "3", "b"), "HW6, problem 3 of 7, part b");
		assert.equal(homeworkProblemLine("HW6", 7, "Ex. 4", null), "HW6, Ex. 4", "a name the assignment wrote stays");
	});
});

describe("the plan row at a stop", () => {
	const stop: LessonStop = { kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "b", stopOf: "c1", next: "Variance", activeMinutes: 48, keptGoing: false };

	it("stays on the topic that just ended, its block in ink", () => {
		const row = stepsRow(bar, stop)!;
		assert.equal(row.count, "Step 2 of 3");
		assert.equal(row.here, "Gradient as an expectation");
		assert.deepEqual(row.blocks.map((b) => b.tone), ["done", "done", "later"]);
	});

	it("the last topic's end reads the same", () => {
		assert.deepEqual(stepsRow(bar, { ...stop, kind: "end", next: null })!.blocks.map((b) => b.tone), ["done", "done", "later"]);
	});

	it("after Keep going, and at a problem's stop, the block is current again", () => {
		assert.deepEqual(stepsRow(bar, { ...stop, keptGoing: true })!.blocks.map((b) => b.tone), ["done", "current", "later"]);
		assert.deepEqual(stepsRow(bar, { ...stop, kind: "problem" })!.blocks.map((b) => b.tone), ["done", "current", "later"]);
	});
});
