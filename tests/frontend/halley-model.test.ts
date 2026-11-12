/**
 * The teacher's pure parts: visit pacing and the >5
 * burst, and Follow (stop / pause / resume).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAction } from "../../src/shared/core/events.ts";
import { BURST_LIMIT, STEP_MS, nextStep, pastLabel, targetKey } from "../../src/frontend/components/halley/tour.ts";
import {
	FOLLOW_DEFAULT,
	GO_OFFER_MS,
	RESUME_MS,
	followMoves,
	followReady,
	followReducer,
	goOffer,
	pageName,
	parseFollow,
	safePage,
	type FollowState,
} from "../../src/frontend/components/halley/follow.ts";
function action(over: Partial<AgentAction> = {}): AgentAction {
	return { id: "act_1", at: "2026-10-28T16:00:00.000Z", agent: "Claude Code", label: "Adding HW 5", spaceId: "cls_a", target: { kind: "deadline", id: "ddl_1" }, page: "/", ...over };
}

describe("visits", () => {
	it("visits one change at a time, about 0.6 s apart", () => {
		assert.equal(STEP_MS, 600);
		const q = [action({ id: "a" }), action({ id: "b" })];
		const step = nextStep(q);
		assert.equal(step.step, "visit");
		if (step.step === "visit") {
			assert.equal(step.action.id, "a");
			assert.deepEqual(step.rest.map((a) => a.id), ["b"]);
		}
		assert.deepEqual(nextStep([]), { step: "done" });
	});
	it("up to 5 waiting still tours; more light up together", () => {
		const five = Array.from({ length: BURST_LIMIT }, (_, i) => action({ id: `a${i}` }));
		assert.equal(nextStep(five).step, "visit");
		const eight = Array.from({ length: 8 }, (_, i) => action({ id: `a${i}`, label: `Adding HW ${i}` }));
		const step = nextStep(eight);
		assert.equal(step.step, "burst");
		if (step.step === "burst") assert.equal(step.actions.length, 8);
	});
	it("labels read as done for Recent; targets key their elements", () => {
		assert.equal(pastLabel("  Reading 06_Counting.pdf"), "Read 06_Counting.pdf");
		assert.equal(pastLabel("Adding Lab 4"), "Added Lab 4");
		assert.equal(pastLabel("Marking HW 5 done"), "Marked HW 5 done");
		assert.equal(pastLabel("Something else"), "Something else");
		assert.equal(targetKey({ kind: "file", id: "f_1" }), "file:f_1");
	});
});

describe("follow", () => {
	const on: FollowState = FOLLOW_DEFAULT;
	it("is on by default and remembers only an explicit off", () => {
		assert.equal(FOLLOW_DEFAULT.on, true);
		assert.equal(parseFollow(null), true);
		assert.equal(parseFollow("1"), true);
		assert.equal(parseFollow("0"), false);
	});
	it("only the switch turns it off and on", () => {
		const off = followReducer(on, { type: "toggle", on: false });
		assert.equal(off.on, false);
		assert.equal(followReducer(off, { type: "toggle", on: true }).on, true);
	});
	it("waits while you type or a dialog is open, and catches up 3 s after", () => {
		const t = 1_000_000;
		assert.equal(followReady(followReducer(on, { type: "toggle", on: false }), true, t), true, "off never waits");
		assert.equal(followReady(on, false, t), true);
		assert.equal(followReady(on, true, t), false);
		const typed = followReducer(on, { type: "busy", at: t });
		assert.equal(followReady(typed, false, t + RESUME_MS - 1), false);
		assert.equal(followReady(typed, false, t + RESUME_MS), true);
	});
	it("switches space first on a space page, never for Home", () => {
		assert.deepEqual(followMoves({ page: "/space/files", spaceId: "cls_b" }, { path: "/", activeSpace: "cls_a", lessonDraft: false, asked: false }), { switchSpace: { to: "cls_b" }, go: "/space/files" });
		assert.deepEqual(followMoves({ page: "/", spaceId: "cls_b" }, { path: "/", activeSpace: "cls_a", lessonDraft: false, asked: false }), { switchSpace: null, go: null });
		assert.deepEqual(followMoves({ page: "/space", spaceId: "cls_a" }, { path: "/graph", activeSpace: "cls_a", lessonDraft: false, asked: false }), { switchSpace: null, go: "/space" });
		assert.deepEqual(followMoves({ page: "/graph", spaceId: null }, { path: "/graph", activeSpace: "cls_a", lessonDraft: false, asked: false }), { switchSpace: { to: null }, go: null });
		// A lesson opens in its own space, so the sidebar lists it.
		assert.deepEqual(followMoves({ page: "/chat/c2", spaceId: "cls_b" }, { path: "/", activeSpace: null, lessonDraft: false, asked: false }), { switchSpace: { to: "cls_b" }, go: "/chat/c2" });
		// Unsent text in the lesson on screen keeps the window there.
		assert.deepEqual(followMoves({ page: "/space", spaceId: "cls_b" }, { path: "/chat/c1", activeSpace: "cls_a", lessonDraft: true, asked: false }), { switchSpace: null, go: null });
		assert.deepEqual(followMoves({ page: "/space", spaceId: "cls_a" }, { path: "/chat/c1", activeSpace: "cls_a", lessonDraft: false, asked: false }), { switchSpace: null, go: "/space" });
		assert.deepEqual(followMoves({ page: "/space", spaceId: "cls_a" }, { path: "/chat/c1", activeSpace: "cls_a", lessonDraft: true, asked: true }), { switchSpace: null, go: "/space" }, "the learner asked to go");
		// A mock keeps the window too.
		assert.deepEqual(followMoves({ page: "/chat/c2", spaceId: "cls_a" }, { path: "/space/mock/cls_a/mock_1", activeSpace: "cls_a", lessonDraft: false, asked: false }), { switchSpace: null, go: null });
		assert.deepEqual(followMoves({ page: "/chat/c2", spaceId: "cls_a" }, { path: "/space/mock/cls_a/mock_1", activeSpace: "cls_a", lessonDraft: false, asked: true }), { switchSpace: null, go: "/chat/c2" });
	});
	it("only goes to the app's own pages", () => {
		for (const p of ["/", "/space", "/space/files", "/graph", "/chat/c_12-ab"]) assert.equal(safePage(p), p);
		for (const p of ["javascript:alert(1)", "https://x.example", "//x.example", "/chat/../x", "/settings"]) assert.equal(safePage(p), null);
	});
	it("with Follow off, offers 'Go to' for a fresh change on another page", () => {
		const t = Date.parse("2026-10-29T08:00:00Z");
		const change = { page: "/chat/c1", at: new Date(t).toISOString() };
		assert.equal(goOffer(change, { follow: false, path: "/", now: t + 1000 }), change);
		assert.equal(goOffer(change, { follow: true, path: "/", now: t + 1000 }), null, "Follow on goes there itself");
		assert.equal(goOffer(change, { follow: false, path: "/chat/c1", now: t + 1000 }), null, "already there");
		assert.equal(goOffer(change, { follow: false, path: "/", now: t + GO_OFFER_MS }), null, "too old");
		assert.equal(goOffer({ page: "/settings", at: change.at }, { follow: false, path: "/", now: t }), null);
		assert.equal(goOffer(undefined, { follow: false, path: "/", now: t }), null);
	});
	it("names the page on the button", () => {
		assert.equal(pageName("/chat/c1"), "lesson");
		assert.equal(pageName("/"), "Today");
		assert.equal(pageName("/space"), "Progress");
		assert.equal(pageName("/space/files"), "Files");
	});
});
