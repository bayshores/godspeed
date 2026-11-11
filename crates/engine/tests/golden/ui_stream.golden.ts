// The real runPiTurn (src/backend/server/pi/ui-stream.ts) on a pi Agent with the faux core:
// the SSE frames a view gets and what onFinish receives, replayed by tests/ui_stream_golden.rs.
// Every reply reuses the id call_0, which the record already holds.
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { runPiTurn } from "../../../../src/backend/server/pi/ui-stream.ts";

type Block = Record<string, unknown>;
interface Scenario {
	messages: unknown[];
	usedIds: string[];
	responses: { content: Block[]; stopReason: string }[];
	finishFails?: boolean;
}

const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });
const call = (id: string, text: string): Block => ({ type: "toolCall", id, name: "echo", arguments: { text } });
const history = [
	user("before"),
	{ role: "assistant", content: [call("call_0", "old")], api: "x", provider: "x", model: "x", usage: {}, stopReason: "toolUse", timestamp: 1 },
	{ role: "toolResult", toolCallId: "call_0", toolName: "echo", content: [{ type: "text", text: "echo: old" }], isError: false, timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: "ok" }], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: 1 },
	user("again"),
];

const echo: AgentTool<any> = {
	name: "echo",
	label: "echo",
	description: "Echo text.",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_id, a: any) => ({ content: [{ type: "text", text: `echo: ${a.text}` }], details: { text: a.text } }),
};

function mask(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(mask);
	if (value && typeof value === "object") {
		const o = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.entries(o)
				.filter(([k]) => !(k === "durationMs" && o.role === "assistant"))
				.map(([k, v]) => [k, k === "timestamp" && typeof v === "number" ? "<ts>" : k === "durationMs" ? "<ms>" : mask(v)]),
		);
	}
	return value;
}

async function play(s: Scenario) {
	const core = createFauxCore({ api: "godspeed-agent", provider: "agent", models: [{ id: "outside-agent", name: "Outside agent (MCP)", reasoning: false, input: ["text", "image"], contextWindow: 200_000, maxTokens: 32_000 }] });
	core.setResponses(s.responses.map((r) => fauxAssistantMessage(r.content as never, { stopReason: r.stopReason as never, timestamp: 1 })));
	const agent = new Agent({
		sessionId: "chat_golden",
		initialState: { systemPrompt: "P", model: core.getModel(), tools: [echo], messages: s.messages as never },
		streamFn: (model, context, options) => core.streamSimple(model as never, context, { ...options, cacheRetention: "none" }),
	});
	let finished: unknown = null;
	const failures: unknown[] = [];
	const handle = runPiTurn({
		agent,
		usedToolCallIds: new Set(s.usedIds),
		onError: (err) => `loop: ${(err as Error).message}`,
		onSettleError: (err) => `settle: ${(err as Error).message}`,
		onSettleFailure: (err, reported) => failures.push({ error: (err as Error).message, reported: reported ?? null }),
		onFinish: (messages) => {
			finished = messages;
			if (s.finishFails) throw new Error("disk full");
		},
	});
	const text = await new Response(handle.subscribe()).text();
	const frames = text.split("\n\n").filter(Boolean).map((f) => (f === "data: [DONE]" ? "[DONE]" : JSON.parse(f.slice("data: ".length))));
	// A view that attaches after the turn settled replays the log.
	const late = (await new Response(handle.subscribe()).text()).split("\n\n").filter(Boolean).length;
	return mask({ scenario: s, frames, finished, failures, late });
}

const reply = (...content: Block[]) => ({ content, stopReason: content.some((b) => b.type === "toolCall") ? "toolUse" : "stop" });
const scenarios: Record<string, Scenario> = {
	"reused ids get fresh ones": {
		messages: history,
		usedIds: ["call_0", "call_0~2"],
		responses: [reply(call("call_0", "a"), call("call_1", "b")), reply(call("call_0", "c")), reply({ type: "text", text: "done" })],
	},
	"fresh ids stay": { messages: [user("go")], usedIds: [], responses: [reply(call("x1", "a")), reply({ type: "text", text: "done" })] },
	"run cannot start": { messages: history.slice(0, 4), usedIds: ["call_0"], responses: [] },
	"finish fails": { messages: [user("go")], usedIds: [], responses: [reply({ type: "text", text: "hi" })], finishFails: true },
};

export default Object.fromEntries(Object.entries(scenarios).map(([name, s]) => [name, () => play(s)]));
