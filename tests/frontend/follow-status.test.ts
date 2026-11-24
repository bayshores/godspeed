/**
 * The Follow chip's line: what the agent is doing right now.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANNOUNCE_GAP_MS, agentDoing, announceDelay } from "../../src/frontend/components/teacher/follow-status.ts";

const t = Date.parse("2026-11-02T12:00:00Z");
const teaching = { connected: true, teaching: true, helperHere: false, pendingWork: 0, pendingTurns: 0 };
const none = { round: null, lesson: null, extractions: [], jobs: [] };

describe("agentDoing", () => {
	it("nothing while no agent is connected", () => {
		assert.equal(agentDoing({ ...none, agent: null }), null);
		assert.equal(agentDoing({ ...none, agent: { ...teaching, connected: false, teaching: false, pendingWork: 3 } }), null);
	});
	it("idle, or not teaching yet", () => {
		assert.deepEqual(agentDoing({ ...none, agent: teaching }), { text: "Idle", working: false });
		assert.deepEqual(agentDoing({ ...none, agent: { ...teaching, teaching: false, pendingWork: 2 }, extractions: [{ kind: "notes", phase: "extracting", title: "a.pdf" }] }), {
			text: "Not teaching yet",
			working: false,
		});
	});
	it("the teacher's live round comes first, also before it runs its work loop", () => {
		assert.deepEqual(agentDoing({ ...none, agent: teaching, round: "Reading HW7_F26.pdf", lesson: { working: true } }), { text: "Reading HW7_F26.pdf", working: true });
		assert.deepEqual(agentDoing({ ...none, agent: { ...teaching, teaching: false }, round: "Working" }), { text: "Working", working: true });
	});
	it("the lesson on screen: one word, since its desk says what the teacher does", () => {
		assert.equal(agentDoing({ ...none, agent: teaching, lesson: { working: true } })?.text, "Working");
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
	it("leaves the background work to an open helper", () => {
		const withHelper = { ...teaching, helperHere: true, pendingWork: 2 };
		const extractions = [{ kind: "notes" as const, phase: "extracting", title: "a.pdf" }];
		assert.deepEqual(agentDoing({ ...none, agent: withHelper, extractions, jobs: [{ kind: "visual" }] }), { text: "Idle", working: false });
		assert.deepEqual(agentDoing({ ...none, agent: { ...withHelper, pendingTurns: 1 }, extractions }), { text: "Working", working: true });
	});
});

describe("announceDelay", () => {
	it("at once the first time, then at most every gap", () => {
		assert.equal(announceDelay(null, t), 0);
		assert.equal(announceDelay(t, t + 1000), ANNOUNCE_GAP_MS - 1000);
		assert.equal(announceDelay(t, t + ANNOUNCE_GAP_MS + 1), 0);
	});
});
