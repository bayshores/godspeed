/**
 * The compaction service: the trigger plumbing around core/compaction's
 * pure cuts and markers. A turn never waits on a summary:
 *
 *   - SHORTEN — past the threshold godspeed cuts the record and writes its
 *     own short version of what it dropped (localSummary), at once and
 *     without a model: at the turn-start gate and when a turn settles.
 *   - REFINE — once the chat has been quiet for REFINE_QUIET_MS, the
 *     session's own model writes the real summary through the zero-tool
 *     one-shot sub-agent seam, and it takes the local version's place.
 *     A turn that starts meanwhile goes ahead on the local version.
 *
 * Shortening only runs between turns (canStart), so it never touches a
 * live run. A run that dies on context length needs no special path: the
 * next turn's gate shortens and the fresh run starts small.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import {
	activeCompactionOf,
	buildCompactionPrompt,
	compactionCutIndex,
	compactionSpan,
	localSummary,
	estimateContextTokens,
	estimateTokens,
	newCompactionMarker,
	planTreeToText,
	serializeForSummary,
	toLlmMessages,
	type CompactionDetails,
	type LhMessage,
} from "../../shared/core/index.ts";
import { emit } from "../../shared/core/events.ts";
import type { ChatStore } from "../../shared/core/ports.ts";
import type { PiEngine } from "../agent/models.ts";
import { runSubagent } from "../agent/subagents/pi-run.ts";

/** The summarizer's system prompt — server-owned operational framing,
 *  not model-facing doctrine (buildCompactionPrompt carries the shape). */
const SUMMARIZER_SYSTEM_PROMPT =
	"You are the session-compaction summarizer for a tutoring agent. You receive the transcript span to summarize and write exactly the summary the instructions demand — nothing else, no preamble, no meta-commentary.";

/** The one-shot summary call: zero tools, one turn, text out. The engine
 *  is the chat's own conversation engine. Injectable for tests. */
type Summarizer = (prompt: string, engine: PiEngine) => Promise<{ summary: string; usage: Usage }>;

/** The production summarizer over the sub-agent seam. */
async function subagentSummarizer(prompt: string, engine: PiEngine): Promise<{ summary: string; usage: Usage }> {
	let usage: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const { text } = await runSubagent([], {
		prompt,
		engine,
		systemPrompt: SUMMARIZER_SYSTEM_PROMPT,
		maxTurns: 1,
		onUsage: (u) => {
			usage = u;
		},
	});
	return { summary: text, usage };
}

/** Everything the service needs from its host (chat-handler wires the
 *  production versions; tests inject). */
export interface CompactionDeps {
	/** False while another turn owns the chat: wait for a running compaction but start none. */
	canStart?: () => boolean;
	chatStore: ChatStore;
	/** The chat's conversation engine — also the summarizer's. */
	engine: PiEngine;
	/** provider:id of the engine (usage + marker provenance). */
	modelId: string;
	/** The session kind (summarizer wording: tutor vs practice). */
	kind: "teach" | "practice" | "probe" | "talk";
	/** The effective trigger threshold, RESOLVED by the caller:
	 *  min(settings threshold, contextWindow − reserve). The catalog window
	 *  lookup is the caller's (chat-handler has the model id at hand). */
	thresholdTokens: number;
	/** The composed system prompt's token estimate (chars/4) — the
	 *  projection the provider actually receives starts with it. */
	systemPromptTokens: number;
	/** Injectable summarizer (tests); default = the sub-agent one-shot. */
	summarize?: Summarizer;
}

// ─── the estimate over the ACTIVE projection ────────────────────────────────

/** The projected context estimate: what the next LLM call would carry.
 *  The trigger rule (pi's): anchor on the last
 *  assistant message's provider-reported usage — it already counted
 *  the system prompt, tool declarations, and the provider's own
 *  tokenizer — and chars/4-estimate ONLY messages appended after it.
 *  estimateContextTokens refuses anchors that predate a compaction
 *  marker (that usage described context the next request will NOT
 *  carry), so the fallback path runs the plain heuristic over the
 *  CUT-HONORED projection (never the dropped span) plus the additive
 *  prompt term the anchor would have covered. */
export function projectedContextTokens(messages: readonly LhMessage[], systemPromptTokens: number): number {
	const est = estimateContextTokens(messages);
	if (est.lastUsageIndex !== null) return est.tokens;
	return estimateTokens(toLlmMessages(messages as readonly AgentMessage[]) as unknown as readonly LhMessage[]) + systemPromptTokens;
}

// ─── shorten: at once, no model ─────────────────────────────────────────────

/** Cut the record and add godspeed's own short version of what was cut,
 *  when it projects over the threshold. Never while a turn owns the chat. */
function shorten(deps: CompactionDeps, chatId: string): void {
	if (deps.canStart?.() === false) return;
	const record = deps.chatStore.getChat(chatId);
	if (!record) return;
	const messages = record.messages;
	const tokensBefore = projectedContextTokens(messages, deps.systemPromptTokens);
	if (tokensBefore <= deps.thresholdTokens) return;
	const cut = compactionCutIndex(messages);
	if (cut <= 0 || cut >= messages.length) return; // no history can be dropped

	// The span runs from the previous kept boundary to the cut; the previous
	// summary rides along. When the cut can't move past that boundary, the
	// kept tail alone carries the projection, and shortening again can't help.
	const previous = activeCompactionOf(messages);
	const prevKept = previous ? messages.findIndex((m) => m.id === previous.details.firstKeptMessageId) : -1;
	if (previous && prevKept !== -1 && cut <= prevKept) {
		console.info(`[chat ${chatId}] compaction skipped — the kept tail alone exceeds the threshold (raise it or shrink the tail)`);
		return;
	}
	const summary = localSummary({
		span: messages.slice(prevKept > 0 ? prevKept : 0, cut),
		priorSummary: prevKept > 0 ? previous!.content : null,
		planTreeText: planTreeToText(record.tree, messages),
	});
	const details: CompactionDetails = { firstKeptMessageId: messages[cut]!.id, tokensBefore, at: new Date().toISOString(), local: true };
	deps.chatStore.saveMessages(chatId, [...messages, newCompactionMarker(summary, details)]);
	emit("record-changed", { chatId });
}

/** The turn-start gate: a turn starts on a record that fits. */
export function ensureCompacted(deps: CompactionDeps, chatId: string): void {
	shorten(deps, chatId);
}

/** The settle kick: shorten now if the turn pushed the lesson over, and
 *  (re)start the quiet wait for the real summary. */
export function kickCompaction(buildDeps: () => CompactionDeps | null, chatId: string): void {
	const deps = buildDeps();
	if (!deps) return;
	shorten(deps, chatId);
	refineWhenQuiet(buildDeps, chatId, REFINE_QUIET_MS);
}

// ─── refine: the model's summary, once the chat is quiet ────────────────────

/** How long a chat sits quiet before its model writes the real summary. */
const REFINE_QUIET_MS = 5 * 60_000;

const g = globalThis as typeof globalThis & { __lhRefine?: { timers: Map<string, ReturnType<typeof setTimeout>>; running: Set<string> } };
function refineState() {
	return (g.__lhRefine ??= { timers: new Map(), running: new Set() });
}

/** Refine after `delayMs`; a later call starts the wait again, and a turn
 *  running then pushes it back. */
function refineWhenQuiet(buildDeps: () => CompactionDeps | null, chatId: string, delayMs: number): void {
	const { timers } = refineState();
	clearTimeout(timers.get(chatId));
	const timer = setTimeout(() => {
		timers.delete(chatId);
		const deps = buildDeps();
		if (!deps) return;
		if (deps.canStart?.() === false) return refineWhenQuiet(buildDeps, chatId, REFINE_QUIET_MS);
		void refine(deps, chatId);
	}, delayMs);
	timer.unref?.();
	timers.set(chatId, timer);
}

/** Replace the chat's local shortening with the model's summary of the same
 *  messages. Keeps the record as it is when the summary fails or comes back
 *  empty, or when a newer marker took over meanwhile. */
export async function refine(deps: CompactionDeps, chatId: string): Promise<void> {
	const { running } = refineState();
	const record = deps.chatStore.getChat(chatId);
	const marker = record ? activeCompactionOf(record.messages) : null;
	if (!record || !marker?.details.local || running.has(chatId)) return;
	const covered = compactionSpan(record.messages, marker);
	if (!covered) return;
	const spanText = serializeForSummary(covered.span);
	const prompt = buildCompactionPrompt({
		spanText: covered.priorSummary ? `[SYSTEM NOTE — prior compaction summary, still authoritative where not superseded]\n${covered.priorSummary}\n\n${spanText}` : spanText,
		planTreeText: planTreeToText(record.tree, record.messages),
		kind: deps.kind,
	});
	running.add(chatId);
	try {
		const { summary, usage } = await (deps.summarize ?? subagentSummarizer)(prompt, deps.engine);
		const text = summary.trim();
		if (!text) return; // an empty summary is a refusal artifact
		// Re-read: turns and other writers save while the summary is written.
		const fresh = deps.chatStore.getChat(chatId);
		if (!fresh || activeCompactionOf(fresh.messages)?.id !== marker.id) return;
		const details: CompactionDetails = { ...marker.details, model: deps.modelId, local: false };
		const refined = { ...newCompactionMarker(text, details), id: marker.id, timestamp: marker.timestamp };
		deps.chatStore.saveMessages(chatId, fresh.messages.map((m) => (m.id === marker.id ? refined : m)));
		// A real model call on the session's own engine: usage keys to the marker.
		deps.chatStore.appendTurnUsage(chatId, {
			id: crypto.randomUUID(),
			messageId: marker.id,
			at: new Date().toISOString(),
			model: deps.modelId,
			steps: [
				{
					inputTokens: usage.input,
					outputTokens: usage.output,
					cacheReadTokens: usage.cacheRead,
					cacheWriteTokens: usage.cacheWrite,
					cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
					reasoningTokens: usage.reasoning ?? 0,
				},
			],
		});
		emit("record-changed", { chatId });
	} catch (err) {
		// The local version stays; the next quiet stretch tries again.
		console.error(`[chat ${chatId}] the lesson summary failed:`, err);
	} finally {
		running.delete(chatId);
	}
}
