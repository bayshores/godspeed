import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restoreUnsent, sendBlockedReason, stuckClaimMinutes, stuckRetry } from "../src/components/lesson/chat-helpers.ts";
import type { LhMessage } from "../src/core/index.ts";

describe("restoreUnsent", () => {
	it("fills an empty composer with the unsent text", () => {
		assert.equal(restoreUnsent("wait, why?", ""), "wait, why?");
		assert.equal(restoreUnsent("wait, why?", "  \n"), "wait, why?");
	});

	it("puts the unsent text and a newline ahead of a new draft", () => {
		assert.equal(restoreUnsent("wait, why?", "and also"), "wait, why?\nand also");
	});
});

describe("sendBlockedReason", () => {
	it("says why the box can't take text, in the panel's order", () => {
		assert.equal(sendBlockedReason({ pending: false, problem: false, compacting: false }), null);
		assert.equal(sendBlockedReason({ pending: true, problem: true, compacting: true }), "Answer or skip the waiting question first.");
		assert.equal(sendBlockedReason({ pending: false, problem: true, compacting: true }), "Finish or discard the practice problem first.");
		assert.equal(sendBlockedReason({ pending: false, problem: false, compacting: true }), "Wait until the lesson finishes summarizing.");
	});
});

describe("stuckClaimMinutes", () => {
	const at = "2026-10-30T12:00:00.000Z";
	const t = Date.parse(at);
	it("is null until the claim is 3 minutes old, then whole minutes", () => {
		assert.equal(stuckClaimMinutes(undefined, t), null);
		assert.equal(stuckClaimMinutes(at, t + 2 * 60_000 + 59_000), null);
		assert.equal(stuckClaimMinutes(at, t + 3 * 60_000), 3);
		assert.equal(stuckClaimMinutes(at, t + 7 * 60_000 + 30_000), 7);
	});
	it("an unreadable time is never stuck", () => {
		assert.equal(stuckClaimMinutes("not a date", t), null);
	});
});

describe("stuckRetry", () => {
	const msg = (m: Record<string, unknown>) => ({ id: "m", ...m }) as unknown as LhMessage;
	const user = (content: unknown) => msg({ role: "user", content });
	const assistant = msg({ role: "assistant", stopReason: "toolUse", content: [] });
	const search = msg({ role: "toolResult", toolName: "search_graph", isError: false, content: [] });
	const answer = msg({ role: "toolResult", toolName: "quiz", isError: false, content: [] });
	it("sends the learner's plain message again, past the turn's own replies and tool results", () => {
		assert.deepEqual(stuckRetry([user("why?")]), { type: "text", text: "why?" });
		assert.deepEqual(stuckRetry([user("why?"), assistant, search]), { type: "text", text: "why?" });
		assert.deepEqual(stuckRetry([answer, user("why?"), assistant, msg({ role: "toolResult", toolName: "quiz", isError: true, content: [] })]), { type: "text", text: "why?" });
	});
	it("runs the turn again from the record after an answer or anything else", () => {
		assert.deepEqual(stuckRetry([user("why?"), assistant, answer]), { type: "continue" });
		assert.deepEqual(stuckRetry([user([{ type: "text", text: "see this" }, { type: "image" }])]), { type: "continue" }, "a message with files");
		assert.deepEqual(stuckRetry([msg({ role: "custom", customType: "practice-thinking" })]), { type: "continue" });
		assert.deepEqual(stuckRetry([]), { type: "continue" });
	});
});
