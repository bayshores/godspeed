/**
 * The chat-turn services — one named seam per turn
 * responsibility, extracted from the chat-handler so it composes instead of
 * implementing. Each takes its dependencies explicitly (storage ports, the
 * job runner) — no module here imports an adapter.
 *
 *   persistTurn        — the canonical state write (native history;
 *                        id stamping, placeholder filtering, plan-block
 *                        emission, abort-partial persistence)
 *   triggerExtraction  — the graph write channel: fires the extraction
 *                        pipeline (the sole graph writer) once a chat
 *                        crosses the token-budget threshold.
 *
 * Logs are the minimal-observability baseline: one line per failure, tagged
 * [chat <id>].
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { LhMessage } from "../core/native-messages.ts";
import { newMessageId } from "../core/message-id.ts";
import { isQuestionTool } from "../core/pending.ts";
import { planBlocksFor } from "../core/plan-blocks.ts";
import { coverageOf } from "../core/coverage.ts";
import type { ChatStore, GraphStore } from "../core/ports.ts";
import type { ExtractionPipeline } from "../agent/subagents/extraction.ts";
import { runs } from "../agent/subagents/extraction-runs.ts";
import { isTurnRunning } from "./turn-liveness.ts";

/** Distinguish a failed canonical save from later bookkeeping failures. */
export class TurnPersistenceError extends Error {
	constructor(cause: unknown) {
		super("The reply could not be saved.", { cause });
		this.name = "TurnPersistenceError";
	}
}

/**
 * The canonical state write: append the
 * turn's own messages — the agent loop's native history, provider/model/
 * usage/thinkingSignature stamped by pi itself. Persists even when aborted
 * — the partial transcript (including a pending question's unanswered
 * call) is what makes resume work.
 *
 * - Id stamping: pi messages carry no id; the record's identity needs one
 *   per message (client keys, append-only adoption, the continuation
 *   seam). Minted here, at the single canonical write.
 * - Placeholder filtering: a cleanly-posed question's synthetic
 *   "question posed" result is an in-memory loop device that ends the
 *   run — NEVER persisted (the record ends at the unanswered call; the
 *   learner's answer arrives as the real tool result). Errored question calls DO persist — the model's retry
 *   context.
 * - Plan blocks: one frozen snapshot per successful plan_init call,
 *   idempotent (persist replays are safe).
 *
 * Returns the stamped new messages (usage provenance reads them). Throws
 * TurnPersistenceError on failure so the runner can report it before DONE.
 */
export function persistTurn(
	chatStore: ChatStore,
	chatId: string,
	baseCount: number,
	turnMessages: readonly AgentMessage[],
): LhMessage[] {
	try {
		const record = chatStore.getChat(chatId);
		if (!record) throw new Error(`Chat not found: ${chatId}`);
		const stamped: LhMessage[] = [];
		for (const m of turnMessages.slice(baseCount)) {
			const message = m as LhMessage;
			// The placeholder question result: loop device, never a record fact.
			if (
				(message as { role?: string }).role === "toolResult" &&
				isQuestionTool((message as ToolResultMessage).toolName) &&
				!(message as ToolResultMessage).isError
			) {
				continue;
			}
			stamped.push(message.id ? message : ({ ...message, id: newMessageId() } as LhMessage));
		}
		const tree = record.tree;
		const blocks = planBlocksFor(record.messages, stamped, tree, [
			...record.messages,
			...stamped,
		]);
		chatStore.saveMessages(chatId, [...record.messages, ...stamped, ...blocks]);
		return stamped;
	} catch (err) {
		console.error(`[chat ${chatId}] persist failed:`, err);
		throw new TurnPersistenceError(err);
	}
}

/**
 * The graph write channel (vision §1 construction): the extraction pipeline
 * (extractor → merger — the sole graph writer) runs ASYNC once a
 * chat's UNCOVERED transcript tokens reach the chunk budget (less than
 * that waits for the lesson to sit idle). Coverage reads
 * through the projection of the native record. Fire-and-forget — never blocks the turn;
 * failures are logged by the pipeline and leave coverage untouched, so the
 * next trigger (or the manual extract button) re-runs what's left.
 *
 * Deliberately isolated in this one seam — the pipeline is
 * trigger-agnostic. Skipped under tests: scripted chats are fixtures, not
 * knowledge (the pipeline itself is tested directly with mock models).
 */
export function triggerExtraction(
	deps: LeftoverDeps,
	extraction: ExtractionPipeline,
	chatId: string,
	chunkTokens: number,
): void {
	if (process.env.NODE_ENV === "test") return;
	try {
		const uncovered = uncoveredTokens(deps, chatId);
		if (uncovered >= chunkTokens && !runs().inFlight.has(chatId)) return runExtraction(extraction, chatId);
		// Less than a chunk, or a run already going (it would ignore this
		// request): extract it once the lesson sits idle, so a short
		// lesson's answers still count. A newer turn resets the wait.
		if (uncovered > 0) extractWhenIdle(deps, extraction, chatId, LEFTOVER_IDLE_MS);
	} catch (err) {
		console.error(`[chat ${chatId}] extraction trigger failed:`, err);
	}
}

interface LeftoverDeps {
	chatStore: ChatStore;
	graphStore: GraphStore;
	/** Read when the wait ends: the knowledge graph may be switched off by then. */
	graphOn: () => boolean;
}

/** Extract what the lesson has left after `delayMs`, unless a newer call
 *  resets the wait. A turn or an extraction still going pushes it back
 *  (a run already going would ignore the request). */
export function extractWhenIdle(
	deps: LeftoverDeps,
	extraction: ExtractionPipeline,
	chatId: string,
	delayMs: number,
): void {
	const timers = leftoverTimers();
	clearTimeout(timers.get(chatId));
	const timer = setTimeout(() => {
		timers.delete(chatId);
		try {
			if (!deps.graphOn()) return;
			if (isTurnRunning(chatId) || runs().inFlight.has(chatId)) return extractWhenIdle(deps, extraction, chatId, LEFTOVER_IDLE_MS);
			if (uncoveredTokens(deps, chatId) > 0) runExtraction(extraction, chatId);
		} catch (err) {
			console.error(`[chat ${chatId}] leftover extraction failed:`, err);
		}
	}, delayMs);
	timer.unref?.();
	timers.set(chatId, timer);
}

function uncoveredTokens(deps: { chatStore: ChatStore; graphStore: GraphStore }, chatId: string): number {
	const record = deps.chatStore.getChat(chatId);
	return record ? coverageOf(record.messages, deps.graphStore.readCoverage(), chatId).uncoveredTokens : 0;
}

function runExtraction(extraction: ExtractionPipeline, chatId: string): void {
	void extraction.runExtraction(chatId).catch((err) => {
		console.error(`[chat ${chatId}] extraction pipeline failed:`, err);
	});
}

/** How long a lesson sits idle before its last stretch (under a chunk) is extracted. */
export const LEFTOVER_IDLE_MS = 5 * 60_000;

function leftoverTimers(): Map<string, ReturnType<typeof setTimeout>> {
	const g = globalThis as typeof globalThis & { __lhLeftoverTimers?: Map<string, ReturnType<typeof setTimeout>> };
	return (g.__lhLeftoverTimers ??= new Map());
}
