/**
 * COMPACTION, the frontend's share: the threshold the size meter reads and
 * the marker helpers the transcript uses. The Rust server shortens the
 * record (crates/core/src/session/compaction.rs); the cutoff rule here is
 * kept for tests/shared/compaction-native-parity.test.ts. See
 * docs/compaction-accounting.md.
 *
 * A compaction marker (LhMarkerMessage, customType "compaction") carries a
 * summary plus the cut (firstKeptMessageId): the model sees the summary,
 * then every message from the cut onward. Full history stays in the record.
 */

import { COMPACTED_HISTORY_HEADER } from "./contracts/chat.ts";
import type { LhMessage, LhMarkerMessage } from "./native-messages.ts";
import { newMessageId } from "./message-id.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SystemMessage } from "@earendil-works/pi-ai";

// ─── constants (the tunables) ────────────────────────────────────────────────

/** Kept-recent tail budget (pi's default):
 * ~20k tokens of verbatim recent transcript always ride after the
 * summary — recency is cheap insurance against summary loss. */
export const KEEP_RECENT_TOKENS = 20_000;

/** The reserve subtracted from the model's contextWindow when the window
 * (not the user's threshold) is the binding constraint (pi's default). */
const COMPACTION_RESERVE_TOKENS = 16_384;

/** The lesson size where a lesson gets summarized, before the window cap:
 *  the outside agent compacts its own context, and after that the app
 *  sends a lesson again in full, so a lesson must stay small. */
const SUMMARIZE_TOKENS = 40_000;

/** The point a lesson gets summarized: min(40k, window − reserve).
 *  Unknown window → 40k. */
export function effectiveThresholdTokens(contextWindowTokens: number | undefined): number {
	if (contextWindowTokens === undefined) return SUMMARIZE_TOKENS;
	return Math.min(SUMMARIZE_TOKENS, Math.max(contextWindowTokens - COMPACTION_RESERVE_TOKENS, 1));
}

// ─── token estimate (chars/4) ─────────────────────────────────────────────────

/** Pi 1.4.0's heuristic: text + thinking + toolCall name/args for
 * assistants, content text plus a fixed image allowance for other roles. NEVER JSON.stringify of the
 * whole message — record scaffolding (ids, usage, responseId, app-side
 * details, escaped quotes/backslashes) inflates ~3x (once measured at 84k
 * estimated vs ~30k real). */
export function estimateMessageTokens(message: LhMessage | AgentMessage): number {
	const content: unknown = (message as { content?: unknown }).content;
	let chars = 0;
	if ((message as { role?: string }).role === "assistant") {
		for (const block of (Array.isArray(content) ? content : []) as Array<{
			type: string;
			text?: string;
			thinking?: string;
			name?: string;
			arguments?: unknown;
		}>) {
			if (block.type === "text") chars += block.text?.length ?? 0;
			else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
			else if (block.type === "toolCall") chars += (block.name?.length ?? 0) + JSON.stringify(block.arguments ?? {}).length;
		}
	} else {
		chars += textCharsOfContent(content) + textCharsOfContent((message as { attachments?: unknown }).attachments);
		if (message.role === "system") {
			const system = message as SystemMessage;
			for (const section of Object.values(system.sections ?? {})) chars += section?.length ?? 0;
			if (system.toolsAdded) chars += JSON.stringify(system.toolsAdded).length;
		}
	}
	return Math.ceil(chars / 4);
}

// Pi coding-agent 1.4.0 estimateTokens: fixed image allowance, NOT a
// measurement of encrypted reasoning or actual provider vision tokens.
const ESTIMATED_IMAGE_CHARS = 4_800;
function textCharsOfContent(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content as Array<string | { type?: string; text?: string }>) {
		if (typeof block === "string") chars += block.length;
		else if (block?.type === "image") chars += ESTIMATED_IMAGE_CHARS;
		else if (block?.type === "text") chars += block.text?.length ?? 0;
	}
	return chars;
}

// ─── the cut walk ────────────────────────────────────────────────────────────

/** Model-visible entry adapter for the local Pi 1.4.0 cutoff port.
 * Compaction entries are boundaries, not ordinary cut candidates; UI-only
 * markers have no context, just like native metadata entries. */
function cutMessage(message: LhMessage): LhMessage | null {
	if (message.role !== "custom") return message;
	if (["compaction", "plan-block", "problem-dismissed"].includes(message.customType)) return null;
	return message;
}

/** Local port of pi-coding-agent 1.4.0 findCutPoint (MIT).
 * Walk backwards to >= budget, then choose the nearest valid cut AT OR
 * AFTER that entry. If oversized trailing results exhaust the budget,
 * retain their preceding assistant call, not the entire session.
 * No encrypted-signature sizing and no exact retained-token guarantee.
 * Returns the first kept record index; a zero/no-progress cut drops nothing.
 * Keep this and estimateMessageTokens aligned deliberately when upgrading Pi.
 */
export function compactionCutIndex(messages: readonly LhMessage[], keepRecentTokens = KEEP_RECENT_TOKENS): number {
	const previous = activeCompactionOf(messages);
	const previousKept = previous ? keptIndexFor(messages, previous) : -1;
	const start = Math.max(0, previousKept);
	const points: number[] = [];
	for (let i = start; i < messages.length; i++) {
		const message = cutMessage(messages[i]!);
		if (message && (message.role === "user" || message.role === "assistant" || message.role === "custom")) points.push(i);
	}
	if (!points.length) return start;
	let cut = points[0]!;
	let accumulated = 0;
	for (let i = messages.length - 1; i >= start; i--) {
		const message = cutMessage(messages[i]!);
		const tokens = message ? estimateMessageTokens(message) : 0;
		if (tokens === 0) continue;
		accumulated += tokens;
		if (accumulated >= keepRecentTokens) {
			cut = points.find((candidate) => candidate >= i) ?? points.at(-1)!;
			break;
		}
	}
	// Native entries preserve adjacent non-context metadata, but never walk
	// backwards across a previous compaction entry.
	while (cut > start) {
		const before = messages[cut - 1]!;
		if ((before.role === "custom" && before.customType === "compaction") || cutMessage(before)) break;
		cut--;
	}
	return cut;
}

// ─── the marker ──────────────────────────────────────────────────────────────

/** The compaction marker's details (UI payload — never model-visible;
 * the model sees content, the header + summary). */
export interface CompactionDetails {
	/** Record id of the first KEPT message: the projection renders the
	 * summary, then everything from this message onward. */
	firstKeptMessageId: string;
	/** The estimated context tokens that triggered this compaction
	 * (provenance for the divider's tooltip/dialog). */
	tokensBefore: number;
	/** provider:id of the model that wrote the summary (the session's
	 * own model; provenance, never a routing input). */
	model?: string;
	/** ISO timestamp of the compaction moment. */
	at: string;
	/** godspeed's own shortening, waiting for the model's summary to replace it. */
	local?: boolean;
}

/** Build the compaction marker. Content is the FULL model-facing text
 * (header + summary — single-sourced header); the marker rides the
 * record at the compaction MOMENT (near the transcript end), while the
 * cut it names sits deep in history: the UI renders both places. */
export function newCompactionMarker(summary: string, details: CompactionDetails): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "compaction",
		content: `${COMPACTED_HISTORY_HEADER}\n\n${summary.trim()}`,
		display: true,
		details,
		timestamp: Date.now(),
	};
}

/** The ACTIVE compaction marker: the newest one in the record (chained
 * compactions — the last one rules; older markers fall inside the
 * dropped span and never render). */
export function activeCompactionOf(messages: readonly LhMessage[]): (LhMarkerMessage & { details: CompactionDetails }) | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if ((m as { role?: string }).role !== "custom") continue;
		const marker = m as LhMarkerMessage;
		if (marker.customType === "compaction") {
			const details = marker.details as Partial<CompactionDetails>;
			if (typeof details.firstKeptMessageId === "string") {
				return marker as LhMarkerMessage & { details: CompactionDetails };
			}
		}
	}
	return null;
}

/** The index of the first KEPT message, or -1 when the record's active
 * marker names an id that no longer exists (corrupt/foreign) — callers
 * fall back to rendering everything (honest degradation, never throw). */
export function keptIndexFor(messages: readonly LhMessage[], marker: LhMarkerMessage & { details: CompactionDetails }): number {
	const id = marker.details.firstKeptMessageId;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]!.id === id) return i;
	}
	return -1;
}
