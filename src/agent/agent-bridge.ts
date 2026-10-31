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
 *
 * CHECK-INS: every authorized MCP request counts as the agent being
 * connected; only the work loop (wait_for_work, respond, read_work) counts
 * as teaching. The client info a request carries names it ("Claude Code").
 * Status changes go out as the "agent-changed" event so open windows
 * (onboarding, the sidebar, the activity panel) update live.
 * Requests wait for an agent with no time limit, so work queued while no
 * agent is connected starts by itself once one connects.
 */
import type {
	AssistantMessage,
	Message,
	Model,
	Api,
	StreamFunction,
	TranscriptContext,
	ToolCall,
	JsonObject,
} from "@earendil-works/pi-ai";
// The faux provider's own entry, not the package root: the root loads
// every provider (~0.15–0.3 s at startup); this subpath is a few small files.
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { createHash } from "node:crypto";
import { CHAT_ID_PREFIX } from "../core/contracts.ts";
import { continuesFrom, seenMark, type SeenMark, type SeenStore } from "../core/agent-seen.ts";
import { emit } from "../core/events.ts";
import { OUTSIDE_AGENT_CONTEXT_WINDOW, OUTSIDE_AGENT_MODEL_ID, OUTSIDE_AGENT_PROVIDER } from "../core/settings.ts";

const AGENT_MODEL_NAME = "Outside agent (MCP)";
const AGENT_API = "godspeed-agent";

/** One tool the agent may call in its reply. */
export interface WorkTool {
	name: string;
	description: string;
	parameters: unknown;
}

/** One image in a work item, sent to the agent as a real MCP image. In
 *  the message text it appears as "[image N]" (N = its place in `images`,
 *  from 1). */
export interface WorkImage {
	data: string;
	mimeType: string;
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
	/** The session id of the agent that took it, when its client sends one. */
	agent?: string;
	/** How often it was taken. The workId an agent sees ends in this count,
	 *  so a late reply from an earlier claim can't answer for the latest. */
	claims: number;
	/** The agent lost its context while holding this item, so its reply
	 *  doesn't count as having seen the conversation. */
	agentForgot?: boolean;
	/** The item as the agent reads it, in pages of text blocks
	 *  (core/work-pages). Page 1 goes out with the item, the rest through
	 *  read_work. */
	pages?: string[][];
	/** Pages the agent has not read yet; respond waits until none are left. */
	unread?: Set<number>;
	resolve: (message: AssistantMessage) => void;
}

/** What the agent sends back for one work item. */
interface AgentReply {
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
	/** The system prompt — only on a full (non-continued) delivery, and
	 *  only when its agent hasn't had the same text before. */
	instructions?: string;
	/** Instead of `instructions`: the earlier workId whose instructions
	 *  are the same, which the agent already has. */
	instructionsAsIn?: string;
	/** The tools available for this reply — only on a full delivery, and
	 *  only those its agent hasn't had before with the same schema. */
	tools?: WorkTool[];
	/** The names of this reply's other tools, which the agent already has. */
	toolsAsBefore?: string[];
	messages: WorkMessage[];
	/** The background task's name ("Topic grouping · CSE 21"), when the
	 *  caller gave one (pi-run taskLabel). */
	label?: string;
	/** The images in `messages`, in order (absent when there are none). */
	images?: WorkImage[];
}

interface BridgeState {
	items: Map<string, WorkItem>;
	/** conversation → agent ("" = no id) → what that agent has seen of it. */
	seenBy: Map<string, Map<string, SeenMark>>;
	/** Where lesson marks of agents with an id are saved (server wires it). */
	seenStore?: SeenStore;
	/** Wake-ups for wait_for_work callers. */
	waiters: Set<() => void>;
	/** Last time an MCP client sent any request (the "agent connected" signal). */
	lastContact: number;
	/** Last time an agent called the work loop (the "teaching" signal). */
	lastWork: number;
	/** agent id → the instructions (hash → the workId that carried them)
	 *  and tools (hashes) it has, so a new conversation can skip them. */
	known: Map<string, { instructions: Map<string, string>; tools: Set<string> }>;
	/** The agent's name from its MCP client info ("Claude Code"). */
	agentName?: string;
	/** Fires "agent-changed" when the connection lapses. */
	lapseTimer?: ReturnType<typeof setTimeout>;
	/** conversation → the task's name (background jobs that gave one). */
	labels: Map<string, string>;
	/** conversation → until when (ms) its next item is held for the agent
	 *  that just answered it, so another waiting agent can't take it. */
	held: Map<string, number>;
	/** Background conversations whose run hasn't ended (forgetConversation). */
	backgroundRuns: Set<string>;
}

const STATE_KEY = Symbol.for("lh.agentBridge");

function state(): BridgeState {
	const g = globalThis as Record<symbol, BridgeState | undefined>;
	if (!g[STATE_KEY]) g[STATE_KEY] = { items: new Map(), seenBy: new Map(), waiters: new Set(), lastContact: 0, lastWork: 0, known: new Map(), labels: new Map(), held: new Map(), backgroundRuns: new Set() };
	g[STATE_KEY].labels ??= new Map(); // a state built before labels existed (dev reload)
	g[STATE_KEY].held ??= new Map();
	g[STATE_KEY].seenBy ??= new Map();
	g[STATE_KEY].backgroundRuns ??= new Set();
	g[STATE_KEY].lastContact ??= 0;
	g[STATE_KEY].lastWork ??= 0;
	g[STATE_KEY].known ??= new Map();
	return g[STATE_KEY];
}

/** Name a background conversation for the outside agent (pi-run calls
 *  this for runs with a taskLabel, and forgets the run when it ends). */
export function labelConversation(conversation: string, label: string): void {
	state().labels.set(conversation, label);
}

/** Drop a finished background run's state: it is never delivered again,
 *  and its seen transcript would otherwise stay in memory until restart.
 *  A respond still waiting for the run's next item stops waiting. */
export function forgetConversation(conversation: string): void {
	const s = state();
	s.labels.delete(conversation);
	s.seenBy.delete(conversation);
	s.held.delete(conversation);
	if (s.backgroundRuns.delete(conversation)) wake();
}

function wake(): void {
	const { waiters } = state();
	for (const w of [...waiters]) w();
}

/** A claimed item with no reply after this long goes back in the queue
 *  (the agent crashed or lost track of it). */
const CLAIM_TIMEOUT_MS = 10 * 60_000;

/** An agent counts as connected (or teaching) if it checked in within this window. */
const CONNECTED_WINDOW_MS = 3 * 60_000;

function recent(at: number, now: number): boolean {
	return now - at < CONNECTED_WINDOW_MS;
}

export function agentConnected(now = Date.now()): boolean {
	const s = state();
	return recent(s.lastContact, now) || recent(s.lastWork, now);
}

/** An agent runs the work loop. Without this, a connected agent (any
 *  Claude Code session in the godspeed folder) only connected or called other
 *  tools, and lessons wait. */
export function agentTeaching(now = Date.now()): boolean {
	return recent(state().lastWork, now);
}

/** Lessons whose current request an agent took and hasn't answered yet,
 *  with when it took it (so the window can tell a stuck turn). */
export function claimedLessons(): { lessonId: string; claimedAt: string }[] {
	return [...state().items.values()]
		.filter((item) => !isBackground(item) && item.claimedAt !== undefined)
		.map((item) => ({ lessonId: item.conversation, claimedAt: new Date(item.claimedAt!).toISOString() }));
}

/** How many requests are waiting for (or being handled by) the agent. */
export function pendingWorkCount(): number {
	return state().items.size;
}

/** The agent's name, while it is connected. */
export function agentName(now = Date.now()): string | undefined {
	return agentConnected(now) ? state().agentName : undefined;
}

/** A readable name for an MCP client's clientInfo ("claude-code" →
 *  "Claude Code"). Unknown clients keep their own title or name. */
export function displayAgentName(clientInfo: { name?: unknown; title?: unknown } | undefined): string | undefined {
	const name = typeof clientInfo?.name === "string" ? clientInfo.name.trim() : "";
	const title = typeof clientInfo?.title === "string" ? clientInfo.title.trim() : "";
	if (/claude[-_ ]?code/i.test(name)) return "Claude Code";
	if (/codex/i.test(name)) return "Codex";
	return (title || name).slice(0, 60) || undefined;
}

/** The agent checked in: any authorized MCP request, or (`working`) a
 *  work-loop call. `name` comes from the request's client info; requests
 *  without one keep the last name. */
export function recordCheckIn(how: { name?: string; working?: boolean } = {}, now = Date.now()): void {
	const s = state();
	const before = { connected: agentConnected(now), teaching: agentTeaching(now), name: s.agentName };
	if (how.working) s.lastWork = now;
	else s.lastContact = now;
	if (how.name) s.agentName = how.name;
	scheduleLapse(now);
	if (!before.connected || before.teaching !== agentTeaching(now) || s.agentName !== before.name) emit("agent-changed", {});
}

/** Fire "agent-changed" when the next of teaching or connected lapses. */
function scheduleLapse(now: number): void {
	const s = state();
	if (s.lapseTimer) clearTimeout(s.lapseTimer);
	const next = [s.lastContact, s.lastWork].map((at) => at + CONNECTED_WINDOW_MS).filter((at) => at > now);
	if (next.length === 0) return;
	s.lapseTimer = setTimeout(() => {
		emit("agent-changed", {});
		scheduleLapse(Date.now());
	}, Math.min(...next) - now + 1000);
	s.lapseTimer.unref?.();
}

// ─── Rendering the transcript for an outside reader ─────────────────────────

/** Text with each image as "[image N]", the image itself going to
 *  `images`. Without a collector (fingerprints) an image is "[image]". */
function textOf(content: unknown, images?: WorkImage[]): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c: { type?: string; text?: string; data?: string; mimeType?: string }) => {
			if (c.type === "text") return c.text ?? "";
			if (c.type !== "image") return "";
			if (!images || typeof c.data !== "string" || typeof c.mimeType !== "string") return "[image]";
			images.push({ data: c.data, mimeType: c.mimeType });
			return `[image ${images.length}]`;
		})
		.filter(Boolean)
		.join("\n");
}

function renderMessage(m: Message, images?: WorkImage[]): WorkMessage | null {
	switch (m.role) {
		case "system": {
			const sections = m.sections ? Object.values(m.sections).filter((s): s is string => typeof s === "string") : [];
			const text = [textOf(m.content), ...sections].filter(Boolean).join("\n\n");
			return text ? { role: "system", text } : null;
		}
		case "user":
			return { role: "user", text: textOf(m.content, images) };
		case "assistant": {
			const text = m.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
			const toolCalls = m.content
				.filter((c): c is ToolCall => c.type === "toolCall")
				.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));
			return { role: "assistant", ...(text ? { text } : {}), ...(toolCalls.length ? { toolCalls } : {}) };
		}
		case "toolResult":
			return { role: "toolResult", toolCallId: m.toolCallId, toolName: m.toolName, isError: m.isError, text: textOf(m.content, images) };
	}
}

/** The leading system message carries the prompt; any system message may add tools. */
function instructionsAndTools(messages: Message[]): { instructions: string; tools: WorkTool[] } {
	let instructions = "";
	const tools = new Map<string, WorkTool>();
	for (const m of messages) {
		if (m.role !== "system") continue;
		if (!instructions) {
			const rendered = renderMessage(m);
			instructions = rendered?.role === "system" ? rendered.text : "";
		}
		for (const t of m.toolsAdded ?? []) tools.set(t.name, { name: t.name, description: t.description, parameters: t.parameters });
	}
	return { instructions, tools: [...tools.values()] };
}

/** A system message counts its tool names too: the prompt text stays the
 *  same when the learner changes tools in Settings, and the agent must then
 *  get the item in full with the new tools. */
function fingerprint(m: Message): string {
	if (m.role !== "system") return JSON.stringify(renderMessage(m));
	const names = (tools: { name: string }[] | undefined) => (tools ?? []).map((t) => t.name).sort();
	return JSON.stringify({ ...renderMessage(m), tools: names(m.toolsAdded), removed: names(m.toolsRemoved) });
}

/** Only lessons outlive a restart; background jobs never come back. */
function savesSeen(agent: string | undefined, conversation: string): agent is string {
	return !!agent && !!state().seenStore && conversation.startsWith(CHAT_ID_PREFIX);
}

function seenOf(agent: string | undefined, conversation: string): SeenMark | undefined {
	const s = state();
	const mark = s.seenBy.get(conversation)?.get(agent ?? "");
	return mark ?? (savesSeen(agent, conversation) ? s.seenStore!.get(agent, conversation) : undefined);
}

function rememberSeen(agent: string | undefined, conversation: string, mark: SeenMark): void {
	const s = state();
	let byAgent = s.seenBy.get(conversation);
	if (!byAgent) s.seenBy.set(conversation, (byAgent = new Map()));
	byAgent.set(agent ?? "", mark);
	if (savesSeen(agent, conversation)) s.seenStore!.set(agent, conversation, mark);
}

/** Save what agents have seen (the server wires data/agent-seen.json). */
export function setSeenStore(store: SeenStore): void {
	state().seenStore = store;
}

/** The agent lost its context (it compacted or cleared): its next items
 *  come in full. A cleared session is gone for good, so the items it held
 *  go to the next agent at once. */
export function forgetAgent(agent: string, cleared: boolean): void {
	const s = state();
	for (const byAgent of s.seenBy.values()) byAgent.delete(agent);
	s.known.delete(agent);
	let released = false;
	for (const item of s.items.values()) {
		if (item.agent !== agent) continue;
		item.agentForgot = true;
		if (cleared && item.claimedAt !== undefined) {
			item.claimedAt = undefined;
			released = true;
		}
	}
	s.seenStore?.forgetAgent(agent);
	if (released) emit("agent-changed", {});
	if (cleared) wake();
}

function hashOf(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Present one item, sending only the unseen tail when its agent already
 *  holds this conversation's earlier messages, and only the instructions
 *  and tools it doesn't already have from another conversation. */
function view(item: WorkItem, forceFull: boolean): WorkView {
	const all = item.context.messages;
	const prints = all.map(fingerprint);
	const seen = forceFull ? undefined : seenOf(item.agent, item.conversation);
	const continued = continuesFrom(seen, prints);
	const fresh = continued ? all.slice(seen!.count) : all;
	const images: WorkImage[] = [];
	const messages = fresh
		.filter((m) => m.role !== "system" || continued)
		.map((m) => renderMessage(m, images))
		.filter((m): m is WorkMessage => m !== null);
	const label = state().labels.get(item.conversation);
	const extra = { ...(label ? { label } : {}), ...(images.length ? { images } : {}) };
	const workId = `${item.id}_${item.claims}`;
	if (continued) return { workId, conversation: item.conversation, continued, messages, ...extra };
	const { instructions, tools } = instructionsAndTools(all);
	// Without an id, agents can't be told apart: everything goes in full.
	if (item.agent === undefined) return { workId, conversation: item.conversation, continued, instructions, tools, messages, ...extra };
	const s = state();
	let known = s.known.get(item.agent);
	if (!known) s.known.set(item.agent, (known = { instructions: new Map(), tools: new Set() }));
	const instructionsHash = hashOf(instructions);
	const instructionsAsIn = forceFull || !instructions ? undefined : known.instructions.get(instructionsHash);
	if (!instructionsAsIn) known.instructions.set(instructionsHash, workId);
	const newTools: WorkTool[] = [];
	const toolsAsBefore: string[] = [];
	for (const tool of tools) {
		const toolHash = hashOf(JSON.stringify(tool));
		if (!forceFull && known.tools.has(toolHash)) toolsAsBefore.push(tool.name);
		else newTools.push(tool);
		known.tools.add(toolHash);
	}
	return {
		workId,
		conversation: item.conversation,
		continued,
		...(instructionsAsIn ? { instructionsAsIn } : { instructions }),
		tools: newTools,
		...(toolsAsBefore.length ? { toolsAsBefore } : {}),
		messages,
		...extra,
	};
}

/** The open item a workId names, presented again in full: instructions,
 *  every tool and the whole transcript (the agent lost track of it). */
export function fullWorkView(workId: string): { ok: true; view: WorkView } | { ok: false; error: string } {
	recordCheckIn({ working: true });
	const item = openItem(workId);
	if (!item) return { ok: false, error: noItem(workId) };
	item.agentForgot = false;
	return { ok: true, view: view(item, true) };
}

/** The open item a workId names, only while that claim is its latest. */
function openItem(workId: string): WorkItem | undefined {
	const at = workId.lastIndexOf("_");
	const item = state().items.get(workId.slice(0, at));
	return item && workId.slice(at + 1) === String(item.claims) ? item : undefined;
}

// ─── The MCP-facing operations ──────────────────────────────────────────────

/** Lessons use their chat id as the conversation; everything else
 *  (extraction, topic grouping, helpers) is a background job. */
function isBackground(item: WorkItem): boolean {
	return !item.conversation.startsWith(CHAT_ID_PREFIX);
}

interface Taker {
	conversation?: string;
	agent?: string;
}

function claimable(item: WorkItem, now: number, taker: Taker): boolean {
	if (item.conversation !== taker.conversation && (state().held.get(item.conversation) ?? 0) > now) return false;
	// An agent may take its own item again (a compaction lost its workId).
	if (taker.agent !== undefined && item.agent === taker.agent) return true;
	return item.claimedAt === undefined || now - item.claimedAt > CLAIM_TIMEOUT_MS;
}

/** Oldest first, so jobs are answered in the order they were asked. */
function oldestClaimable(now: number, taker: Taker, keep: (i: WorkItem) => boolean): WorkItem | undefined {
	const items = [...state().items.values()].sort((a, b) => a.createdAt - b.createdAt);
	return items.find((i) => keep(i) && claimable(i, now, taker));
}

/** Pick the next item. With a conversation, that conversation's item;
 *  `andBackground` also allows background jobs, so an agent staying on one
 *  lesson still does the file reading and graph work nobody else would. */
function pick(now: number, opts: Taker & { andBackground?: boolean }): WorkItem | undefined {
	const { conversation } = opts;
	if (!conversation) return oldestClaimable(now, opts, () => true);
	return (
		oldestClaimable(now, opts, (i) => i.conversation === conversation) ??
		(opts.andBackground ? oldestClaimable(now, opts, isBackground) : undefined)
	);
}

/** Wait up to `timeoutMs` for a request, claim it, and present it. Stops
 *  without claiming once `signal` aborts (the caller went away). */
export async function waitForWork(
	timeoutMs: number,
	opts: Taker & { full?: boolean; andBackground?: boolean; signal?: AbortSignal } = {},
): Promise<WorkView | null> {
	const s = state();
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (opts.signal?.aborted) return null;
		const now = Date.now();
		recordCheckIn({ working: true }, now);
		const item = pick(now, opts);
		if (item) {
			item.claimedAt = now;
			item.claims++;
			item.agent = opts.agent;
			item.agentForgot = false;
			emit(isBackground(item) ? "activity-changed" : "agent-changed", {});
			return view(item, !!opts.full);
		}
		// A background run that ended sends nothing more.
		const { conversation } = opts;
		if (conversation && !conversation.startsWith(CHAT_ID_PREFIX) && !s.backgroundRuns.has(conversation)) return null;
		const remaining = deadline - now;
		if (remaining <= 0) return null;
		await new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				s.waiters.delete(done);
				opts.signal?.removeEventListener("abort", done);
				resolve();
			};
			const timer = setTimeout(done, Math.min(remaining, 15_000));
			s.waiters.add(done);
			opts.signal?.addEventListener("abort", done, { once: true });
		});
	}
}

/** Answer a work item. Its conversation's next item is held for the
 *  answering agent for `holdMs` (it waits for it right after; release with
 *  releaseConversation). Returns the item's conversation, or an error. */
export function respondToWork(
	workId: string,
	reply: AgentReply,
	holdMs: number,
): { ok: true; conversation: string; agent?: string } | { ok: false; error: string } {
	const s = state();
	recordCheckIn({ working: true });
	const item = openItem(workId);
	if (!item) return { ok: false, error: noItem(workId) };
	const unread = [...(item.unread ?? [])].sort((a, b) => a - b);
	if (unread.length > 0) {
		return { ok: false, error: `Read the rest of this work item first: page(s) ${unread.join(", ")} of ${item.pages!.length} are unread. Call read_work with work_id "${workId}" and page ${unread[0]}.` };
	}
	const toolNames = new Set(instructionsAndTools(item.context.messages).tools.map((t) => t.name));
	const unknown = (reply.toolCalls ?? []).map((c) => c.name).filter((n) => !toolNames.has(n));
	if (unknown.length > 0) {
		return { ok: false, error: `Unknown tool(s): ${unknown.join(", ")}. Available: ${[...toolNames].join(", ") || "none"}.` };
	}
	if (!reply.text?.trim() && !(reply.toolCalls?.length)) {
		return { ok: false, error: "A reply needs text, tool calls, or both." };
	}
	const message = toAssistant(reply);
	s.items.delete(item.id);
	emit("agent-changed", {});
	// The agent already knows its own reply: mark it seen so the next
	// delivery in this conversation starts at the tool results.
	if (!item.agentForgot) rememberSeen(item.agent, item.conversation, seenMark([...item.context.messages.map(fingerprint), fingerprint(message)]));
	s.held.set(item.conversation, Date.now() + holdMs);
	item.resolve(message);
	return { ok: true, conversation: item.conversation, ...(item.agent ? { agent: item.agent } : {}) };
}

/** Keep a presented item's pages; page 1 went out with it. */
export function setWorkPages(workId: string, pages: string[][]): void {
	const item = openItem(workId);
	if (!item) return;
	item.pages = pages;
	item.unread = new Set(pages.map((_, i) => i + 1).slice(1));
}

/** One page of an open work item (its text blocks), which then counts as read. */
export function readWorkPage(workId: string, page: number): { ok: true; blocks: string[]; pages: number } | { ok: false; error: string } {
	recordCheckIn({ working: true });
	const item = openItem(workId);
	if (!item) return { ok: false, error: noItem(workId) };
	const pages = item.pages ?? [];
	if (page < 1 || page > pages.length) return { ok: false, error: `Work item "${workId}" has page(s) 1 to ${pages.length}.` };
	item.unread?.delete(page);
	return { ok: true, blocks: pages[page - 1]!, pages: pages.length };
}

function noItem(workId: string): string {
	return `No open work item "${workId}" — it was already answered or the request was cancelled. Call wait_for_work for the current one.`;
}

/** End a respondToWork hold (the answering agent stopped waiting). */
export function releaseConversation(conversation: string): void {
	if (state().held.delete(conversation)) wake();
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
	provider: OUTSIDE_AGENT_PROVIDER,
	models: [{ id: OUTSIDE_AGENT_MODEL_ID, name: AGENT_MODEL_NAME, reasoning: false, input: ["text", "image"], contextWindow: OUTSIDE_AGENT_CONTEXT_WINDOW, maxTokens: 32_000 }],
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
			if (state().items.delete(id)) emit("agent-changed", {});
			if (!conversation.startsWith(CHAT_ID_PREFIX)) emit("activity-changed", {});
			resolve(fauxAssistantMessage(""));
		};
		if (signal?.aborted) return onAbort();
		signal?.addEventListener("abort", onAbort, { once: true });
		const item: WorkItem = {
			id,
			conversation,
			createdAt: Date.now(),
			context,
			claims: 0,
			resolve: (message) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(message);
			},
		};
		state().items.set(id, item);
		if (sessionId !== undefined && isBackground(item)) state().backgroundRuns.add(conversation);
		emit("agent-changed", {});
		if (isBackground(item)) emit("activity-changed", {});
		wake();
	});
}

/** The stream function the "agent" provider's engine uses. */
export const agentStream: StreamFunction<Api> = (model, context, options) => {
	core.appendResponses([(ctx, opts) => awaitAgent(ctx, opts?.sessionId, opts?.signal)]);
	// The faux prompt cache only makes up cache numbers, and it keeps every
	// session's whole prompt in memory until the app quits.
	return core.streamSimple(model as Model<string>, context, { ...options, cacheRetention: "none" });
};
