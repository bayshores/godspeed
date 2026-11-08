/**
 * The Follow chip's line: what the agent is doing right now.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentAction } from "../../src/shared/core/events.ts";
import { ANNOUNCE_GAP_MS, NOW_WINDOW_MS, agentDoing, announceDelay, freshAction } from "../../src/frontend/components/halley/follow-status.ts";

const t = Date.parse("2026-11-02T12:00:00Z");
const action = (over: Partial<AgentAction> = {}): AgentAction => ({
	id: "act_1",
	at: new Date(t).toISOString(),
	agent: "Claude Code",
	label: "Adding HW 5",
	classId: "cls_a",
	target: { kind: "deadline", id: "ddl_1" },
	page: "/",
	...over,
});
const teaching = { connected: true, teaching: true, pendingWork: 0 };
const none = { fresh: null, lesson: null, extractions: [], jobs: [] };

describe("freshAction", () => {
	it("the agent's newest change, while it is fresh", () => {
		assert.deepEqual(freshAction([action()], t + 3000), { action: action(), leftMs: NOW_WINDOW_MS - 3000 });
		assert.equal(freshAction([action()], t + NOW_WINDOW_MS), null);
		assert.equal(freshAction([], t), null);
	});
	it("skips the app's own entries (a folder's new files)", () => {
		const app = action({ id: "act_2", agent: "godspeed", label: "Added 3 files from Google Drive" });
		assert.equal(freshAction([app], t)?.action ?? null, null);
		assert.equal(freshAction([app, action()], t)?.action.id, "act_1");
	});
});

describe("agentDoing", () => {
	it("nothing while no agent is connected", () => {
		assert.equal(agentDoing({ ...none, agent: null }), null);
		assert.equal(agentDoing({ ...none, agent: { connected: false, teaching: false, pendingWork: 3 } }), null);
	});
	it("idle, or not teaching yet", () => {
		assert.deepEqual(agentDoing({ ...none, agent: teaching }), { text: "Idle", working: false });
		assert.deepEqual(agentDoing({ ...none, agent: { connected: true, teaching: false, pendingWork: 2 }, extractions: [{ kind: "notes", phase: "extracting", title: "a.pdf" }] }), {
			text: "Not teaching yet",
			working: false,
		});
	});
	it("a fresh change comes first", () => {
		assert.deepEqual(agentDoing({ ...none, agent: teaching, fresh: action(), lesson: { streaming: true, working: true } }), { text: "Adding HW 5", working: true });
	});
	it("the lesson on screen", () => {
		assert.equal(agentDoing({ ...none, agent: teaching, lesson: { streaming: true, working: true } })?.text, "Writing the lesson");
		assert.equal(agentDoing({ ...none, agent: teaching, lesson: { streaming: false, working: true } })?.text, "Working on the lesson");
	});
	it("a file read in parts names the file and the part", () => {
		const extractions = [
			{ kind: "notes" as const, phase: "waiting", title: "Slides/07_Graphs.pdf" },
			{ kind: "notes" as const, phase: "extracting", title: "Slides/06_Counting.pdf (3/12)", part: { i: 3, n: 12 } },
		];
		assert.deepEqual(agentDoing({ ...none, agent: teaching, extractions }), { text: "Reading 06_Counting.pdf", count: "3 of 12", working: true });
		assert.deepEqual(agentDoing({ ...none, agent: teaching, extractions: [{ ...extractions[1]!, phase: "merging" }] }), {
			text: "Saving facts from 06_Counting.pdf",
			count: "3 of 12",
			working: true,
		});
	});
	it("a lesson's facts, topic grouping, a background job, other work", () => {
		assert.equal(agentDoing({ ...none, agent: teaching, extractions: [{ kind: "chat", phase: "extracting", title: "Counting" }] })?.text, "Saving facts from “Counting”");
		assert.equal(agentDoing({ ...none, agent: teaching, extractions: [{ kind: "topics", phase: "grouping", title: "CSE 21" }] })?.text, "Grouping topics");
		assert.equal(agentDoing({ ...none, agent: teaching, jobs: [{ kind: "visual" }] })?.text, "Drawing a figure");
		assert.deepEqual(agentDoing({ ...none, agent: { ...teaching, pendingWork: 1 } }), { text: "Working", working: true });
	});
});

describe("announceDelay", () => {
	it("at once the first time, then at most every gap", () => {
		assert.equal(announceDelay(null, t), 0);
		assert.equal(announceDelay(t, t + 1000), ANNOUNCE_GAP_MS - 1000);
		assert.equal(announceDelay(t, t + ANNOUNCE_GAP_MS + 1), 0);
	});
});
