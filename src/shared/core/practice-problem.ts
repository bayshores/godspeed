/**
 * The practice problem folds over the native record: the problem a conclusion closes, and the
 * problem still open.
 */

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL, type LhMarkerMessage, type LhMessage } from "./native-messages.ts";

/** The ids of tool calls whose results are CLEAN (not errored) — the only
 *  calls that ever happened (HONEST ACTIVATION, see activeProblemOf). */
function cleanToolCallIds(messages: readonly LhMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const result = m as ToolResultMessage;
		if (!result.isError) ids.add(result.toolCallId);
	}
	return ids;
}

/** The problem call a conclusion closes, for the conclude card's reveal
 * (its committed solution). A pose the record never acked (a refused
 * call) folds nothing. */
export function problemInputForConclude(
	messages: readonly LhMessage[],
	concludeCallId: string,
): { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown } | undefined {
	let mi = messages.findIndex(
		(m) =>
			(m as { role?: string }).role === "assistant" &&
			(m as AssistantMessage).content.some(
				(b) => b.type === "toolCall" && b.id === concludeCallId,
			),
	);
	if (mi < 0) return undefined;
	const clean = cleanToolCallIds(messages);
	for (; mi >= 0; mi--) {
		const m = messages[mi]!;
		if ((m as { role?: string }).role !== "assistant") continue;
		const assistant = m as AssistantMessage;
		for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
			const block = assistant.content[bi]!;
			if (block.type !== "toolCall" || block.name !== PRACTICE_PROBLEM_TOOL) continue;
			if (!clean.has(block.id)) continue; // a refused pose revealed nothing
			return (block.arguments ?? undefined) as
				| { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown }
				| undefined;
		}
	}
	return undefined;
}

/** The active-problem fold (the conclude-before-next-problem gate): the
 *  NEWEST problem tool call with nothing concluding after it — either a
 *  conclude call or a dismissal marker deactivates. The ack result at pose
 *  time does NOT (the problem stays on screen through nudges; the
 *  panel's subject is the call, not a dangling result). */
export function activeProblemOf(
	messages: readonly LhMessage[],
): { toolCallId: string; input: unknown } | null {
	// HONEST ACTIVATION:
	// calls count only through their RESULTS — a problem activates on its
	// clean ack, a conclude frees on its clean ack; errored and dangling
	// calls are skipped ("either it goes through or it doesn't").
	const cleanCallIds = cleanToolCallIds(messages);
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as LhMarkerMessage;
			if (marker.customType === "problem-dismissed") return null;
			continue;
		}
		if (role === "assistant") {
			const assistant = m as AssistantMessage & { id: string };
			for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
				const block = assistant.content[bi]!;
				if (block.type !== "toolCall") continue;
				if (block.name === PRACTICE_CONCLUDE_TOOL) {
					if (cleanCallIds.has(block.id)) return null; // a CLEAN conclude frees
					continue; // errored/dangling conclude: the free never happened
				}
				if (block.name !== PRACTICE_PROBLEM_TOOL) continue;
				if (cleanCallIds.has(block.id)) return { toolCallId: block.id, input: block.arguments };
				// errored/dangling pose — it did not go through; keep scanning
			}
			continue;
		}
	}
	return null;
}
