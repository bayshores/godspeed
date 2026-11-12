import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentStatusLabel } from "../../src/frontend/components/agent-status.tsx";

describe("agentStatusLabel: '<agent>, N jobs'", () => {
	const teaching = { connected: true, teaching: true, pendingWork: 0 };
	const off = { connected: false, teaching: false, pendingWork: 0 };
	it("a teaching agent shows its name and the running jobs", () => {
		assert.equal(agentStatusLabel({ ...teaching, name: "Claude Code" }, 1), "Claude Code, 1 job");
		assert.equal(agentStatusLabel({ ...teaching, name: "Claude Code" }, 3), "Claude Code, 3 jobs");
	});
	it("no jobs: just the agent", () => {
		assert.equal(agentStatusLabel({ ...teaching, name: "Codex" }, 0), "Codex");
	});
	it("teaching without a known name reads 'Your agent'", () => {
		assert.equal(agentStatusLabel(teaching, 0), "Your agent");
	});
	it("connected but not running the work loop says so", () => {
		assert.equal(agentStatusLabel({ ...off, connected: true, name: "Claude Code" }, 0), "Claude Code connected, not teaching");
		assert.equal(agentStatusLabel({ ...off, connected: true, pendingWork: 2 }, 1), "Your agent connected, not teaching, 1 job");
	});
	it("nobody connected (or access off, or not loaded yet)", () => {
		assert.equal(agentStatusLabel(off, 2), "No agent connected, 2 jobs");
		assert.equal(agentStatusLabel(off, 0), "No agent connected");
		assert.equal(agentStatusLabel(null, 0), "No agent connected");
	});
	it("work waiting with no agent reads 'Waiting for your agent'", () => {
		assert.equal(agentStatusLabel({ ...off, pendingWork: 1 }, 1), "Waiting for your agent, 1 job");
		assert.equal(agentStatusLabel({ ...off, pendingWork: 2 }, 0), "Waiting for your agent");
		assert.equal(agentStatusLabel({ ...teaching, name: "Codex", pendingWork: 2 }, 0), "Codex", "a teaching agent is taking it");
	});
});
