/**
 * Follow's slip: where it shows, and its one line while the teacher works, waits for the
 * learner and is done.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAction } from "../../src/shared/core/events.ts";
import { DONE_MS, FRESH_MS, slipFits, slipPlace, slipView } from "../../src/frontend/components/teacher/follow-slip-model.ts";
import type { TimelineRow } from "../../src/frontend/components/teacher/timeline-model.ts";

const t0 = Date.parse("2026-11-22T20:00:00Z");
const iso = (ms: number) => new Date(t0 + ms).toISOString();
const step = (id: string, ms: number, text: string): TimelineRow => ({ kind: "step", id, at: iso(ms), text, link: null });
const hw7: AgentAction = { id: "a1", at: iso(2000), agent: "Claude Code", label: "Adding HW7", spaceId: "spc", target: { kind: "deadline", id: "d7" }, page: "/space/deadline/d7" };
const rows: TimelineRow[] = [step("s1", 0, "Looking at CSE 21"), step("s2", 1000, "Reading HW7_F26.pdf, page 1"), { kind: "change", id: "a1", at: iso(2000), text: "Adding HW7", action: hw7 }];
const base = { follow: true, path: "/space/deadlines", room: true, live: true, rows, endedAt: null, pause: null, open: false, now: t0 + 2000 };

describe("where the slip shows", () => {
	it("on any page but a lesson, a mock or a cheat sheet", () => {
		for (const path of ["/", "/space", "/space/files", "/space/deadlines", "/space/deadline/d7", "/graph", "/settings", "/new"]) assert.equal(slipPlace(path), true, path);
		for (const path of ["/chat/c1", "/space/mock/spc/m1", "/space/deadline/d7/cheat-sheet"]) assert.equal(slipPlace(path), false, path);
	});
	it("never with Follow off, on those pages, or without room beside the panel", () => {
		assert.equal(slipView({ ...base, follow: false }), null);
		assert.equal(slipView({ ...base, path: "/chat/c1" }), null);
		assert.equal(slipView({ ...base, room: false }), null);
		assert.notEqual(slipView(base), null);
	});
	it("has room while the panel is shut, or with 240 points of the page in view beside it", () => {
		assert.equal(slipFits(null), true, "the panel is shut");
		assert.equal(slipFits(240), true);
		assert.equal(slipFits(480), true, "a panel that pushes the page");
		assert.equal(slipFits(239), false, "a panel that lies over most of the page");
		assert.equal(slipFits(0), false, "a panel across the whole window");
	});
});

describe("the slip's line", () => {
	it("the newest row's words while fresh, then Thinking while the round is live", () => {
		const fresh = slipView(base)!;
		assert.deepEqual([fresh.line, fresh.mark, fresh.count, fresh.changesAt], ["Adding HW7", "live", "3 steps", t0 + 2000 + FRESH_MS]);
		assert.deepEqual(fresh.past.map((r) => r.id), ["s1", "s2"], "the list leaves out what the line says");
		const later = slipView({ ...base, now: t0 + 2000 + FRESH_MS })!;
		assert.deepEqual([later.line, later.mark, later.count, later.changesAt], ["Thinking", "live", "3 steps", null]);
		assert.equal(later.past.length, 3);
	});
	it("a round with nothing yet says Thinking with no count", () => {
		const none = slipView({ ...base, rows: [] })!;
		assert.deepEqual([none.line, none.count], ["Thinking", null]);
	});
	it("says why Follow waits, with the change it waits to show", () => {
		const typing = slipView({ ...base, pause: { why: "type", waiting: hw7 } })!;
		assert.deepEqual([typing.line, typing.mark, typing.count, typing.waiting?.id, typing.paused], ["Paused while you type", "still", "3 steps", "a1", true]);
		assert.equal(slipView({ ...base, pause: { why: "dialog", waiting: null } })!.line, "Paused while this is open");
	});
	it("an ended round says Done with its count for 3 s, longer while its list is open", () => {
		const ended = { ...base, live: false, endedAt: t0 + 5000 };
		const done = slipView({ ...ended, now: t0 + 5000 })!;
		assert.deepEqual([done.line, done.mark, done.count, done.changesAt], ["Done, 3 steps", "done", null, t0 + 5000 + DONE_MS]);
		assert.equal(slipView({ ...ended, now: t0 + 5000 + DONE_MS }), null);
		assert.equal(slipView({ ...ended, now: t0 + 5000 + DONE_MS, open: true })?.line, "Done, 3 steps");
		assert.equal(slipView({ ...ended, rows: [], now: t0 + 5000 }), null, "a round with no rows has no Done");
		assert.equal(slipView({ ...ended, rows: rows.slice(0, 1), now: t0 + 5000 })?.line, "Done, 1 step");
	});
});
