import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localDay, type DeadlineProgress, type ProgressPayload } from "../../src/shared/core/index.ts";
import type { OpenDeadline } from "../../src/frontend/components/deadlines-model.ts";
import {
	spacesSettled,
	countLeft,
	foldSpacesProgress,
	laterRow,
	longDay,
	todayLists,
	mainRowId,
	nextCard,
	todayRow,
	todaySections,
	type SpacesProgress,
} from "../../src/frontend/components/home-page/home-page-model.ts";

const EMPTY: SpacesProgress = { progress: new Map(), errors: new Map() };
const payload = (tag: string) => ({ tag }) as unknown as ProgressPayload;

describe("foldSpacesProgress", () => {
	it("records a failed space's error next to the others' payloads", () => {
		const state = foldSpacesProgress(EMPTY, ["a", "b"], [
			{ spaceId: "a", payload: payload("a1") },
			{ spaceId: "b", error: "HTTP 500" },
		]);
		assert.deepEqual([...state.progress.keys()], ["a"]);
		assert.deepEqual([...state.errors], [["b", "HTTP 500"]]);
	});

	it("keeps a space's earlier payload when a later read fails, and clears the error on success", () => {
		const first = foldSpacesProgress(EMPTY, ["a"], [{ spaceId: "a", payload: payload("a1") }]);
		const failed = foldSpacesProgress(first, ["a"], [{ spaceId: "a", error: "offline" }]);
		assert.equal(failed.progress.get("a"), first.progress.get("a"));
		assert.equal(failed.errors.get("a"), "offline");
		const back = foldSpacesProgress(failed, ["a"], [{ spaceId: "a", payload: payload("a2") }]);
		assert.equal(back.errors.size, 0);
	});

	it("drops spaces no longer shown", () => {
		const first = foldSpacesProgress(EMPTY, ["a", "b"], [
			{ spaceId: "a", payload: payload("a1") },
			{ spaceId: "b", error: "x" },
		]);
		const next = foldSpacesProgress(first, ["a"], [{ spaceId: "a", payload: payload("a1") }]);
		assert.deepEqual([...next.progress.keys()], ["a"]);
		assert.equal(next.errors.size, 0);
	});
});

describe("spacesSettled", () => {
	const state = foldSpacesProgress(EMPTY, ["a", "b"], [
		{ spaceId: "a", payload: payload("a1") },
		{ spaceId: "b", error: "HTTP 500" },
	]);

	it("one failed space does not hold the others in loading", () => {
		assert.equal(spacesSettled(["a", "b"], state), true);
	});

	it("waits while a space has neither data nor an error", () => {
		assert.equal(spacesSettled(["a", "b", "c"], state), false);
	});
});

// Wed Nov 11 2026, 2:32 PM local.
const NOW = new Date(2026, 10, 11, 14, 32).getTime();

function d(id: string, kind: OpenDeadline["kind"], date: string, extra: Partial<OpenDeadline> = {}): OpenDeadline {
	return { id, kind, name: id, date, fileIds: [], done: false, spaceId: "c21", spaceName: "CSE 21", ...extra };
}

function progress(extra: Partial<DeadlineProgress>): DeadlineProgress {
	return {
		id: "x",
		kind: "exam",
		name: "x",
		date: "2026-11-17",
		done: false,
		daysUntil: 6,
		files: [],
		topicIds: [],
		counts: { strong: 0, shaky: 0, weak: 0, untested: 0 },
		workOnNext: [],
		ready: null,
		topics: [],
		...extra,
	};
}

describe("todayLists", () => {
	const doneAt = (h: number, day = 11) => new Date(2026, 10, day, h).toISOString();

	it("Today holds what is due within 7 days or overdue; Later holds the rest", () => {
		const open = [d("late", "homework", "2026-11-09"), d("today", "quiz", "2026-11-11"), d("week", "exam", "2026-11-18"), d("far", "exam", "2026-11-19")];
		const lists = todayLists(open, [], NOW);
		assert.deepEqual(lists.today.map((x) => x.id), ["late", "today", "week"]);
		assert.deepEqual(lists.later.map((x) => x.id), ["far"]);
	});

	it("a row ticked done stays until the day turns", () => {
		const done = [d("now", "homework", "2026-11-12", { done: true, doneAt: doneAt(9) }), d("yesterday", "homework", "2026-11-10", { done: true, doneAt: doneAt(23, 10) })];
		assert.deepEqual(todayLists([], done, NOW).done.map((x) => x.id), ["now"]);
		assert.deepEqual(todayLists([], done, new Date(2026, 10, 12, 0, 1).getTime()).done, []);
	});
});

describe("countLeft", () => {
	const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();

	it("whole calendar days while more than 24 hours are left", () => {
		assert.deepEqual(countLeft(at(17, 23, 59), NOW), { count: "6", unit: "days" });
		assert.deepEqual(countLeft(at(12, 23, 59), NOW), { count: "1", unit: "day" });
	});

	it("hours on the last day, minutes in the last hour, late once due", () => {
		assert.deepEqual(countLeft(at(11, 19, 40), NOW), { count: "5", unit: "hours" });
		assert.deepEqual(countLeft(at(11, 15, 40), NOW), { count: "1", unit: "hour" });
		assert.deepEqual(countLeft(at(11, 14, 44), NOW), { count: "12", unit: "min" });
		assert.deepEqual(countLeft(NOW, NOW), { count: "late", unit: "" });
	});
});

describe("longDay", () => {
	it("the weekday in full, then the month and day", () => {
		assert.equal(longDay("2026-11-11"), "Wednesday Nov 11");
		assert.equal(longDay("2026-12-08"), "Tuesday Dec 8");
	});
});

describe("todayRow", () => {
	const topics = [
		{ id: "a", name: "a", rate: 0.2 },
		{ id: "b", name: "b", rate: null },
		{ id: "c", name: "c", rate: null },
		{ id: "s", name: "s", rate: 1 },
	];

	it("a test or quiz: Study for it, and Start", () => {
		const test = d("Test 2", "exam", "2026-11-17", { spaceName: "CSE 29" });
		assert.deepEqual(todayRow(test, progress({ topics }), NOW), { title: "Study for Test 2", line: "CSE 29, the test is on Tuesday", button: "Start" });
		const quiz = d("Quiz 3", "quiz", "2026-11-11", { time: "17:00" });
		assert.deepEqual(todayRow(quiz, undefined, NOW), { title: "Study for Quiz 3", line: "CSE 21, the quiz is today at 5:00 PM", button: "Start" });
	});

	it("an interview: Study for it, and when the interview is", () => {
		const onsite = d("Onsite interview", "interview", "2026-11-17", { time: "14:00", spaceName: "Larkspur" });
		assert.deepEqual(todayRow(onsite, undefined, NOW), { title: "Study for Onsite interview", line: "Larkspur, the interview is on Tuesday at 2:00 PM", button: "Start" });
	});

	it("a session at a stop says what is next; one in the middle of a topic names it", () => {
		const mid = d("Midterm", "exam", "2026-11-17", { spaceName: "Machine Learning Foundations" });
		const stopped = todayRow(mid, progress({ continueStudy: { chatId: "c", done: 1, total: 3, stop: { at: "2026-11-11T21:48:00.000Z", next: "Cross-validation" } } }), NOW);
		assert.deepEqual(stopped, { title: "Continue studying for Midterm", line: "Machine Learning Foundations, Cross-validation is next.", button: "Continue" });
		const inTopic = todayRow(mid, progress({ continueStudy: { chatId: "c", done: 1, total: 3, inTopic: "Regularization" } }), NOW);
		assert.deepEqual(inTopic, { title: "Continue studying for Midterm", line: "Machine Learning Foundations, in the middle of Regularization.", button: "Continue" });
		const bare = todayRow(d("Test 2", "exam", "2026-11-17"), progress({ topics, continueStudy: { chatId: "c", done: 1, total: 3 } }), NOW);
		assert.deepEqual([bare.title, bare.line, bare.button], ["Continue studying for Test 2", "CSE 21, the test is on Tuesday", "Continue"]);
	});

	it("after a session reached its end today: nothing more is planned, Study more", () => {
		const mid = d("Midterm", "exam", "2026-11-17", { spaceName: "Machine Learning Foundations" });
		assert.deepEqual(todayRow(mid, progress({ studyEndedToday: true }), NOW), {
			title: "Study for Midterm",
			line: "Machine Learning Foundations, nothing more is planned today.",
			button: "Study more",
		});
	});

	it("a session that ended today, but a moved deadline put a topic on today: the usual row and Start", () => {
		const mid = d("Midterm", "exam", "2026-11-17");
		assert.deepEqual(todayRow(mid, progress({ studyEndedToday: true, topics }), NOW), { title: "Study for Midterm", line: "CSE 21, the test is on Tuesday", button: "Start" });
	});

	it("homework and projects say how far they are, and are worked on", () => {
		const hw = d("HW6", "homework", "2026-11-13");
		assert.deepEqual(todayRow(hw, progress({ problems: { done: 2, total: 7 } }), NOW), { title: "HW6", line: "CSE 21, due Friday. 2 of 7 problems done", button: "Work on it" });
		assert.equal(todayRow(d("Lab", "project", "2026-11-13"), progress({ ready: 0.58 }), NOW).line, "CSE 21, due Friday. 58% ready");
		assert.equal(todayRow(hw, undefined, NOW).line, "CSE 21, due Friday");
	});

	it("past due says when it was due", () => {
		assert.equal(todayRow(d("HW4", "homework", "2026-11-09"), undefined, NOW).line, "CSE 21, was due Mon Nov 9");
	});
});

describe("laterRow", () => {
	it("the space and the day, the days left, and how ready or how far", () => {
		const final = d("Final", "exam", "2026-12-08");
		assert.deepEqual(laterRow(final, progress({ ready: 0.19 }), NOW), { when: "CSE 21, Tuesday Dec 8", left: "27 days", ready: "19% ready" });
		assert.equal(laterRow(final, progress({ problems: { done: 0, total: 4 } }), NOW).ready, "0 of 4 problems done");
		assert.equal(laterRow(final, undefined, NOW).ready, null);
	});
});

describe("mainRowId: the row the card holds", () => {
	const at = (day: string) => new Date(`${day}T12:00:00`).toISOString();
	const today = localDay(NOW);
	const quiz = d("Quiz 3", "quiz", "2026-11-12", { id: "quiz" });
	const hw = d("PS4", "homework", "2026-11-13", { id: "hw" });
	const mid = d("Midterm", "exam", "2026-11-17", { id: "mid" });
	const items = [quiz, hw, mid];
	const stopped = (day: string) => new Map([["mid", progress({ continueStudy: { chatId: "c", done: 1, total: 3, stop: { at: at(day), next: "Cross-validation" } } })]]);

	it("the soonest row", () => {
		assert.equal(mainRowId(items, new Map(), NOW), "quiz");
		assert.equal(mainRowId([], new Map(), NOW), null);
	});

	it("a session stopped before today takes it; one stopped today never does", () => {
		assert.equal(mainRowId(items, stopped("2026-11-01"), NOW), "mid");
		assert.equal(mainRowId(items, stopped(today), NOW), "quiz");
		assert.equal(mainRowId([mid, hw], stopped(today), NOW), "hw", "the stopped row stays off the card that day");
	});

	it("a session that ended today stays off the card", () => {
		assert.equal(mainRowId([mid, hw], new Map([["mid", progress({ studyEndedToday: true })]]), NOW), "hw");
	});

	it("a session that ended today takes it again once today's plan has a topic", () => {
		const topics = [{ id: "a", name: "a", rate: 0.2 }];
		assert.equal(mainRowId([mid, hw], new Map([["mid", progress({ studyEndedToday: true, topics })]]), NOW), "mid");
	});

	it("a lone row that stopped or ended today leaves no card", () => {
		assert.equal(mainRowId([mid], stopped(today), NOW), null);
		assert.equal(mainRowId([mid], new Map([["mid", progress({ studyEndedToday: true })]]), NOW), null);
	});
});

describe("nextCard", () => {
	const topics = [
		{ id: "a", name: "a", rate: 0.2 },
		{ id: "b", name: "b", rate: null },
		{ id: "c", name: "c", rate: null },
		{ id: "s", name: "s", rate: 1 },
	];

	it("a test: Study for it, when and how ready, and the topics left today", () => {
		const quiz = d("Quiz 2", "quiz", "2026-11-13", { spaceName: "Linear Algebra" });
		assert.deepEqual(nextCard(quiz, progress({ date: "2026-11-13", topics, ready: 0.4 }), NOW), {
			title: "Study for Quiz 2",
			when: "The quiz is on Friday.",
			ready: "40% ready",
			left: "2 topics left today.",
			button: "Start",
		});
		const one = nextCard(quiz, progress({ date: "2026-11-11", topics: [topics[0]!] }), NOW);
		assert.equal(one.left, "1 topic left today.");
	});

	it("nothing to plan or no progress yet: no line for today", () => {
		const quiz = d("Quiz 2", "quiz", "2026-11-12", { time: "09:00" });
		assert.deepEqual(nextCard(quiz, undefined, NOW), { title: "Study for Quiz 2", when: "The quiz is tomorrow at 9:00 AM.", ready: null, left: null, button: "Start" });
		assert.equal(nextCard(quiz, progress({ topics: [topics[3]!] }), NOW).left, null);
	});

	it("an unfinished session continues and says where it is", () => {
		const mid = d("Midterm", "exam", "2026-11-17");
		const stopped = nextCard(mid, progress({ topics, continueStudy: { chatId: "c", done: 1, total: 3, stop: { at: "2026-11-10T12:00:00.000Z", next: "Eigenvalues" } } }), NOW);
		assert.deepEqual(stopped, { title: "Continue studying for Midterm", when: "The test is on Tuesday.", ready: null, left: "Eigenvalues is next.", button: "Continue" });
		const inTopic = nextCard(mid, progress({ continueStudy: { chatId: "c", done: 1, total: 3, inTopic: "Determinants" } }), NOW);
		assert.equal(inTopic.left, "In the middle of Determinants.");
	});

	it("homework: Work on it, due when and how far", () => {
		const hw = d("PS4", "homework", "2026-11-13");
		assert.deepEqual(nextCard(hw, progress({ problems: { done: 2, total: 7 } }), NOW), { title: "Work on PS4", when: "Due Friday.", ready: "2 of 7 problems done", left: null, button: "Work on it" });
		assert.equal(nextCard(d("PS3", "homework", "2026-11-09"), undefined, NOW).when, "Was due Mon Nov 9.");
	});
});

describe("todaySections", () => {
	const quiz = d("Quiz 3", "quiz", "2026-11-12", { id: "quiz" });
	const hw = d("PS4", "homework", "2026-11-13", { id: "hw" });
	const far = d("Final", "exam", "2026-12-08", { id: "far" });

	it("the card takes the main row; the rest are due this week", () => {
		const s = todaySections(todayLists([quiz, hw, far], [], NOW), new Map(), NOW);
		assert.equal(s.card?.id, "quiz");
		assert.deepEqual(s.due.map((x) => x.id), ["hw"]);
		assert.equal(s.empty, null);
	});

	it("no row for the card: every row stays under Due this week", () => {
		const ended = new Map([["quiz", progress({ studyEndedToday: true })]]);
		const s = todaySections(todayLists([quiz], [], NOW), ended, NOW);
		assert.equal(s.card, null);
		assert.deepEqual(s.due.map((x) => x.id), ["quiz"]);
		assert.equal(s.empty, null);
	});

	it("nothing due this week says why", () => {
		assert.equal(todaySections(todayLists([far], [], NOW), new Map(), NOW).empty, "Nothing is due in the next 7 days.");
		assert.equal(todaySections(todayLists([], [], NOW), new Map(), NOW).empty, "No deadlines yet. Your agent can add them from your files.");
		const done = d("PS1", "homework", "2026-11-10", { done: true, doneAt: new Date(NOW - 60_000).toISOString() });
		assert.equal(todaySections(todayLists([], [done], NOW), new Map(), NOW).empty, null, "a row done today is still under Due this week");
	});
});
