import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localDay, type DeadlineProgress, type ProgressPayload } from "../../src/shared/core/index.ts";
import type { OpenDeadline } from "../../src/frontend/components/deadlines-model.ts";
import {
	spacesSettled,
	countLeft,
	foldSpacesProgress,
	todayLists,
	mainRowId,
	nextCard,
	overdueToAsk,
	shownCard,
	todayEmpty,
	type SpacesProgress,
} from "../../src/frontend/components/home-page/home-page-model.ts";

const EMPTY: SpacesProgress = { progress: new Map(), errors: new Map(), noSpace: null };
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

	it("keeps the lessons with no space apart from the spaces, and their earlier payload through a failed read", () => {
		const none = payload("none1");
		const first = foldSpacesProgress(EMPTY, ["a"], [
			{ spaceId: "a", payload: payload("a1") },
			{ spaceId: null, payload: none },
		]);
		assert.ok(first.noSpace === none);
		assert.deepEqual([...first.progress.keys()], ["a"]);
		const failed = foldSpacesProgress(first, ["a"], [{ spaceId: null, error: "offline" }]);
		assert.ok(failed.noSpace === none);
		assert.equal(failed.errors.size, 0, "a failed read of the lessons with no space marks no space");
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

	it("Today holds what is due today, in the six days after it, or overdue; Later holds the rest", () => {
		const open = [d("late", "homework", "2026-11-09"), d("today", "quiz", "2026-11-11"), d("day6", "exam", "2026-11-17", { time: "23:59" }), d("day7", "exam", "2026-11-18", { time: "00:01" })];
		const lists = todayLists(open, [], NOW);
		assert.deepEqual(lists.today.map((x) => x.id), ["late", "today", "day6"]);
		assert.deepEqual(lists.later.map((x) => x.id), ["day7"]);
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

	it("hours on the last day, minutes in the last hour", () => {
		assert.deepEqual(countLeft(at(11, 19, 40), NOW), { count: "5", unit: "hours" });
		assert.deepEqual(countLeft(at(11, 15, 40), NOW), { count: "1", unit: "hour" });
		assert.deepEqual(countLeft(at(11, 14, 44), NOW), { count: "12", unit: "min" });
	});

	it("once due, how late in the same units: calendar days after a day, never a bare word", () => {
		assert.deepEqual(countLeft(NOW, NOW), { count: "1", unit: "min late" });
		assert.deepEqual(countLeft(NOW - 3 * 3_600_000 - 60_000, NOW), { count: "3", unit: "hours late" });
		assert.deepEqual(countLeft(at(9, 23, 59), NOW), { count: "2", unit: "days late" });
		assert.deepEqual(countLeft(at(10, 9, 0), NOW), { count: "1", unit: "day late" });
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

	it("a test: its name, its space and day with the topics left today, how ready, and Study", () => {
		const quiz = d("Quiz 2", "quiz", "2026-11-13", { spaceName: "Linear Algebra" });
		assert.deepEqual(nextCard(quiz, progress({ date: "2026-11-13", topics, ready: 0.4 }), NOW), {
			title: "Quiz 2",
			line: "Linear Algebra, Friday. 2 topics left today.",
			ready: "40% ready",
			button: "Study",
		});
		assert.equal(nextCard(quiz, progress({ date: "2026-11-11", topics: [topics[0]!] }), NOW).line, "Linear Algebra, Friday. 1 topic left today.");
	});

	it("nothing to plan or no progress yet: only the space and when", () => {
		const quiz = d("Quiz 2", "quiz", "2026-11-12", { time: "09:00" });
		assert.deepEqual(nextCard(quiz, undefined, NOW), { title: "Quiz 2", line: "CSE 21, tomorrow at 9:00 AM", ready: null, button: "Study" });
		assert.equal(nextCard(quiz, progress({ topics: [topics[3]!] }), NOW).line, "CSE 21, tomorrow at 9:00 AM");
		const onsite = d("Onsite interview", "interview", "2026-11-17", { time: "14:00", spaceName: "Larkspur" });
		assert.equal(nextCard(onsite, undefined, NOW).line, "Larkspur, Tuesday at 2:00 PM");
		assert.equal(nextCard(d("Final", "exam", "2026-12-08"), undefined, NOW).line, "CSE 21, Tuesday Dec 8", "after the week, the date");
	});

	it("an unfinished session continues and says where it is", () => {
		const mid = d("Midterm", "exam", "2026-11-17");
		const stopped = nextCard(mid, progress({ topics, continueStudy: { chatId: "c", done: 1, total: 3, stop: { at: "2026-11-10T12:00:00.000Z", next: "Eigenvalues" } } }), NOW);
		assert.deepEqual(stopped, { title: "Midterm", line: "CSE 21, Tuesday. Eigenvalues is next.", ready: null, button: "Continue" });
		const inTopic = nextCard(mid, progress({ continueStudy: { chatId: "c", done: 1, total: 3, inTopic: "Determinants" } }), NOW);
		assert.equal(inTopic.line, "CSE 21, Tuesday. In the middle of Determinants.");
		const bare = nextCard(mid, progress({ continueStudy: { chatId: "c", done: 1, total: 3 } }), NOW);
		assert.deepEqual([bare.line, bare.button], ["CSE 21, Tuesday", "Continue"]);
	});

	it("a session that ended today with nothing more today says so; a topic moved onto today counts instead", () => {
		const mid = d("Midterm", "exam", "2026-11-17");
		assert.equal(nextCard(mid, progress({ studyEndedToday: true }), NOW).line, "CSE 21, Tuesday. Nothing more is planned today.");
		assert.equal(nextCard(mid, progress({ studyEndedToday: true, topics }), NOW).line, "CSE 21, Tuesday. 1 topic left today.");
	});

	it("homework and projects: Work on it, due when and how far", () => {
		const hw = d("PS4", "homework", "2026-11-13");
		assert.deepEqual(nextCard(hw, progress({ problems: { done: 2, total: 7 } }), NOW), { title: "PS4", line: "CSE 21, due Friday", ready: "2 of 7 problems done", button: "Work on it" });
		assert.equal(nextCard(d("Lab", "project", "2026-11-13"), progress({ ready: 0.58 }), NOW).ready, "58% ready");
		assert.equal(nextCard(d("PS3", "homework", "2026-11-09"), undefined, NOW).line, "CSE 21, was due Mon Nov 9");
	});

	it("one ticked done: its space and when, nothing to count and no main key", () => {
		const hw = d("PS4", "homework", "2026-11-13", { done: true, doneAt: new Date(NOW).toISOString() });
		assert.deepEqual(nextCard(hw, progress({ problems: { done: 7, total: 7 } }), NOW), { title: "PS4", line: "CSE 21, due Friday", ready: null, button: null });
	});
});

describe("todayEmpty", () => {
	const far = d("Final", "exam", "2026-12-08", { id: "far" });

	it("speaks only with no deadline at all, as Later shows in the week block", () => {
		assert.equal(todayEmpty(todayLists([], [], NOW), "Halley"), "None yet. Halley can add them from your files.");
		assert.equal(todayEmpty(todayLists([far], [], NOW), "Halley"), null);
		assert.equal(todayEmpty(todayLists([d("quiz", "quiz", "2026-11-12"), far], [], NOW), "Halley"), null);
		const done = d("PS1", "homework", "2026-11-10", { done: true, doneAt: new Date(NOW - 60_000).toISOString() });
		assert.equal(todayEmpty(todayLists([], [done], NOW), "Halley"), null, "one done today still shows in the week");
	});
});

describe("shownCard: the deadline the card shows", () => {
	const quiz = d("Quiz 3", "quiz", "2026-11-12", { id: "quiz" });
	const hw = d("PS4", "homework", "2026-11-13", { id: "hw" });
	const done = d("PS1", "homework", "2026-11-10", { id: "ps1", done: true, doneAt: new Date(NOW - 60_000).toISOString() });
	const far = d("Final", "exam", "2026-12-08", { id: "far" });
	const lists = todayLists([quiz, hw, far], [done], NOW);

	it("the main row until one is picked", () => {
		assert.equal(shownCard(lists, null, "quiz")?.id, "quiz");
	});

	it("the picked one, open, ticked done today or Later", () => {
		assert.equal(shownCard(lists, "hw", "quiz")?.id, "hw");
		assert.equal(shownCard(lists, "ps1", "quiz")?.id, "ps1");
		assert.equal(shownCard(lists, "far", "quiz")?.id, "far");
	});

	it("a pick that left the lists falls back to the main row", () => {
		assert.equal(shownCard(lists, "gone", "quiz")?.id, "quiz");
	});

	it("no main row and no pick: no card; a pick still shows", () => {
		assert.equal(shownCard(lists, null, null), null);
		assert.equal(shownCard(lists, "hw", null)?.id, "hw");
	});
});

describe("overdueToAsk", () => {
	const open = [d("old", "homework", "2026-11-06"), d("recent", "homework", "2026-11-10"), d("future", "homework", "2026-11-14"), d("ancient", "homework", "2026-10-20"), d("ticked", "homework", "2026-11-08", { done: true })];

	it("is the oldest one past due by at most a week that is not done", () => {
		assert.equal(overdueToAsk(open, [], NOW, null)?.id, "old");
	});

	it("goes on to the next after one is answered Not yet", () => {
		assert.equal(overdueToAsk(open, ["old"], NOW, null)?.id, "recent");
		assert.equal(overdueToAsk(open, ["old", "recent"], NOW, null), null);
	});

	it("skips the one on Today's card, which asks with its own Mark done", () => {
		assert.equal(overdueToAsk(open, [], NOW, "old")?.id, "recent");
		assert.equal(overdueToAsk(open, ["recent"], NOW, "old"), null);
	});

	it("skips one more than a week late, one not due yet and one with nothing open", () => {
		assert.equal(overdueToAsk([open[2]!, open[3]!], [], NOW, null), null);
		assert.equal(overdueToAsk([], [], NOW, null), null);
	});
});
