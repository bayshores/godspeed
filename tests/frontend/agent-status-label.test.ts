import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentStatusLabel, lessonAgentWaiting } from "../../src/frontend/components/agent-status.tsx";

describe("agentStatusLabel", () => {
	const teaching = { connected: true, teaching: true, pendingWork: 0 };
	const off = { connected: false, teaching: false, pendingWork: 0 };
	it("a teaching agent shows its name", () => {
		assert.equal(agentStatusLabel({ ...teaching, name: "Codex" }), "Codex");
	});
	it("teaching without a known name reads 'Your agent'", () => {
		assert.equal(agentStatusLabel(teaching), "Your agent");
	});
	it("connected but not running the work loop says so", () => {
		assert.equal(agentStatusLabel({ ...off, connected: true, name: "Claude Code" }), "Claude Code connected, not teaching");
	});
	it("nobody connected (or access off, or not loaded yet)", () => {
		assert.equal(agentStatusLabel(off), "No agent connected");
		assert.equal(agentStatusLabel(null), "No agent connected");
	});
	it("work waiting with no agent reads 'Waiting for your agent'", () => {
		assert.equal(agentStatusLabel({ ...off, pendingWork: 2 }), "Waiting for your agent");
		assert.equal(agentStatusLabel({ ...teaching, name: "Codex", pendingWork: 2 }), "Codex", "a teaching agent is taking it");
	});
});

describe("lessonAgentWaiting: the lesson head says Waiting for your agent", () => {
	const status = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, claimedLessons: [] };
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
