/**
 * The top bar's words: the clock, the lit tab and the
 * Follow buttons.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockText, dateText, goLabel, hasLessonsWithNoSpace, plusName, selectedTab } from "../../src/frontend/components/top-bar/top-bar-model.ts";
import type { AgentAction } from "../../src/shared/core/events.ts";

describe("the clock", () => {
	it("is 24-hour", () => {
		assert.equal(clockText(new Date(2026, 10, 7, 9, 5)), "09:05");
		assert.equal(clockText(new Date(2026, 10, 7, 17, 51)), "17:51");
	});
});

describe("the date", () => {
	it("is month, day, year, each short number padded", () => {
		assert.equal(dateText(new Date(2026, 10, 19)), "11/19/2026");
		assert.equal(dateText(new Date(2027, 0, 5)), "01/05/2027");
	});
});

describe("the lit tab", () => {
	const spaces = [
		{ id: "c21", closed: false },
		{ id: "c29", closed: false },
		{ id: "old", closed: true },
	];
	it("Home on the first page", () => {
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
		assert.equal(selectedTab("/space", null, spaces), "plus", "lessons with no space");
		assert.equal(selectedTab("/chat/abc", null, spaces), "plus", "a lesson with no space");
	});
	it("Menu for Settings and a space not in the list yet", () => {
		assert.equal(selectedTab("/settings", "c21", spaces), "menu");
		assert.equal(selectedTab("/settings", null, spaces), "menu");
		assert.equal(selectedTab("/space", "gone", spaces), "menu");
	});
	it("nothing on another page with no space, where the + offers nothing", () => {
		assert.equal(selectedTab("/graph", null, spaces), "none");
		assert.equal(selectedTab("/space/files", null, spaces), "none");
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
		assert.equal(plusName(false), "Add a space");
		assert.equal(plusName(true), "Add a space or reopen a closed one");
	});
});

describe("the strip's Go to key", () => {
	const offer: AgentAction = { id: "a1", at: "2026-11-01T10:00:00.000Z", agent: "Claude Code", label: "Reading 06_Counting.pdf", spaceId: "c21", target: null, page: "/space/files" };
	it("nothing to offer, no key", () => {
		assert.equal(goLabel({ following: false, offer: null, held: false }), null);
	});
	it("with Follow off, a change on another page offers to go there", () => {
		assert.equal(goLabel({ following: false, offer, held: false }), "Go to Files");
		assert.equal(goLabel({ following: true, offer, held: false }), null);
	});
	it("a page the agent opened while the window held offers to go there with Follow on too", () => {
		const sheet = { ...offer, page: "/space/deadline/ddl_1/cheat-sheet", open: true as const };
		assert.equal(goLabel({ following: true, offer: sheet, held: true }), "Go to cheat sheet");
		assert.equal(goLabel({ following: false, offer: sheet, held: true }), "Go to cheat sheet");
	});
});
