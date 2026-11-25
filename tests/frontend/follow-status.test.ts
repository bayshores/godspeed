/**
 * The Follow chip's line: what the agent is doing right now.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANNOUNCE_GAP_MS, agentDoing, announceDelay } from "../../src/frontend/components/teacher/follow-status.ts";

const t = Date.parse("2026-11-02T12:00:00Z");
const teaching = { turnsRunning: 0 };
const none = { round: null, lesson: null, extractions: [], jobs: [], talkTurns: 0 };

describe("agentDoing", () => {
	it("a reply in the teacher panel's chat is not work elsewhere", () => {
		assert.deepEqual(agentDoing({ ...none, agent: { turnsRunning: 1 }, talkTurns: 1 }), { text: "Idle", working: false });
		assert.equal(agentDoing({ ...none, agent: { turnsRunning: 2 }, talkTurns: 1 })?.text, "Working");
	});

	it("nothing before the first read of the agent, then idle", () => {
		assert.equal(agentDoing({ ...none, agent: null }), null);
		assert.deepEqual(agentDoing({ ...none, agent: teaching }), { text: "Idle", working: false });
	});
	it("the teacher's live round comes first", () => {
		assert.deepEqual(agentDoing({ ...none, agent: teaching, round: "Reading HW7_F26.pdf", lesson: { working: true } }), { text: "Reading HW7_F26.pdf", working: true });
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
	it("a lesson's facts, topic grouping, a background job, a lesson turn elsewhere", () => {
		assert.equal(agentDoing({ ...none, agent: teaching, extractions: [{ kind: "chat", phase: "extracting", title: "Counting" }] })?.text, "Saving facts from “Counting”");
		assert.equal(agentDoing({ ...none, agent: teaching, extractions: [{ kind: "topics", phase: "grouping", title: "CSE 21" }] })?.text, "Grouping topics");
		assert.equal(agentDoing({ ...none, agent: teaching, jobs: [{ kind: "demo" }] })?.text, "Building a demo");
		assert.deepEqual(agentDoing({ ...none, agent: { ...teaching, turnsRunning: 1 } }), { text: "Working", working: true });
	});
});

describe("announceDelay", () => {
	it("at once the first time, then at most every gap", () => {
		assert.equal(announceDelay(null, t), 0);
		assert.equal(announceDelay(t, t + 1000), ANNOUNCE_GAP_MS - 1000);
		assert.equal(announceDelay(t, t + ANNOUNCE_GAP_MS + 1), 0);
	});
});
