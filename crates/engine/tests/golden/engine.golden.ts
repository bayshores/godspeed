// The real pi Agent on pi-ai's faux core (set up as the outside agent's stream is), driven
// through scenarios that tests/engine_golden.rs replays on the Rust loop. Each case records its
// scenario, the events (message_update runs reduced to their last, as every view sees them),
// the final transcript and the run's error. Times are masked.
import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";

type Block = Record<string, unknown>;
type Response = { content: Block[]; stopReason?: string } | "abort";
interface Scenario {
	systemPrompt?: string;
	tools?: string[];
	messages?: unknown[];
	steeringMode?: "all" | "one-at-a-time";
	/** Queued before the run. */
	steer?: unknown[];
	followUp?: unknown[];
	run: { prompt: unknown[] } | "continue";
	responses: Response[];
	/** finishTurn ends the run after this many turns. */
	endAfterTurns?: number;
}

const user = (text: string) => ({ role: "user", content: text, timestamp: 1 });
const text = (t: string): Block => ({ type: "text", text: t });
const call = (id: string, name: string, args: unknown): Block => ({ type: "toolCall", id, name, arguments: args });
const reply = (...content: Block[]): Response => ({ content, stopReason: content.some((b) => b.type === "toolCall") ? "toolUse" : "stop" });

function toolLibrary(agentRef: { agent?: Agent }): Record<string, AgentTool<any>> {
	const ok = (t: string, details: unknown = null) => ({ content: [{ type: "text" as const, text: t }], details });
	return {
		echo: { name: "echo", label: "echo", description: "Echo text.", parameters: Type.Object({ text: Type.String() }), execute: async (_id, a: any) => ok(`echo: ${a.text}`, { text: a.text }) },
		count: { name: "count", label: "count", description: "Count.", parameters: Type.Object({ n: Type.Integer({ minimum: 0 }) }), execute: async (_id, a: any) => ok(String(a.n), a.n) },
		stop: { name: "stop", label: "stop", description: "Pose a question.", parameters: Type.Object({}), execute: async () => ({ ...ok("posed"), terminate: true }) },
		seq: { name: "seq", label: "seq", description: "Runs alone.", parameters: Type.Object({}), executionMode: "sequential", execute: async () => ok("seq done") },
		fail: { name: "fail", label: "fail", description: "Throws.", parameters: Type.Object({}), execute: async () => { throw new Error("boom"); } },
		flag_error: { name: "flag_error", label: "flag_error", description: "Reports an error.", parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: "bad" }], isError: true, details: undefined }) },
		steer: {
			name: "steer", label: "steer", description: "Steers twice.", parameters: Type.Object({}),
			execute: async () => {
				agentRef.agent!.steer(user("steer one"));
				agentRef.agent!.steer(user("steer two"));
				return ok("steered");
			},
		},
		abort: { name: "abort", label: "abort", description: "Aborts the run.", parameters: Type.Object({}), execute: async () => { agentRef.agent!.abort(); return ok("stopping"); } },
		slow: { name: "slow", label: "slow", description: "Takes a while.", parameters: Type.Object({}), execute: async () => { await new Promise((r) => setTimeout(r, 30)); return ok("slow done"); } },
	};
}

function mask(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(mask);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "timestamp" && typeof v === "number" ? "<ts>" : k === "durationMs" ? "<ms>" : mask(v)]));
	}
	return value;
}

async function play(s: Scenario) {
	const core = createFauxCore({
		api: "godspeed-agent",
		provider: "agent",
		models: [{ id: "outside-agent", name: "Outside agent (MCP)", reasoning: false, input: ["text", "image"], contextWindow: 200_000, maxTokens: 32_000 }],
	});
	const ref: { agent?: Agent } = {};
	core.setResponses(
		s.responses.map((r) => (r === "abort" ? () => { ref.agent!.abort(); return fauxAssistantMessage(""); } : fauxAssistantMessage(r.content as never, { stopReason: r.stopReason as never }))),
	);
	const library = toolLibrary(ref);
	let turns = 0;
	const agent = new Agent({
		sessionId: "chat_golden",
		initialState: { systemPrompt: s.systemPrompt ?? "", model: core.getModel(), tools: (s.tools ?? []).map((t) => library[t]!), messages: (s.messages ?? []) as never },
		streamFn: (model, context, options) => core.streamSimple(model as never, context, { ...options, cacheRetention: "none" }),
		steeringMode: s.steeringMode ?? "one-at-a-time",
		finishTurn: () => (s.endAfterTurns !== undefined && ++turns >= s.endAfterTurns ? { action: "end" } : undefined),
	});
	ref.agent = agent;
	for (const m of s.steer ?? []) agent.steer(m as never);
	for (const m of s.followUp ?? []) agent.followUp(m as never);
	const events: unknown[] = [];
	agent.subscribe((event: AgentEvent) => {
		const { assistantMessageEvent: _, ...rest } = event as AgentEvent & { assistantMessageEvent?: unknown };
		const snap = JSON.parse(JSON.stringify(rest));
		if (snap.type === "message_update" && (events.at(-1) as { type?: string } | undefined)?.type === "message_update") events.pop();
		events.push(snap);
	});
	let error: string | undefined;
	try {
		if (s.run === "continue") await agent.continue();
		else await agent.prompt(s.run.prompt as never);
	} catch (err) {
		error = (err as Error).message;
	}
	return mask({ scenario: s, events, messages: agent.state.messages, ...(error !== undefined ? { error } : {}) });
}

const all = ["echo", "count", "stop", "seq", "fail", "flag_error", "steer", "abort", "slow"];
const scenarios: Record<string, Scenario> = {
	"text reply": { systemPrompt: "You teach.", run: { prompt: [user("hi")] }, responses: [reply(text("Hello there, learner."))] },
	"no prompt no tools": { run: { prompt: [user("hi")] }, responses: [reply(text("ok"))] },
	"thinking and text": { systemPrompt: "P", run: { prompt: [user("think")] }, responses: [reply({ type: "thinking", thinking: "hmm, let me see" }, text("Done."))] },
	"parallel tools with failures": {
		systemPrompt: "You teach.",
		tools: all,
		run: { prompt: [user("go")] },
		responses: [
			reply(call("c1", "echo", { text: "a" }), call("c2", "count", { n: "5" }), call("c3", "nope", {}), call("c4", "count", { n: -2 }), call("c5", "fail", {}), call("c6", "flag_error", {})),
			reply(text("All done.")),
		],
	},
	"parallel ends in completion order": { tools: all, run: { prompt: [user("go")] }, responses: [reply(call("c1", "slow", {}), call("c2", "echo", { text: "b" })), reply(text("ok"))] },
	"all calls terminate": { tools: all, run: { prompt: [user("ask")] }, responses: [reply(text("Question:"), call("q1", "stop", {}), call("q2", "stop", {}))] },
	"mixed batch runs on": { tools: all, run: { prompt: [user("ask")] }, responses: [reply(call("q1", "stop", {}), call("e1", "echo", { text: "x" })), reply(text("after"))] },
	"sequential batch": { tools: all, run: { prompt: [user("go")] }, responses: [reply(call("s1", "echo", { text: "first" }), call("s2", "seq", {}), call("s3", "count", { n: 1 })), reply(text("ok"))] },
	"steering one at a time": { tools: all, run: { prompt: [user("go")] }, responses: [reply(call("t1", "steer", {})), reply(text("one")), reply(text("two"))] },
	"steering all at once": { tools: all, steeringMode: "all", run: { prompt: [user("go")] }, responses: [reply(call("t1", "steer", {})), reply(text("both"))] },
	"follow-up after stop": { followUp: [user("and then?")], run: { prompt: [user("go")] }, responses: [reply(text("first")), reply(text("second"))] },
	"abort during a sequential tool": { tools: all, run: { prompt: [user("go")] }, responses: [reply(call("a1", "abort", {}), call("a2", "seq", {})), reply(text("never"))] },
	"abort during parallel tools": { tools: all, run: { prompt: [user("go")] }, responses: [reply(call("a1", "abort", {}), call("a2", "echo", { text: "x" })), reply(text("never"))] },
	"abort while waiting for the model": { systemPrompt: "P", run: { prompt: [user("go")] }, responses: ["abort"] },
	"no more responses": { systemPrompt: "P", tools: ["echo"], run: { prompt: [user("go")] }, responses: [reply(call("e1", "echo", { text: "x" }))] },
	"cut off by the token limit": { tools: all, run: { prompt: [user("go")] }, responses: [{ content: [call("l1", "echo", { text: "x" })], stopReason: "length" }, reply(text("again"))] },
	"error reply": { run: { prompt: [user("go")] }, responses: [{ content: [text("partial")], stopReason: "error" }] },
	"finish ends after a turn": { tools: all, endAfterTurns: 1, run: { prompt: [user("go")] }, responses: [reply(call("e1", "echo", { text: "x" })), reply(text("never"))] },
	"continue from a user message": { systemPrompt: "P", messages: [user("earlier"), { role: "assistant", content: [text("reply")], api: "x", provider: "x", model: "x", usage: {}, stopReason: "stop", timestamp: 1 }, user("now")], run: "continue", responses: [reply(text("continued"))] },
	"continue after an assistant with steering": { messages: [user("q"), { role: "assistant", content: [text("a")], stopReason: "stop", timestamp: 1 }], steer: [user("steered")], run: "continue", responses: [reply(text("ok"))] },
	"continue after an assistant with a follow-up": { messages: [user("q"), { role: "assistant", content: [text("a")], stopReason: "stop", timestamp: 1 }], followUp: [user("more")], run: "continue", responses: [reply(text("ok"))] },
	"continue after an assistant alone": { messages: [user("q"), { role: "assistant", content: [text("a")], stopReason: "stop", timestamp: 1 }], run: "continue", responses: [] },
	"continue with nothing": { systemPrompt: "P", run: "continue", responses: [] },
	"image and tool result text in the estimate": {
		systemPrompt: "P",
		tools: ["echo"],
		messages: [{ role: "user", content: [text("look"), { type: "image", data: "aGVsbG8=", mimeType: "image/png" }], timestamp: 1 }],
		run: "continue",
		responses: [reply(call("e1", "echo", { text: "😀 é" })), reply(text("seen"))],
	},
};

export default Object.fromEntries(Object.entries(scenarios).map(([name, s]) => [name, () => play(s)]));
