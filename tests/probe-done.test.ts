/**
 * probe_done — the probe→planning seam tool (docs/archive/probe-teach-split.md §2).
 * Server-side; three outcomes: refusal while a question is open, refusal
 * after the probe is already concluded, ok + handoff queued. The handoff
 * rides the wake pipeline (deliver injected here — no server seam import).
 * Wave B: the record is native history — fixtures are pi messages, the
 * pending-question gate is the dangling-question scan, and the handoff is
 * a native marker (customType probe-handoff, HANDOFF_TEXT content).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createProberTools } from "../src/agent/tools.ts";
import { probeDoneTool, type ProbeTurnGate } from "../src/agent/tools/probe.ts";
import { jobStore } from "../src/store/jobs.ts";
import type { SteerMessage } from "../src/core/contracts.ts";
import { hasProbeDone, type LhMessage } from "../src/core/native-messages.ts";
import { HANDOFF_TEXT } from "../src/core/contracts.ts";
import { chatStore } from "../src/store/chats.ts";
import { PATHS } from "../src/config.ts";

const dataDir = path.join(PATHS.root, "data");
fs.mkdirSync(dataDir, { recursive: true });

const createdChats: string[] = [];
after(() => {
	for (const id of createdChats) {
		try {
			fs.unlinkSync(path.join(PATHS.chats, `${id}.json`));
		} catch {
			/* scratch cleanup, best effort */
		}
	}
});

function newChat(title: string): string {
	const chat = chatStore.createChat(title);
	createdChats.push(chat.id);
	return chat.id;
}

const ASSESSMENT = {
	strands: [
		{ strand: "the derivative as a limit", assessment: "Floor: slope intuition. Ceiling: formal ε–δ." },
	],
	summary: "Enter at the formal definition.",
};

/** A native assistant message carrying one tool call (the minimal fixture
 *  shape the scans read — role assistant, content blocks). */
function assistantWithCall(id: string, toolName: string, args: unknown): LhMessage {
	return {
		id,
		role: "assistant",
		content: [{ type: "toolCall", id: `call_${id}`, name: toolName, arguments: args as never }],
		api: "openai-completions",
		provider: "openrouter",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		stopReason: "stop",
		timestamp: Date.now(),
	} as never;
}

function probeDoneResult(callId: string, isError: boolean, details?: unknown): LhMessage {
	return {
		id: `${callId}_r`,
		role: "toolResult",
		toolCallId: callId,
		toolName: "probe_done",
		content: [{ type: "text", text: isError ? "Invalid tool input" : "ok" }],
		isError,
		...(details !== undefined ? { details } : {}),
		timestamp: Date.now(),
	} as never;
}

async function execute(tools: Record<string, AgentTool<any>>, input: unknown) {
	const t = tools.probe_done!;
	assert.ok(typeof t.execute === "function");
	return t.execute("test", input).then((r) => r.details as { ok: boolean; error?: string });
}

const freshGate = (): ProbeTurnGate => ({ questionPosed: false, concluded: false });

const validProbe = {
	question: "What is 2 + 2?",
	options: [
		{ label: "3", value: "3" },
		{ label: "4", value: "4" },
	],
	correctAnswer: "4",
};

function proberTools(chatId: string, delivered: SteerMessage[]) {
	return createProberTools({ chatId, chatStore, deliver: (s) => delivered.push(s), jobStore, spawn: () => {} });
}

describe("hasProbeDone: the probe→teach construction seam", () => {
	it("only a probe_done call whose result is not an error concludes the probe", () => {
		const call = assistantWithCall("m1", "probe_done", { assessment: ASSESSMENT });
		assert.equal(hasProbeDone([call]), false, "a call with no result yet keeps probing");
		assert.equal(hasProbeDone([call, probeDoneResult("call_m1", true)]), false, "a failed call keeps probing");
		assert.equal(
			hasProbeDone([call, probeDoneResult("call_m1", false, { ok: false, error: "A question is still open" })]),
			false,
			"a refused call keeps probing",
		);
		assert.equal(hasProbeDone([call, probeDoneResult("call_m1", false, { ok: true })]), true);
		assert.equal(hasProbeDone([call, probeDoneResult("call_m1", false)]), true);
	});
});

describe("probe_done: the probe→planning seam", () => {
	it("ok path: records the assessment and queues the handoff steer (deterministic id)", async () => {
		const chatId = newChat("Probe: ok");
		const delivered: SteerMessage[] = [];
		const tools = probeDoneTool({ chatId, chatStore, deliver: (s) => delivered.push(s) }, freshGate());

		const res = await execute(tools, { assessment: ASSESSMENT });
		assert.equal(res.ok, true);
		assert.equal(res.error, undefined);
		assert.equal(delivered.length, 1, "the handoff is queued exactly once");
		assert.equal(delivered[0]!.id, `steer_probe_${chatId}`);
		// Native marker (Wave B): the model-facing HANDOFF_TEXT rides content;
		// the UI keys off customType; the chat id rides details.
		assert.equal(delivered[0]!.customType, "probe-handoff");
		assert.equal(delivered[0]!.content, HANDOFF_TEXT);
		assert.equal((delivered[0]!.details as { chatId: string }).chatId, chatId);
	});

	it("REFUSES while a question is still open — resolve it first", async () => {
		const chatId = newChat("Probe: open question");
		chatStore.saveMessages(chatId, [
			assistantWithCall("m1", "quiz", { question: "q?", options: [{ label: "a" }], correctAnswer: "a" }),
		]);
		const delivered: SteerMessage[] = [];
		const tools = probeDoneTool({ chatId, chatStore, deliver: (s) => delivered.push(s) }, freshGate());

		const res = await execute(tools, { assessment: ASSESSMENT });
		assert.equal(res.ok, false);
		assert.match(res.error!, /question is still open/i);
		assert.equal(delivered.length, 0, "nothing queued on refusal");
	});

	it("REFUSES a second conclusion — probe_done fires exactly once", async () => {
		const chatId = newChat("Probe: twice");
		chatStore.saveMessages(chatId, [
			assistantWithCall("m1", "probe_done", { assessment: ASSESSMENT }),
			probeDoneResult("call_m1", false),
		]);
		const delivered: SteerMessage[] = [];
		const tools = probeDoneTool({ chatId, chatStore, deliver: (s) => delivered.push(s) }, freshGate());

		const res = await execute(tools, { assessment: ASSESSMENT });
		assert.equal(res.ok, false);
		assert.match(res.error!, /already concluded/i);
		assert.equal(delivered.length, 0);
	});

	it("REFUSES an unknown chat defensively", async () => {
		const tools = probeDoneTool({ chatId: "chat_nonexistent", chatStore, deliver: () => {} }, freshGate());
		const res = await execute(tools, { assessment: ASSESSMENT });
		assert.equal(res.ok, false);
		assert.match(res.error!, /not found/i);
	});

	it("a deliver failure never fails the call — the assessment records; the wake is recoverable-by-design", async () => {
		const chatId = newChat("Probe: deliver crash");
		const tools = probeDoneTool({
			chatId,
			chatStore,
			deliver: () => {
				throw new Error("queue exploded");
			},
		}, freshGate());
		const res = await execute(tools, { assessment: ASSESSMENT });
		assert.equal(res.ok, true, "ok:true even when the queue is lost — the next client message constructs the teacher off the transcript seam");
	});
});

describe("probe_done within one turn (the stored record only updates at turn end)", () => {
	it("probe then probe_done in one batch: probe_done is refused", async () => {
		const delivered: SteerMessage[] = [];
		const tools = proberTools(newChat("Probe: same-turn question"), delivered);
		const posed = await tools.probe!.execute("q1", validProbe);
		assert.notEqual(posed.isError, true);
		const res = await execute(tools, { assessment: ASSESSMENT });
		assert.equal(res.ok, false);
		assert.match(res.error!, /question is still open/i);
		assert.equal(delivered.length, 0);
	});

	it("a failed pose leaves probe_done open, so the prober can retry", async () => {
		const tools = proberTools(newChat("Probe: failed pose"), []);
		const failed = await tools.probe!.execute("q1", { ...validProbe, correctAnswer: "7" });
		assert.equal(failed.isError, true);
		assert.equal((await execute(tools, { assessment: ASSESSMENT })).ok, true);
	});

	it("probe_done then probe: the question is refused", async () => {
		const tools = proberTools(newChat("Probe: question after done"), []);
		assert.equal((await execute(tools, { assessment: ASSESSMENT })).ok, true);
		const late = await tools.probe!.execute("q1", validProbe);
		assert.equal(late.isError, true);
		assert.match((late.content[0] as { text: string }).text, /already concluded/);
	});

	it("probe_done twice: the second call is refused", async () => {
		const delivered: SteerMessage[] = [];
		const tools = proberTools(newChat("Probe: done twice"), delivered);
		assert.equal((await execute(tools, { assessment: ASSESSMENT })).ok, true);
		const second = await execute(tools, { assessment: ASSESSMENT });
		assert.equal(second.ok, false);
		assert.match(second.error!, /already concluded/i);
		assert.equal(delivered.length, 1);
	});
});
