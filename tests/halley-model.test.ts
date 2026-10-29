/**
 * Halley's pure parts (plan 2026-10-28, Phase 4): mood precedence, visit
 * pacing and the >5 burst summary, Follow (stop / pause / resume), corner
 * snapping, placement beside a target, and the comet trail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAction } from "../src/core/events.ts";
import { HOUR } from "../src/components/countdown-model.ts";
import { crossedUnderHour, eyesStill, pickMood, REACTION_MS } from "../src/components/halley/mood.ts";
import { BURST_LIMIT, FLY_MS, STEP_MS, bubbleText, nextStep, pastLabel, summarize, targetKey, verbOf } from "../src/components/halley/tour.ts";
import {
	FOLLOW_OFF,
	RESUME_MS,
	STOPPED_NOTICE,
	followMoves,
	followReady,
	followReducer,
	parseFollow,
	safePage,
	type FollowState,
} from "../src/components/halley/follow.ts";
import {
	PEEK,
	RISE_GAP,
	SIDE_INSET,
	SIZE,
	besideTarget,
	clearOf,
	cornerSpot,
	edgeToward,
	nearestCorner,
	parseCorner,
	pruneTrail,
	settled,
	springStep,
	trailShape,
	unionBox,
	type TrailPoint,
} from "../src/components/halley/geometry.ts";

function action(over: Partial<AgentAction> = {}): AgentAction {
	return { id: "act_1", at: "2026-10-28T16:00:00.000Z", agent: "Claude Code", label: "Adding HW 5", classId: "cls_a", target: { kind: "deadline", id: "ddl_1" }, page: "/", ...over };
}

describe("mood", () => {
	const base = { reaction: null, streaming: false, working: false, connected: true } as const;
	it("a reaction shows over everything", () => {
		assert.equal(pickMood({ ...base, reaction: "happy", streaming: true, working: true }), "happy");
		assert.equal(pickMood({ ...base, reaction: "dizzy", connected: false }), "dizzy");
	});
	it("then talking, sleepy, thinking, idle", () => {
		assert.equal(pickMood({ ...base, streaming: true, working: true }), "talking");
		assert.equal(pickMood({ ...base, working: true }), "thinking");
		assert.equal(pickMood({ ...base, connected: false, working: true }), "sleepy", "no agent: nobody is working");
		assert.equal(pickMood({ ...base }), "idle");
		assert.equal(pickMood({ ...base, connected: null }), "idle", "not known yet is not asleep");
	});
	it("reactions are brief", () => {
		for (const ms of Object.values(REACTION_MS)) assert.ok(ms > 0 && ms <= 3000);
	});
	it("O_O fires once, when a deadline crosses under an hour", () => {
		const now = Date.parse("2026-10-28T16:00:00");
		const list = [
			{ id: "crossing", dueMs: now + HOUR - 1000 },
			{ id: "far", dueMs: now + 3 * HOUR },
			{ id: "already", dueMs: now + 10 * 60_000 },
			{ id: "late", dueMs: now - 1000 },
		];
		assert.deepEqual(crossedUnderHour(list, now - 15_000, now), ["crossing"]);
		assert.deepEqual(crossedUnderHour(list, now, now + 15_000), []);
	});
	it("sleepy and dizzy eyes don't follow the mouse", () => {
		assert.equal(eyesStill("sleepy"), true);
		assert.equal(eyesStill("dizzy"), true);
		assert.equal(eyesStill("idle"), false);
	});
});

describe("visits", () => {
	it("visits one change at a time, about 0.6 s apart", () => {
		assert.equal(STEP_MS, 600);
		assert.ok(FLY_MS < STEP_MS);
		const q = [action({ id: "a" }), action({ id: "b" })];
		const step = nextStep(q);
		assert.equal(step.step, "visit");
		if (step.step === "visit") {
			assert.equal(step.action.id, "a");
			assert.deepEqual(step.rest.map((a) => a.id), ["b"]);
		}
		assert.deepEqual(nextStep([]), { step: "done" });
	});
	it("up to 5 waiting still tours; more becomes one summary", () => {
		const five = Array.from({ length: BURST_LIMIT }, (_, i) => action({ id: `a${i}` }));
		assert.equal(nextStep(five).step, "visit");
		const eight = Array.from({ length: 8 }, (_, i) => action({ id: `a${i}`, label: `Adding HW ${i}` }));
		const step = nextStep(eight, () => "CSE 21");
		assert.equal(step.step, "burst");
		if (step.step === "burst") {
			assert.equal(step.actions.length, 8);
			assert.equal(step.summary, "Added 8 deadlines to CSE 21");
		}
	});
	it("summaries name the change when they are all alike", () => {
		const marks = Array.from({ length: 6 }, (_, i) => action({ id: `m${i}`, label: `Marking Lab ${i} done` }));
		assert.equal(summarize(marks), "Marked 6 deadlines");
		assert.equal(summarize(marks, () => "CSE 29"), "Marked 6 deadlines in CSE 29");
		const mixed = [...marks, action({ label: "Adding syllabus.pdf", target: { kind: "file", id: "f1" } })];
		assert.equal(summarize(mixed), "Made 7 changes");
		const twoClasses = [action({ classId: "a" }), action({ classId: "b" })];
		assert.equal(summarize(twoClasses, () => "X"), "Added 2 deadlines");
	});
	it("the bubble: name and label, or only the verb when narrow", () => {
		assert.deepEqual(bubbleText("Halley", "Adding HW 5", false), { who: "Halley", what: "Adding HW 5" });
		assert.deepEqual(bubbleText("Halley", "Adding HW 5", true), { who: null, what: "Adding" });
		assert.equal(verbOf("  Reading 06_Counting.pdf"), "Reading");
		assert.equal(pastLabel("Adding Lab 4"), "Added Lab 4");
		assert.equal(pastLabel("Marking HW 5 done"), "Marked HW 5 done");
		assert.equal(pastLabel("Something else"), "Something else");
		assert.equal(targetKey({ kind: "file", id: "f_1" }), "file:f_1");
	});
});

describe("follow", () => {
	const on: FollowState = followReducer(FOLLOW_OFF, { type: "toggle", on: true });
	it("is off by default and remembered as '1'", () => {
		assert.equal(FOLLOW_OFF.on, false);
		assert.equal(parseFollow(null), false);
		assert.equal(parseFollow("1"), true);
		assert.equal(parseFollow("0"), false);
	});
	it("its own navigation keeps it on", () => {
		const going = followReducer(on, { type: "navigating", path: "/class" });
		const arrived = followReducer(going, { type: "route", path: "/class" });
		assert.equal(arrived.on, true);
		assert.equal(arrived.expected, null);
		assert.equal(arrived.notice, null);
	});
	it("going somewhere yourself stops it, with a notice", () => {
		const stopped = followReducer(on, { type: "route", path: "/graph" });
		assert.equal(stopped.on, false);
		assert.equal(stopped.notice, STOPPED_NOTICE);
		assert.equal(followReducer(stopped, { type: "clear-notice" }).notice, null);
		// Off: navigating changes nothing.
		assert.deepEqual(followReducer(FOLLOW_OFF, { type: "route", path: "/graph" }), FOLLOW_OFF);
		assert.deepEqual(followReducer(FOLLOW_OFF, { type: "navigating", path: "/graph" }), FOLLOW_OFF);
	});
	it("waits while you type or a dialog is open, and catches up 3 s after", () => {
		const t = 1_000_000;
		assert.equal(followReady(FOLLOW_OFF, true, t), true, "off never waits");
		assert.equal(followReady(on, false, t), true);
		assert.equal(followReady(on, true, t), false);
		const typed = followReducer(on, { type: "busy", at: t });
		assert.equal(followReady(typed, false, t + RESUME_MS - 1), false);
		assert.equal(followReady(typed, false, t + RESUME_MS), true);
	});
	it("switches class first on a class page, never for Home", () => {
		assert.deepEqual(followMoves({ page: "/class/files", classId: "cls_b" }, { path: "/", activeClass: "cls_a" }), { switchClass: { to: "cls_b" }, go: "/class/files" });
		assert.deepEqual(followMoves({ page: "/", classId: "cls_b" }, { path: "/", activeClass: "cls_a" }), { switchClass: null, go: null });
		assert.deepEqual(followMoves({ page: "/class", classId: "cls_a" }, { path: "/graph", activeClass: "cls_a" }), { switchClass: null, go: "/class" });
		assert.deepEqual(followMoves({ page: "/graph", classId: null }, { path: "/graph", activeClass: "cls_a" }), { switchClass: { to: null }, go: null });
	});
	it("only goes to the app's own pages", () => {
		for (const p of ["/", "/class", "/class/files", "/graph", "/chat/c_12-ab"]) assert.equal(safePage(p), p);
		for (const p of ["javascript:alert(1)", "https://x.example", "//x.example", "/chat/../x", "/settings"]) assert.equal(safePage(p), null);
	});
});

describe("corners", () => {
	const area = { left: 256, top: 0, width: 1184, height: 900 };
	it("snaps a drop to the nearer bottom corner of the content area", () => {
		assert.equal(nearestCorner({ x: 1300, y: 800 }, area), "br");
		assert.equal(nearestCorner({ x: 300, y: 800 }, area), "bl");
		assert.equal(nearestCorner({ x: 1300, y: 100 }, area), "br");
		assert.equal(nearestCorner({ x: 300, y: 100 }, area), "bl");
	});
	it("peeks over the bottom edge, 28px from the side", () => {
		assert.deepEqual(cornerSpot("br", area, SIZE, false), { x: 256 + 1184 - SIDE_INSET - SIZE, y: 900 - PEEK });
		assert.deepEqual(cornerSpot("bl", area, SIZE, false), { x: 256 + SIDE_INSET, y: 900 - PEEK });
	});
	it("rises fully out of the edge", () => {
		assert.deepEqual(cornerSpot("br", area, SIZE, true), { x: 256 + 1184 - SIDE_INSET - SIZE, y: 900 - RISE_GAP - SIZE });
	});
	it("a saved top corner reads as the bottom corner on its side", () => {
		assert.equal(parseCorner("tl"), "bl");
		assert.equal(parseCorner("tr"), "br");
		assert.equal(parseCorner("bl"), "bl");
		assert.equal(parseCorner("nonsense"), "br");
		assert.equal(parseCorner(null), "br");
	});
	it("sits above the update banner when it would cover it", () => {
		const spot = cornerSpot("br", area, SIZE, true);
		const banner = { left: 1100, top: 830, width: 324, height: 54 };
		assert.deepEqual(clearOf(spot, SIZE, banner), { x: spot.x, y: 830 - 12 - SIZE });
		assert.deepEqual(clearOf(spot, SIZE, { left: 300, top: 830, width: 100, height: 54 }), spot);
		assert.deepEqual(clearOf(spot, SIZE, null), spot);
	});
});

describe("placement", () => {
	const vp = { width: 1440, height: 900 };
	it("beside a target: to its right, centered", () => {
		assert.deepEqual(besideTarget({ left: 10, top: 100, width: 236, height: 51 }, SIZE, vp), { x: 246 + 10 + SIZE / 2, y: 125.5 });
	});
	it("over its right end when the right has no room (a full-width row)", () => {
		const p = besideTarget({ left: 284, top: 100, width: 1128, height: 40 }, SIZE, vp);
		assert.equal(p.x, 284 + 1128 - 10 - SIZE / 2);
	});
	it("an off-screen target: the nearest edge, eyes pointing at it", () => {
		const { at, dir } = edgeToward({ left: 400, top: 1400, width: 600, height: 60 }, { left: 0, top: 0, width: 1440, height: 900 }, SIZE);
		assert.equal(at.x, 700);
		assert.equal(at.y, 900 - SIZE / 2 - 8);
		assert.ok(dir.y > 0.99);
	});
	it("a burst sits beside all its targets", () => {
		assert.deepEqual(unionBox([{ left: 0, top: 10, width: 10, height: 10 }, { left: 20, top: 0, width: 5, height: 5 }]), { left: 0, top: 0, width: 25, height: 20 });
		assert.equal(unionBox([]), null);
	});
});

describe("flight and trail", () => {
	it("the spring settles on its target", () => {
		let p = { x: 0, y: 0 };
		let v = { x: 0, y: 0 };
		const target = { x: 300, y: -120 };
		for (let i = 0; i < 120; i++) ({ p, v } = springStep(p, v, target));
		assert.ok(settled(p, v, target));
	});
	it("the trail tapers from the tail to the dot's width at the head", () => {
		const hist: TrailPoint[] = Array.from({ length: 8 }, (_, i) => ({ x: i * 20, y: 0, t: i * 16 }));
		const shape = trailShape(hist, 28);
		assert.ok(shape);
		assert.deepEqual(shape.from, { x: 140, y: 0 });
		assert.deepEqual(shape.to, { x: 0, y: 0 });
		assert.match(shape.d, /^M0,0 L/, "starts at the tail with no width");
		assert.ok(shape.d.includes("140,28") && shape.d.includes("140,-28"), "full radius at the head");
	});
	it("no trail at rest or for tiny moves, and only 130 ms of history", () => {
		const still: TrailPoint[] = Array.from({ length: 6 }, (_, i) => ({ x: 5, y: 5, t: i }));
		assert.equal(trailShape(still, 28), null);
		const hist: TrailPoint[] = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 100 }, { x: 2, y: 0, t: 200 }];
		pruneTrail(hist, 200);
		assert.deepEqual(hist.map((h) => h.t), [100, 200]);
	});
});
