import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentStatusLabel } from "../../src/frontend/components/agent-status.tsx";

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
