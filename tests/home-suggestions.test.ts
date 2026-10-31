/**
 * Home's "Suggested for <class>" rows: which lesson is
 * Continue, Next up, which Work-on-next list counts (the soonest open
 * deadline with files, else the class's), the two-row cap, and the
 * Continue step.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeadlineProgress, LessonProgress, PlanTree, ProgressPayload, TopicProgress, WorkOnNextItem } from "../src/core/index.ts";
import { planStepBar } from "../src/core/index.ts";
import {
	homeSuggestions,
	lessonStep,
	suggestionKey,
	upcomingDeadline,
	workOnNextList,
	WORK_ON_NEXT_ROWS,
} from "../src/components/home/suggestions-model.ts";

function lesson(chatId: string, updatedAt: string): LessonProgress {
	return { chatId, title: chatId, kind: "teach", updatedAt, answers: [], right: 0, answered: 0, score: null };
}

function topic(id: string, status: TopicProgress["status"]): TopicProgress {
	return {
		id,
		name: `Topic ${id}`,
		members: [],
		answered: 0,
		right: 0,
		wrong: 0,
		dontKnow: 0,
		rate: null,
		status,
		color: "#6E6E6E",
		overconfident: false,
		answers: [],
		column: 0,
	};
}

function item(topicId: string, status: TopicProgress["status"] = "weak"): WorkOnNextItem {
	return { topicId, name: `Topic ${topicId}`, status, reason: "r" };
}

function deadline(id: string, daysUntil: number, workOnNext: WorkOnNextItem[], over: Partial<DeadlineProgress> = {}): DeadlineProgress {
	return {
		id,
		kind: "exam",
		name: id,
		date: "2026-11-01",
		done: false,
		daysUntil,
		files: [{ id: "f1", name: "Lecture 1" }],
		topicIds: [],
		counts: { strong: 0, shaky: 0, weak: 0, untested: 0 },
		workOnNext,
		ready: null,
		topics: [],
		...over,
	};
}

function payload(over: Partial<ProgressPayload> = {}): ProgressPayload {
	return {
		classId: "cls_1",
		today: "2026-10-27",
		topicsAt: null,
		grouping: false,
		topics: [topic("a", "weak"), topic("b", "untested"), topic("c", "shaky"), topic("d", "weak")],
		topicLinks: [],
		facts: [],
		files: [],
		nextUp: null,
		lessons: [],
		calibration: { levels: [], sureButWrong: [] },
		deadlines: [],
		overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [] },
		totals: { answered: 0, right: 0, wrong: 0, dontKnow: 0, rate: null },
		...over,
	};
}

describe("homeSuggestions", () => {
	it("nothing loaded: no rows", () => {
		assert.deepEqual(homeSuggestions(null), []);
		assert.deepEqual(homeSuggestions(payload()), []);
	});

	it("Continue is the newest lesson (lessons come newest first), then Next up, then Work on next", () => {
		const file = { fileId: "f4", name: "Lecture 4.pdf", facts: 22, inLessons: 0, share: 0 };
		const rows = homeSuggestions(
			payload({
				lessons: [lesson("newest", "2026-10-27T12:00:00Z"), lesson("older", "2026-10-26T12:00:00Z")],
				nextUp: file,
				overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [item("a")] },
			}),
		);
		assert.deepEqual(rows.map((r) => r.kind), ["continue", "next-up", "work-on-next"]);
		assert.equal(rows[0]!.kind === "continue" && rows[0]!.lesson.chatId, "newest");
		assert.equal(rows[1]!.kind === "next-up" && rows[1]!.file.fileId, "f4");
	});

	it(`at most ${WORK_ON_NEXT_ROWS} Work-on-next rows, each with its topic`, () => {
		const rows = homeSuggestions(
			payload({ overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [item("a"), item("b", "untested"), item("c")] } }),
		);
		assert.equal(rows.length, WORK_ON_NEXT_ROWS);
		assert.deepEqual(rows.map((r) => (r.kind === "work-on-next" ? r.topic.id : "")), ["a", "b"]);
	});

	it("a Work-on-next item whose topic is gone is skipped", () => {
		const rows = homeSuggestions(
			payload({ overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [item("zz"), item("d")] } }),
		);
		assert.deepEqual(rows.map((r) => (r.kind === "work-on-next" ? r.topic.id : "")), ["d"]);
	});

	it("row keys are unique per kind and id", () => {
		const rows = homeSuggestions(
			payload({ lessons: [lesson("x", "2026-10-27T12:00:00Z")], overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [item("a"), item("c")] } }),
		);
		assert.deepEqual(rows.map(suggestionKey), ["continue:x", "work:a", "work:c"]);
	});
});

describe("which Work-on-next list counts", () => {
	const overall = { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [item("d")] };

	it("the soonest deadline that hasn't passed", () => {
		const deadlines = [deadline("past", -3, [item("a")]), deadline("soon", 4, [item("c")]), deadline("later", 30, [item("b")])];
		assert.equal(upcomingDeadline(deadlines)?.id, "soon");
		assert.deepEqual(workOnNextList({ deadlines, overall }).map((i) => i.topicId), ["c"]);
	});

	it("a deadline today still counts", () => {
		assert.equal(upcomingDeadline([deadline("today", 0, [])])?.id, "today");
	});

	it("done deadlines and ones with no files are skipped", () => {
		const deadlines = [
			deadline("done", 1, [item("a")], { done: true }),
			deadline("no-files", 2, [], { kind: "homework", files: [] }),
			deadline("quiz", 3, [item("c")], { kind: "quiz" }),
		];
		assert.equal(upcomingDeadline(deadlines)?.id, "quiz");
	});

	it("no deadline ahead: the class-wide list", () => {
		assert.deepEqual(workOnNextList({ deadlines: [deadline("past", -1, [item("a")])], overall }).map((i) => i.topicId), ["d"]);
		assert.deepEqual(workOnNextList({ deadlines: [], overall }).map((i) => i.topicId), ["d"]);
	});
});

describe("lessonStep (the Continue row's step N / M)", () => {
	const tree: PlanTree = {
		nodes: [
			{ id: "n1", title: "One", status: "pending" },
			{ id: "n2", title: "Two", status: "pending" },
			{ id: "n3", title: "Three", status: "pending" },
		],
		edges: [
			{ from: "n1", to: "n2" },
			{ from: "n2", to: "n3" },
		],
	} as unknown as PlanTree;

	it("practice lessons and lessons without a plan have no step", () => {
		assert.equal(lessonStep({ kind: "practice", tree, messages: [] }), null);
		assert.equal(lessonStep({ kind: "teach", messages: [] }), null);
		assert.equal(lessonStep({ kind: "teach", tree: null, messages: [] }), null);
		assert.equal(lessonStep({ tree: { nodes: [], edges: [] } as unknown as PlanTree, messages: [] }), null);
	});

	it("matches the lesson's step bar: total = plan steps, position = the current step", () => {
		const step = lessonStep({ kind: "teach", tree, messages: [] });
		const bar = planStepBar(tree, []);
		const expected = bar.currentIndex >= 0 ? bar.currentIndex + 1 : bar.steps.filter((s) => s.status === "visited").length;
		assert.deepEqual(step, { position: expected, total: 3 });
	});
});
