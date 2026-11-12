import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentSeen, resumeAt, SEEN_AGENTS_MAX, seenMark, withSeen } from "../../src/shared/core/agent-seen.ts";

test("a mark continues after the exact messages it was made from", () => {
	const mark = seenMark(["a", "b"], "L");
	assert.equal(mark.count, 2);
	assert.equal(resumeAt(mark, ["a", "b"]), 2);
	assert.equal(resumeAt(mark, ["a", "b", "c"]), 2, "new messages after the seen ones");
	assert.equal(resumeAt(undefined, ["a"]), -1);
	assert.notEqual(seenMark(["ab"], "L").hash, seenMark(["a", "b"], "L").hash, "message borders count");
});

test("after a summary replaced the messages before it, the mark finds its last message again", () => {
	const mark = seenMark(["a", "b", "reply"], "L");
	assert.equal(resumeAt(mark, ["summary", "reply", "c"]), 2, "starts right after the agent's own reply");
	assert.equal(resumeAt(mark, ["reply", "x", "reply", "c"]), 3, "the newest copy wins");
	assert.equal(resumeAt(mark, ["summary", "c"]), -1, "its reply is gone: nothing to continue from");
});

test("an unreadable file reads as nothing seen, and bad entries are dropped", () => {
	assert.deepEqual(parseAgentSeen(null), { agents: {} });
	assert.deepEqual(parseAgentSeen({ agents: "x" }), { agents: {} });
	const file = parseAgentSeen({
		version: 1,
		agents: {
			good: { at: "2026-10-29T10:00:00.000Z", conversations: { chat_1: { count: 3, hash: "h", last: "l", lead: "L" }, chat_2: { count: -1, hash: "h", last: "l", lead: "L" }, chat_3: null, chat_4: { count: 3, hash: "h" } } },
			noTime: { conversations: {} },
		},
	});
	assert.deepEqual(file, { agents: { good: { at: "2026-10-29T10:00:00.000Z", conversations: { chat_1: { count: 3, hash: "h", last: "l", lead: "L" } } } } });
});

test("saving keeps each agent's other lessons and only the newest agents", () => {
	let file = withSeen({ agents: {} }, "a", "chat_1", { count: 1, hash: "x", last: "l", lead: "L" }, "2026-10-29T10:00:00.000Z");
	file = withSeen(file, "a", "chat_2", { count: 2, hash: "y", last: "l", lead: "L" }, "2026-10-29T10:00:01.000Z");
	assert.deepEqual(Object.keys(file.agents.a!.conversations), ["chat_1", "chat_2"]);
	for (let i = 0; i < SEEN_AGENTS_MAX; i++) file = withSeen(file, `agent-${i}`, "chat_1", { count: 1, hash: "z", last: "l", lead: "L" }, `2026-10-29T11:00:${String(i).padStart(2, "0")}.000Z`);
	assert.equal(Object.keys(file.agents).length, SEEN_AGENTS_MAX);
	assert.equal(file.agents.a, undefined, "the oldest agent is dropped");
});
