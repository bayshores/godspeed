import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectView } from "../../src/shared/core/view.ts";
import type { LhMessage } from "../../src/shared/core/native-messages.ts";

describe("markers the lesson text does not draw", () => {
	it("a saved plan-block marker adds nothing to the view, not even a part on the plan_init group", () => {
		const record = [
			{ id: "a1", role: "assistant", content: [{ type: "toolCall", id: "p", name: "plan_init", arguments: {} }], timestamp: 1 },
			{ id: "r1", role: "toolResult", toolCallId: "p", toolName: "plan_init", content: [{ type: "text", text: "ok" }], details: { ok: true }, isError: false, timestamp: 2 },
			{ id: "pb", role: "custom", customType: "plan-block", content: "", display: true, details: { planCallId: "p", block: { kind: "full", nodes: [], edges: [], current: null } }, timestamp: 3 },
		] as unknown as LhMessage[];
		const view = projectView(record);
		assert.equal(view.length, 1);
		assert.ok(!view.some((m) => m.parts.some((p) => p.type === "data-plan-block")));
	});
});
