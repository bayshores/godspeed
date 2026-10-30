import assert from "node:assert/strict";
import test from "node:test";
import { continuesFrom, parseAgentSeen, SEEN_AGENTS_MAX, seenMark, withSeen } from "../src/core/agent-seen.ts";

test("a mark continues only the exact messages it was made from", () => {
	const mark = seenMark(["a", "b"]);
	assert.equal(mark.count, 2);
	assert.ok(continuesFrom(mark, ["a", "b"]));
	assert.ok(continuesFrom(mark, ["a", "b", "c"]), "new messages after the seen ones");
	assert.ok(!continuesFrom(mark, ["a", "x", "c"]), "an earlier message changed");
	assert.ok(!continuesFrom(mark, ["a"]), "fewer messages than seen");
	assert.ok(!continuesFrom(undefined, ["a"]));
	assert.notEqual(seenMark(["ab"]).hash, seenMark(["a", "b"]).hash, "message borders count");
});

test("an unreadable file reads as nothing seen, and bad entries are dropped", () => {
	assert.deepEqual(parseAgentSeen(null), { agents: {} });
	assert.deepEqual(parseAgentSeen({ agents: "x" }), { agents: {} });
	const file = parseAgentSeen({
		version: 1,
		agents: {
			good: { at: "2026-10-29T10:00:00.000Z", conversations: { chat_1: { count: 3, hash: "h" }, chat_2: { count: -1, hash: "h" }, chat_3: null } },
			noTime: { conversations: {} },
		},
	});
	assert.deepEqual(file, { agents: { good: { at: "2026-10-29T10:00:00.000Z", conversations: { chat_1: { count: 3, hash: "h" } } } } });
});

test("saving keeps each agent's other lessons and only the newest agents", () => {
	let file = withSeen({ agents: {} }, "a", "chat_1", { count: 1, hash: "x" }, "2026-10-29T10:00:00.000Z");
	file = withSeen(file, "a", "chat_2", { count: 2, hash: "y" }, "2026-10-29T10:00:01.000Z");
	assert.deepEqual(Object.keys(file.agents.a!.conversations), ["chat_1", "chat_2"]);
	for (let i = 0; i < SEEN_AGENTS_MAX; i++) file = withSeen(file, `agent-${i}`, "chat_1", { count: 1, hash: "z" }, `2026-10-29T11:00:${String(i).padStart(2, "0")}.000Z`);
	assert.equal(Object.keys(file.agents).length, SEEN_AGENTS_MAX);
	assert.equal(file.agents.a, undefined, "the oldest agent is dropped");
});
