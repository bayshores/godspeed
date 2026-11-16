import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeworkRow, homeworkStartLabel, jumpTarget, planBranches, practiceRow, rightCountLabel, rowColumns, stepsRow } from "../../src/frontend/components/lesson/plan-row-model.ts";
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

	it("a plan lesson's row: every step with its tone, and how a done step's answers went on hover", () => {
		const row = stepsRow(bar)!;
		assert.deepEqual(row.map((s) => [s.name, s.tone, s.jump]), [["The update rule", "done", "c1"], ["Gradient as an expectation", "current", null], ["Variance", "later", null]]);
		assert.deepEqual(row.map((s) => s.hint), ["The update rule, 1 of 2 right", "Gradient as an expectation", "Variance"]);
		assert.equal(stepsRow({ steps: [], currentIndex: -1 }), null);
		assert.deepEqual(stepsRow({ ...bar, currentIndex: -1, steps: bar.steps.map((s) => ({ ...s, status: "upcoming" as const })) })!.map((s) => s.tone), ["later", "later", "later"], "before the first question");
	});

	it("a plan branches when a step has two or more steps right before or after it", () => {
		const ids = ["a", "b", "c", "d"];
		assert.equal(planBranches(ids, []), false, "a study plan has no links");
		assert.equal(planBranches(ids, [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }]), false, "one chain");
		assert.equal(planBranches(ids, [{ from: "a", to: "b" }, { from: "a", to: "c" }]), true, "two after a");
		assert.equal(planBranches(ids, [{ from: "a", to: "c" }, { from: "b", to: "c" }]), true, "two before c");
		assert.equal(planBranches(ids, [{ from: "a", to: "b" }, { from: "a", to: "b" }]), false, "a repeated link counts once");
		assert.equal(planBranches(ids, [{ from: "a", to: "b" }, { from: "a", to: "x" }]), false, "a link to a step not in the plan is left out");
	});

	it("a homework row: every problem by its own number, tones by problem, a done one going back to its card", () => {
		const problems: HomeworkProblem[] = [
			{ number: "1", title: "Gradient", text: "", done: true },
			{ number: "2b", title: "Step size", text: "", done: false },
			{ number: "3", title: "Momentum", text: "", done: true },
		];
		const row = homeworkRow(problems, "2b", { "1": "p1", "2b": "p2" })!;
		assert.deepEqual(row.map((s) => [s.number, s.name, s.tone, s.jump]), [["1", "Gradient", "done", "p1"], ["2b", "Step size", "current", null], ["3", "Momentum", "done", null]]);
		assert.equal(homeworkRow([], null, {}), null);
	});

	it("a plan step's number is its place in the plan", () => {
		assert.deepEqual(stepsRow(bar)!.map((s) => s.number), ["1", "2", "3"]);
	});

	it("the homework go-ahead names the first problem not done, as the assignment numbers it", () => {
		const problem = (number: string, done: boolean): HomeworkProblem => ({ number, title: "", text: "", done });
		assert.equal(homeworkStartLabel([problem("1", true), problem("2", false), problem("3", false)]), "Start problem 2");
		assert.equal(homeworkStartLabel([problem("1", true), problem("Ex. 4", false)]), "Start Ex. 4");
		assert.equal(homeworkStartLabel([problem("1", true), problem("2", true)]), null);
		assert.equal(homeworkStartLabel([]), null);
	});

	it("a practice row: solved in ink, missed light, the count only once a problem is finished", () => {
		const row = practiceRow({ blocks: ["solved", "missed", "current"], solved: 1, finished: 2 })!;
		assert.equal(row.count, "1 of 2 solved");
		assert.deepEqual(row.blocks.map((b) => b.tone), ["done", "later", "current"]);
		assert.equal(practiceRow({ blocks: ["current"], solved: 0, finished: 0 })!.count, null);
		assert.equal(practiceRow({ blocks: [], solved: 0, finished: 0 }), null);
	});
});

describe("the plan row at a stop", () => {
	const stop: LessonStop = { kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "b", stopOf: "c1", next: "Variance", activeMinutes: 48, keptGoing: false };

	it("shows the topic that just ended as finished, in ink", () => {
		assert.deepEqual(stepsRow(bar, stop)!.map((s) => s.tone), ["done", "done", "later"]);
	});

	it("the last topic's end reads the same", () => {
		assert.deepEqual(stepsRow(bar, { ...stop, kind: "end", next: null })!.map((s) => s.tone), ["done", "done", "later"]);
	});

	it("after Keep going, and at a problem's stop, the step is current again", () => {
		assert.deepEqual(stepsRow(bar, { ...stop, keptGoing: true })!.map((s) => s.tone), ["done", "current", "later"]);
		assert.deepEqual(stepsRow(bar, { ...stop, kind: "problem" })!.map((s) => s.tone), ["done", "current", "later"]);
	});
});

describe("rowColumns", () => {
	it("fills the lines evenly: as few lines as fit, the cells spread over them", () => {
		assert.equal(rowColumns(6, 4 * 150 + 3 * 12, 150, 12), 3, "room for 4: 3 and 3, not 4 and 2");
		assert.equal(rowColumns(6, 6 * 150 + 5 * 12, 150, 12), 6, "room for all: one line");
		assert.equal(rowColumns(7, 4 * 150 + 3 * 12, 150, 12), 4, "7 in room for 4: 4 and 3");
		assert.equal(rowColumns(3, 100, 150, 12), 1, "too narrow for two: one a line");
		assert.equal(rowColumns(5, null, 150, 12), 5, "unmeasured: one line");
	});
});
