/**
 * The top bar's words: the clock, the lit tab, the teacher chip and the
 * Follow buttons.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chipText, clockText, followButtons, hasLessonsWithNoSpace, plusName, selectedTab } from "../../src/frontend/components/top-bar/top-bar-model.ts";
import type { AgentAction } from "../../src/shared/core/events.ts";

describe("the clock", () => {
	it("is 24-hour", () => {
		assert.equal(clockText(new Date(2026, 10, 7, 9, 5)), "09:05");
		assert.equal(clockText(new Date(2026, 10, 7, 17, 51)), "17:51");
	});
});

describe("the lit tab", () => {
	const spaces = [
		{ id: "c21", archived: false },
		{ id: "c29", archived: false },
		{ id: "old", archived: true },
	];
	it("Today on the first page", () => {
		assert.equal(selectedTab("/", "c21", spaces), "today");
		assert.equal(selectedTab("/", "old", spaces), "today", "even with a closed space in the window");
	});
	it("the window's space on every space page and in a lesson", () => {
		assert.equal(selectedTab("/space", "c21", spaces), "c21");
		assert.equal(selectedTab("/graph", "c29", spaces), "c29");
		assert.equal(selectedTab("/chat/abc", "c29", spaces), "c29");
	});
	it("the + while the window shows a closed space or the lessons with no space", () => {
		assert.equal(selectedTab("/space", "old", spaces), "plus");
		assert.equal(selectedTab("/chat/abc", "old", spaces), "plus", "an old lesson of it");
		assert.equal(selectedTab("/space/lessons", null, spaces), "plus", "lessons with no space");
		assert.equal(selectedTab("/chat/abc", null, spaces), "plus", "a lesson with no space");
	});
	it("Menu for Settings and a space not in the list yet", () => {
		assert.equal(selectedTab("/settings", "c21", spaces), "menu");
		assert.equal(selectedTab("/settings", null, spaces), "menu");
		assert.equal(selectedTab("/space", "gone", spaces), "menu");
	});
});

describe("the + list", () => {
	it("offers Lessons with no space only while one exists", () => {
		assert.equal(hasLessonsWithNoSpace(null), false, "not read yet");
		assert.equal(hasLessonsWithNoSpace([]), false);
		assert.equal(hasLessonsWithNoSpace([{ spaceId: "c21" }, { spaceId: "c29" }]), false);
		assert.equal(hasLessonsWithNoSpace([{ spaceId: "c21" }, {}]), true);
	});
	it("its name says what the list offers", () => {
		assert.equal(plusName(false, false), "Add a space");
		assert.equal(plusName(true, false), "Add a space or reopen a closed one");
		assert.equal(plusName(false, true), "Add a space or open the lessons with no space");
		assert.equal(plusName(true, true), "Add a space, reopen a closed one, or open the lessons with no space");
	});
});

describe("the teacher chip", () => {
	const off = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, claimedLessons: [] };
	const teaching = { ...off, connected: true, teaching: true, name: "Claude Code" };
	const reading = { text: "Reading Lecture 14 notes", working: true };
	it("the teacher's name with what it is doing", () => {
		assert.equal(chipText({ name: "marco", doing: reading, agent: teaching }), "marco, reading Lecture 14 notes");
	});
	it("just the name while it teaches and nothing runs", () => {
		assert.equal(chipText({ name: "marco", doing: { text: "Idle", working: false }, agent: teaching }), "marco");
	});
	it("the agent's state when none is teaching", () => {
		assert.equal(chipText({ name: "marco", doing: null, agent: off }), "No agent connected");
		assert.equal(chipText({ name: "marco", doing: null, agent: { ...off, connected: true, name: "Codex" } }), "Codex connected, not teaching");
		assert.equal(chipText({ name: "marco", doing: null, agent: { ...off, pendingWork: 1 } }), "Waiting for your agent");
	});
	it("says so while the helper answers", () => {
		assert.equal(chipText({ name: "marco", doing: reading, agent: { ...teaching, helperCovering: true } }), "marco, tidying its memory");
	});
	it("just the name before the agent's state is read", () => {
		assert.equal(chipText({ name: "marco", doing: null, agent: null }), "marco");
	});
});

describe("the Follow buttons", () => {
	const offer: AgentAction = { id: "a1", at: "2026-11-01T10:00:00.000Z", agent: "Claude Code", label: "Reading 06_Counting.pdf", spaceId: "c21", target: null, page: "/space/files" };
	it("Follow shows only while the teacher works", () => {
		assert.deepEqual(followButtons({ following: false, working: false, offer: null }), { go: null, follow: null });
		assert.deepEqual(followButtons({ following: false, working: true, offer: null }), { go: null, follow: "Follow" });
		assert.deepEqual(followButtons({ following: true, working: true, offer: null }), { go: null, follow: "Following" });
	});
	it("with Follow off, a change on another page offers to go there", () => {
		assert.equal(followButtons({ following: false, working: true, offer }).go, "Go to Files");
		assert.equal(followButtons({ following: true, working: true, offer }).go, null);
	});
});
