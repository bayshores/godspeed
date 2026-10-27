/**
 * THE OUTSIDE-AGENT BRIDGE: an external agent (Claude Code, Codex, any MCP
 * client) plays the part of the model. When a turn, a background job, or
 * the extraction pipeline asks the "agent" provider for an answer, the
 * request is parked here as a WORK ITEM; the MCP server hands it to the
 * connected agent (wait_for_work) and the agent's reply (respond) resolves
 * it into an ordinary assistant message. Everything downstream — tool
 * execution, question stops, persistence, extraction — runs unchanged.
 *
 * The stream itself rides pi-ai's faux core: its response factory may be
 * async, so it simply awaits the agent. Abort (the learner's Stop) resolves
 * the wait with an empty message; the faux streamer then sees the aborted
 * signal and ends the stream as aborted.
 *
 * Process-global state on globalThis (the turn-runs.ts idiom): Next can
 * load this module more than once, and every copy must share one queue.
 */
import {
	createFauxCore,
	fauxAssistantMessage,
	type AssistantMessage,
	type Message,
	type Model,
	type Api,
	type StreamFunction,
	type TranscriptContext,
	type ToolCall,
	type JsonObject,
} from "@earendil-works/pi-ai";

export const AGENT_PROVIDER = "agent";
export const AGENT_MODEL_ID = "outside-agent";
export const AGENT_MODEL_NAME = "Outside agent (MCP)";
const AGENT_API = "godspeed-agent";

/** Context budget the app plans compaction around. Claude- and GPT-class
 *  agents both hold well over this; staying modest keeps lessons compact. */
const AGENT_CONTEXT_WINDOW = 200_000;

/** One tool the agent may call in its reply. */
export interface WorkTool {
	name: string;
	description: string;
	parameters: unknown;
}

/** One transcript message, flattened for an outside reader. */
export type WorkMessage =
	| { role: "system"; text: string }
	| { role: "user"; text: string }
	| { role: "assistant"; text?: string; toolCalls?: { id: string; name: string; arguments: unknown }[] }
	| { role: "toolResult"; toolCallId: string; toolName: string; isError: boolean; text: string };

/** One parked model request. */
interface WorkItem {
	id: string;
	/** The caller's session id (the chat id for lessons); groups requests
	 *  into one conversation so the agent receives only what is new. */
	conversation: string;
	createdAt: number;
	context: TranscriptContext;
	/** Set when an MCP client takes the item; cleared if it never answers. */
	claimedAt?: number;
	resolve: (message: AssistantMessage) => void;
}

/** What the agent sends back for one work item. */
export interface AgentReply {
	text?: string;
	toolCalls?: { name: string; arguments: JsonObject }[];
}

/** One work item as the MCP layer presents it. */
export interface WorkView {
	workId: string;
	conversation: string;
	/** true = `messages` holds only what arrived since the agent's last
	 *  reply in this conversation; false = the full transcript. */
	continued: boolean;
	/** The system prompt — only on a full (non-continued) delivery. */
	instructions?: string;
	/** The tools available for this reply — only on a full delivery. */
	tools?: WorkTool[];
	messages: WorkMessage[];
}

interface BridgeState {
	items: Map<string, WorkItem>;
	/** conversation → fingerprints of the messages the agent has seen. */
	seen: Map<string, string[]>;
	/** Wake-ups for wait_for_work callers. */
	waiters: Set<() => void>;
	/** Last time any MCP client asked for work (the "agent connected" signal). */
	lastPoll: number;
}

const STATE_KEY = Symbol.for("lh.agentBridge");

function state(): BridgeState {
	const g = globalThis as Record<symbol, BridgeState | undefined>;
	if (!g[STATE_KEY]) g[STATE_KEY] = { items: new Map(), seen: new Map(), waiters: new Set(), lastPoll: 0 };
	return g[STATE_KEY];
}

function wake(): void {
	const { waiters } = state();
	for (const w of [...waiters]) w();
}

/** A claimed item with no reply after this long goes back in the queue
 *  (the agent crashed or lost track of it). */
const CLAIM_TIMEOUT_MS = 10 * 60_000;

/** An agent counts as connected if it polled within this window. */
const CONNECTED_WINDOW_MS = 3 * 60_000;

export function agentConnected(now = Date.now()): boolean {
	return now - state().lastPoll < CONNECTED_WINDOW_MS;
}

/** How many requests are waiting for (or being handled by) the agent. */
export function pendingWorkCount(): number {
	return state().items.size;
}

// ─── Rendering the transcript for an outside reader ─────────────────────────

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c: { type?: string; text?: string }) => (c.type === "text" ? c.text ?? "" : c.type === "image" ? "[image]" : ""))
		.filter(Boolean)
		.join("\n");
}

function renderMessage(m: Message): WorkMessage | null {
	switch (m.role) {
		case "system": {
			const sections = m.sections ? Object.values(m.sections).filter((s): s is string => typeof s === "string") : [];
			const text = [textOf(m.content), ...sections].filter(Boolean).join("\n\n");
			return text ? { role: "system", text } : null;
		}
		case "user":
			return { role: "user", text: textOf(m.content) };
		case "assistant": {
			const text = m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
			const toolCalls = m.content
				.filter((c): c is ToolCall => c.type === "toolCall")
				.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));
			return { role: "assistant", ...(text ? { text } : {}), ...(toolCalls.length ? { toolCalls } : {}) };
		}
		case "toolResult":
			return { role: "toolResult", toolCallId: m.toolCallId, toolName: m.toolName, isError: m.isError, text: textOf(m.content) };
	}
}

/** The leading system message carries the prompt; any system message may add tools. */
function instructionsAndTools(messages: Message[]): { instructions: string; tools: WorkTool[] } {
	let instructions = "";
	const tools = new Map<string, WorkTool>();
	for (const m of messages) {
		if (m.role !== "system") continue;
		if (!instructions) instructions = renderMessage(m)?.role === "system" ? (renderMessage(m) as { text: string }).text : "";
		for (const t of m.toolsAdded ?? []) tools.set(t.name, { name: t.name, description: t.description, parameters: t.parameters });
	}
	return { instructions, tools: [...tools.values()] };
}

function fingerprint(m: Message): string {
	return JSON.stringify(renderMessage(m));
}

/** Present one item, sending only the unseen tail when the agent already
 *  holds this conversation's earlier messages. */
function view(item: WorkItem, forceFull: boolean): WorkView {
	const all = item.context.messages;
	const prints = all.map(fingerprint);
	const seen = forceFull ? undefined : state().seen.get(item.conversation);
	const continued = !!seen && seen.length <= prints.length && seen.every((p, i) => p === prints[i]);
	const fresh = continued ? all.slice(seen!.length) : all;
	const messages = fresh.filter((m) => m.role !== "system" || continued).map(renderMessage).filter((m): m is WorkMessage => m !== null);
	if (continued) return { workId: item.id, conversation: item.conversation, continued, messages };
	const { instructions, tools } = instructionsAndTools(all);
	return { workId: item.id, conversation: item.conversation, continued, instructions, tools, messages };
}

// ─── The MCP-facing operations ──────────────────────────────────────────────

function nextUnclaimed(now: number): WorkItem | undefined {
	const items = [...state().items.values()].sort((a, b) => a.createdAt - b.createdAt);
	return items.find((i) => i.claimedAt === undefined || now - i.claimedAt > CLAIM_TIMEOUT_MS);
}

/** Wait up to `timeoutMs` for a request, claim it, and present it. */
export async function waitForWork(timeoutMs: number, opts: { full?: boolean; conversation?: string } = {}): Promise<WorkView | null> {
	const s = state();
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const now = Date.now();
		s.lastPoll = now;
		const item = opts.conversation
			? [...s.items.values()].find((i) => i.conversation === opts.conversation && (i.claimedAt === undefined || now - i.claimedAt > CLAIM_TIMEOUT_MS))
			: nextUnclaimed(now);
		if (item) {
			item.claimedAt = now;
			return view(item, !!opts.full);
		}
		const remaining = deadline - now;
		if (remaining <= 0) return null;
		await new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				s.waiters.delete(done);
				resolve();
			};
			const timer = setTimeout(done, Math.min(remaining, 15_000));
			s.waiters.add(done);
		});
	}
}

/** Answer a work item. Returns the item's conversation, or an error. */
export function respondToWork(workId: string, reply: AgentReply): { ok: true; conversation: string } | { ok: false; error: string } {
	const s = state();
	const item = s.items.get(workId);
	if (!item) return { ok: false, error: `No open work item "${workId}" — it was already answered or the request was cancelled. Call wait_for_work for the current one.` };
	const toolNames = new Set(instructionsAndTools(item.context.messages).tools.map((t) => t.name));
	const unknown = (reply.toolCalls ?? []).map((c) => c.name).filter((n) => !toolNames.has(n));
	if (unknown.length > 0) {
		return { ok: false, error: `Unknown tool(s): ${unknown.join(", ")}. Available: ${[...toolNames].join(", ") || "none"}.` };
	}
	if (!reply.text?.trim() && !(reply.toolCalls?.length)) {
		return { ok: false, error: "A reply needs text, tool calls, or both." };
	}
	const message = toAssistant(reply);
	s.items.delete(workId);
	// The agent already knows its own reply: mark it seen so the next
	// delivery in this conversation starts at the tool results.
	s.seen.set(item.conversation, [...item.context.messages.map(fingerprint), fingerprint(message)]);
	item.resolve(message);
	return { ok: true, conversation: item.conversation };
}

// ─── The engine side ────────────────────────────────────────────────────────

function toAssistant(reply: AgentReply): AssistantMessage {
	const blocks = [
		...(reply.text?.trim() ? [{ type: "text" as const, text: reply.text }] : []),
		...(reply.toolCalls ?? []).map((c) => ({
			type: "toolCall" as const,
			id: `agent_${crypto.randomUUID().slice(0, 12)}`,
			name: c.name,
			arguments: c.arguments,
		})),
	];
	return fauxAssistantMessage(blocks, { stopReason: reply.toolCalls?.length ? "toolUse" : "stop" });
}

const core = createFauxCore({
	api: AGENT_API,
	provider: AGENT_PROVIDER,
	models: [{ id: AGENT_MODEL_ID, name: AGENT_MODEL_NAME, reasoning: false, input: ["text", "image"], contextWindow: AGENT_CONTEXT_WINDOW, maxTokens: 32_000 }],
});

/** The bridge's single model entry (catalog + engine). */
export function agentModel(): Model<Api> {
	return core.getModel() as Model<Api>;
}

/** Park one request and wait for the agent's reply (or an abort). */
function awaitAgent(context: TranscriptContext, sessionId: string | undefined, signal: AbortSignal | undefined): Promise<AssistantMessage> {
	return new Promise((resolve) => {
		const id = `work_${crypto.randomUUID().slice(0, 12)}`;
		const conversation = sessionId ?? id;
		const onAbort = () => {
			state().items.delete(id);
			resolve(fauxAssistantMessage(""));
		};
		if (signal?.aborted) return onAbort();
		signal?.addEventListener("abort", onAbort, { once: true });
		state().items.set(id, {
			id,
			conversation,
			createdAt: Date.now(),
			context,
			resolve: (message) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(message);
			},
		});
		wake();
	});
}

/** The stream function the "agent" provider's engine uses. */
export const agentStream: StreamFunction<Api> = (model, context, options) => {
	core.appendResponses([(ctx, opts) => awaitAgent(ctx, opts?.sessionId, opts?.signal)]);
	return core.streamSimple(model as Model<string>, context, options);
};
