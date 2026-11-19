import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAgentEntry, type AgentAction } from "../../src/shared/core/events.ts";

const action = (agent: string): AgentAction => ({ id: "act_1", at: "2026-11-07T16:00:00Z", agent, label: "Adding HW 5", spaceId: null, target: null, page: "/" });

describe("isAgentEntry", () => {
	it("is an outside agent's entry, never the app's or the learner's", () => {
		assert.equal(isAgentEntry(action("Claude Code")), true);
		assert.equal(isAgentEntry(action("godspeed")), false);
		assert.equal(isAgentEntry(action("you")), false);
	});
});
