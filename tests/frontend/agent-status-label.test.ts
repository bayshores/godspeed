import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentStatusLabel, lessonAgentWaiting } from "../../src/frontend/components/agent-status.tsx";

describe("agentStatusLabel", () => {
	const teaching = { connected: true, teaching: true, pendingWork: 0 };
	const off = { connected: false, teaching: false, pendingWork: 0 };
	it("a teaching agent shows the teacher's name", () => {
		assert.equal(agentStatusLabel(teaching, "Ada"), "Ada");
	});
	it("connected but not running the work loop is only on", () => {
		assert.equal(agentStatusLabel({ ...off, connected: true }, "Ada"), "Ada is on");
	});
	it("nobody connected (or access off, or not loaded yet)", () => {
		assert.equal(agentStatusLabel(off, "Ada"), "Ada is off");
		assert.equal(agentStatusLabel(null, "Ada"), "Ada is off");
	});
	it("work waiting with no agent reads 'Waiting for' the teacher", () => {
		assert.equal(agentStatusLabel({ ...off, pendingWork: 2 }, "Ada"), "Waiting for Ada");
		assert.equal(agentStatusLabel({ ...teaching, pendingWork: 2 }, "Ada"), "Ada", "a teaching agent is taking it");
	});
});

describe("lessonAgentWaiting: the lesson head says the teacher is waited for", () => {
	const status = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, helperWork: 0, claimedLessons: [] };
	it("with no agent connected, turn or no turn", () => {
		assert.equal(lessonAgentWaiting(status), true);
		assert.equal(lessonAgentWaiting({ ...status, pendingWork: 1 }), true);
	});
	it("with an agent connected but not teaching", () => {
		assert.equal(lessonAgentWaiting({ ...status, connected: true, name: "Claude Code" }), true);
	});
	it("not with an agent teaching, nor before the first read", () => {
		assert.equal(lessonAgentWaiting({ ...status, connected: true, teaching: true }), false);
		assert.equal(lessonAgentWaiting(null), false);
	});
});
