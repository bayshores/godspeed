/** A study session end to end through the outside-agent bridge: birth
 *  (study plan, plan tree, topics in class order with their modes), the
 *  teacher's prompt and tools plus problem/conclude from turn 1, the same
 *  tools every turn, a problem ending the turn, and the old kinds still
 *  building their own agents. Closed network, scratch data dir. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-study-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	HOME: path.join(scratch, "home"),
};
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
globalThis.fetch = async () => {
	throw new Error("CLOSED: unexpected network request");
};
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const { handleChatInput } = await import("../src/server/chat-handler.ts");
const { isTurnRunning } = await import("../src/server/turn-liveness.ts");
const { createLesson } = await import("../src/server/lessons.ts");
const { sourceIdFor } = await import("../src/server/classes.ts");
const { graphStoreFor } = await import("../src/server/stores.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { classStore } = await import("../src/store/classes.ts");
const bridge = await import("../src/agent/agent-bridge.ts");
const { ensureMcpToken } = await import("../src/store/mcp-token.ts");
const { activeProblemOf } = await import("../src/core/native-messages.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");

function waitFor(cond: () => boolean, timeoutMs = 8000, what = "condition"): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (cond()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${what}`));
			setTimeout(tick, 20);
		};
		tick();
	});
}

const POSE = {
	statement: "How many subsets does a 3-element set have?",
	mode: "recall",
	target: ["n_count"],
	modelSolution: "Each element is in or out: $2^3 = 8$.",
};

/** A class with two dated lectures: "Counting" (2026-09-25, never tested)
 *  and "Sets" (2026-10-02, tested and missed). */
function seedClass() {
	const cls = classStore.createClass({ name: "CSE 21" });
	const file = (id: string, name: string) => ({ id, origin: "copied" as const, name, path: `x/${name}`, kind: "study" as const, contentFp: "", status: "ready" as const, addedAt: "2026-10-26T00:00:00.000Z" });
	const counting = file("f_aaaaaaaaaaaa", "2026-09-25 Counting.pdf");
	const sets = file("f_bbbbbbbbbbbb", "2026-10-02 Sets.pdf");
	classStore.saveFiles(cls.id, [sets, counting]);
	const store = graphStoreFor(cls.id);
	const older = chatStore.createChat("Sets quiz", undefined, cls.id);
	chatStore.saveMessages(older.id, [
		{ id: "m1", role: "assistant", content: [{ type: "toolCall", id: "q1", name: "quiz", arguments: { nodeId: "x" } }], timestamp: 0 },
		{ id: "r1", role: "toolResult", toolCallId: "q1", toolName: "quiz", content: [{ type: "text", text: "{}" }], details: { kind: "quiz", correct: false, dontKnow: false, answers: [], answeredAt: "2026-10-20T00:00:00.000Z" }, isError: false, timestamp: 0 },
	] as never);
	const node = (id: string, src: string, extra: { chatId: string; messageId: string }[] = []) =>
		store.appendNode({ id, name: id, statement: `${id} holds`, aliases: [], createdAt: "2026-10-26T00:00:00.000Z", provenance: [{ chatId: src, messageId: "" }, ...extra] });
	node("n_sets", sourceIdFor(cls.id, sets.id), [{ chatId: older.id, messageId: "m1" }]);
	node("n_count", sourceIdFor(cls.id, counting.id));
	store.appendTopics({ at: "2026-10-26T00:00:00.000Z", topics: [{ id: "tpc_sets", name: "Sets", members: ["n_sets"] }, { id: "tpc_count", name: "Counting", members: ["n_count"] }] });
	return cls;
}

describe("a study session", () => {
	ensureMcpToken();

	it("is born with the study plan and a plan tree, topics in class order with their modes", () => {
		const cls = seedClass();
		const created = createLesson({
			title: "Study: Sets, Counting",
			classId: cls.id,
			picks: [{ id: "n_sets", name: "n_sets", statement: "n_sets holds" }, { id: "n_count", name: "n_count", statement: "n_count holds" }],
		});
		assert.ok(created.ok);
		const record = chatStore.getChat(created.chat.id)!;
		assert.equal(record.kind, "study");
		assert.deepEqual(record.messages.map((m) => (m.role === "custom" ? m.customType : m.role)), ["class-context", "graph-context", "study-context"]);
		const plan = record.messages.at(-1)!;
		assert.ok(plan.role === "custom" && plan.display === false);
		assert.match(plan.content as string, /1\. Counting — node tpc_count, teach \(never tested\), facts n_count\n2\. Sets — node tpc_sets, problems \(weak or shaky\), facts n_sets/);
		assert.deepEqual(record.tree?.nodes.map((n) => n.id), ["tpc_count", "tpc_sets"]);
	});

	it("a typed topic with no facts is one teach topic", () => {
		const created = createLesson({ title: "Bayes' rule", classId: null });
		assert.ok(created.ok);
		const record = chatStore.getChat(created.chat.id)!;
		assert.match(record.messages.at(-1)!.content as string, /1\. Bayes' rule — node topic, teach \(never tested\), no facts/);
		assert.deepEqual(record.tree?.nodes, [{ id: "topic", title: "Bayes' rule" }]);
	});

	it("runs the teacher plus problem and conclude from turn 1, with the same tools every turn", async () => {
		const cls = seedClass();
		const created = createLesson({ title: "Study: Counting", classId: cls.id, picks: [{ id: "n_count", name: "n_count", statement: "n_count holds" }] });
		assert.ok(created.ok);
		const chatId = created.chat.id;

		assert.equal((await handleChatInput(chatId, { type: "text", text: "Study: Counting" })).status, 200);
		const first = await bridge.waitForWork(5000, { conversation: chatId });
		assert.ok(first);
		assert.equal(first.instructions, composeInstructions("study"));
		const names = (first.tools ?? []).map((t) => t.name);
		for (const tool of ["quiz", "ask_user_question", "plan_init", "problem", "conclude", "research"]) assert.ok(names.includes(tool), `has ${tool}`);
		assert.ok(!names.includes("probe_done"), "no prober");
		assert.ok(first.messages.some((m) => "text" in m && /^\[Study plan\]/.test((m as { text: string }).text)), "the study plan reaches the agent");

		// A problem needs its plan node.
		assert.ok(bridge.respondToWork(first.workId, { toolCalls: [{ name: "problem", arguments: { ...POSE, nodeId: "nope" } as never }] }, 0).ok);
		const retry = await bridge.waitForWork(5000, { conversation: chatId });
		assert.ok(retry);
		assert.match(JSON.stringify(retry.messages), /matches no node in this session's plan map/);
		// A clean pose ends the turn.
		assert.ok(bridge.respondToWork(retry.workId, { toolCalls: [{ name: "problem", arguments: { ...POSE, nodeId: "tpc_count" } as never }] }, 0).ok);
		await waitFor(() => !isTurnRunning(chatId), 8000, "turn settle");
		const posed = activeProblemOf(chatStore.getChat(chatId)!.messages);
		assert.ok(posed, "the problem waits for the learner");
		assert.equal(chatStore.listChats().find((c) => c.id === chatId)?.pendingProblem, true);

		// The learner's thinking: the next turn is a small delta, the tools unchanged.
		assert.equal((await handleChatInput(chatId, { type: "thinking", problemCallId: posed.toolCallId, text: "2^3 = 8" })).status, 200);
		const second = await bridge.waitForWork(5000, { conversation: chatId });
		assert.ok(second);
		assert.equal(second.continued, true, "only the new messages are sent");
		assert.equal(second.tools, undefined, "the same tools: none resent");
		assert.ok(bridge.respondToWork(second.workId, { toolCalls: [{ name: "conclude", arguments: { outcome: "solved", verdict: "Right.", rung: null, missClass: null, retest: false } as never }] }, 0).ok);
		const closing = await bridge.waitForWork(5000, { conversation: chatId });
		assert.ok(closing);
		assert.ok(bridge.respondToWork(closing.workId, { text: "Nice." }, 0).ok);
		await waitFor(() => !isTurnRunning(chatId), 8000, "turn settle");

		// Between problems the learner moves on with Next.
		assert.equal((await handleChatInput(chatId, { type: "next" })).status, 200);
		const third = await bridge.waitForWork(5000, { conversation: chatId });
		assert.ok(third);
		assert.ok(bridge.respondToWork(third.workId, { text: "That's every topic." }, 0).ok);
		await waitFor(() => !isTurnRunning(chatId), 8000, "turn settle");
	});

	it("composes the teacher's prompt, practice's hint rules and the study fragment, not the prober or practice base", () => {
		const study = composeInstructions("study");
		assert.ok(study.startsWith(composeInstructions("teacher").split("\n\n---\n\n")[0]!), "the teacher's base leads");
		for (const part of ["# The method", "# The plan", "## Hints", "**R0 —", "## Claimed answers", "# Study sessions"]) assert.ok(study.includes(part), part);
		assert.ok(!study.includes("running practice sessions"), "not the practice base");
		assert.ok(!study.includes("probe_done"), "not the prober");
	});

	it("old teach and practice lessons still build their own agents", async () => {
		const teach = chatStore.createChat("Old lesson");
		await handleChatInput(teach.id, { type: "text", text: "hi" });
		const t = await bridge.waitForWork(5000, { conversation: teach.id });
		assert.ok(t?.tools?.some((tool) => tool.name === "probe_done"), "a teach lesson still probes first");
		assert.ok(bridge.respondToWork(t!.workId, { text: "ok" }, 0).ok);
		await waitFor(() => !isTurnRunning(teach.id), 8000, "turn settle");

		const practice = chatStore.createChat("Old practice", "practice");
		await handleChatInput(practice.id, { type: "text", text: "hi" });
		const p = await bridge.waitForWork(5000, { conversation: practice.id });
		const names = new Set([...(p?.tools ?? []).map((tool) => tool.name), ...(p?.toolsAsBefore ?? [])]);
		assert.ok(names.has("problem") && !names.has("quiz") && !names.has("plan_init"), "practice keeps its own tools");
		assert.ok(bridge.respondToWork(p!.workId, { text: "ok" }, 0).ok);
		await waitFor(() => !isTurnRunning(practice.id), 8000, "turn settle");
	});
});
