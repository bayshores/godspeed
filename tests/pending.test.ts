import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findPendingToolCall } from "../src/core/pending.ts";

const part = (tool: string, toolCallId: string, state = "input-available") => ({
	type: `tool-${tool}`,
	toolCallId,
	state,
	input: { question: toolCallId },
});

describe("findPendingToolCall (the composer's question gate)", () => {
	it("returns the newest message's first unanswered question part", () => {
		const messages = [
			{ role: "assistant", parts: [part("quiz", "old")] },
			{ role: "assistant", parts: [part("ask_user_question", "first"), part("write_code", "second")] },
		];
		assert.deepEqual(findPendingToolCall(messages), {
			toolCallId: "first",
			tool: "ask_user_question",
			input: { question: "first" },
		});
	});

	it("ignores answered question parts and non-question tools", () => {
		const messages = [
			{ role: "assistant", parts: [part("quiz", "done", "output-available"), part("research", "job")] },
		];
		assert.equal(findPendingToolCall(messages), null);
	});
});
