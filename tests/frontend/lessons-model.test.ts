/**
 * A lesson list's words and its search.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonAge, lessonWaiting, matchLessons } from "../../src/frontend/components/lessons/lessons-model.ts";
import type { ChatListItem } from "../../src/shared/core/index.ts";

const item = (over: Partial<ChatListItem>): ChatListItem => ({
	id: "c1",
	title: "Induction",
	kind: "teach",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
	messageCount: 4,
	phase: "probe",
	pendingQuestion: false,
	pendingProblem: false,
	busy: false,
	...over,
});

describe("lessonAge", () => {
	const now = new Date(2026, 10, 11, 12, 0, 0);
	const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
	const MIN = 60_000;
	const HOUR = 60 * MIN;
	const DAY = 24 * HOUR;
	it("written out: now, minutes, hours, yesterday, days", () => {
		assert.equal(lessonAge(ago(30_000), now), "now");
		assert.equal(lessonAge(ago(MIN), now), "1 minute ago");
		assert.equal(lessonAge(ago(5 * MIN), now), "5 minutes ago");
		assert.equal(lessonAge(ago(HOUR), now), "1 hour ago");
		assert.equal(lessonAge(ago(3 * HOUR), now), "3 hours ago");
		assert.equal(lessonAge(ago(DAY), now), "yesterday");
		assert.equal(lessonAge(ago(3 * DAY), now), "3 days ago");
	});
	it("after a week its date, with the year once it isn't this one", () => {
		assert.equal(lessonAge(new Date(2026, 10, 1, 12).toISOString(), now), "Nov 1");
		assert.equal(lessonAge(new Date(2025, 5, 2, 12).toISOString(), now), "Jun 2, 2025");
	});
});

describe("lessonWaiting", () => {
	it("covers open questions and posed problems", () => {
		assert.equal(lessonWaiting(item({ pendingQuestion: true })), true);
		assert.equal(lessonWaiting(item({ kind: "practice", pendingProblem: true })), true);
		assert.equal(lessonWaiting(item({})), false);
	});
});

describe("matchLessons", () => {
	const lessons = [item({ id: "a", title: "Counting" }), item({ id: "b", title: "Strong induction" }), item({ id: "c", title: "Induction" })];
	it("no search keeps every lesson in its own order", () => {
		assert.deepEqual(matchLessons(lessons, "  ").map((c) => c.id), ["a", "b", "c"]);
	});
	it("a search keeps only the matches, best first", () => {
		const found = matchLessons(lessons, "induction").map((c) => c.id);
		assert.deepEqual([...found].sort(), ["b", "c"]);
		assert.equal(found[0], "c", "the closer title first");
		assert.deepEqual(matchLessons(lessons, "zzz"), []);
	});
});
