/**
 * The practice problem folds over the native record: the problem a conclusion closes, and the
 * problem still open.
 */

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { healEncodedArguments } from "./argument-heal.ts";
import { isRecord } from "./is-record.ts";
import { PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL, type LhMarkerMessage, type LhMessage } from "./native-messages.ts";

/** The tool calls whose results are CLEAN (not errored) — the only calls that
 *  ever happened (HONEST ACTIVATION, see activeProblemOf) — with each result's details. */
function cleanToolCalls(messages: readonly LhMessage[]): Map<string, unknown> {
	const calls = new Map<string, unknown>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const result = m as ToolResultMessage;
		if (!result.isError) calls.set(result.toolCallId, result.details);
	}
	return calls;
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
	const clean = cleanToolCalls(messages);
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
 *  panel's subject is the call, not a dangling result). `details` is the
 *  ack's, where a problem printed in a file carries its piece. */
export function activeProblemOf(
	messages: readonly LhMessage[],
): { toolCallId: string; input: unknown; details: unknown } | null {
	// HONEST ACTIVATION:
	// calls count only through their RESULTS — a problem activates on its
	// clean ack, a conclude frees on its clean ack; errored and dangling
	// calls are skipped ("either it goes through or it doesn't").
	const clean = cleanToolCalls(messages);
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
					if (clean.has(block.id)) return null; // a CLEAN conclude frees
					continue; // errored/dangling conclude: the free never happened
				}
				if (block.name !== PRACTICE_PROBLEM_TOOL) continue;
				if (clean.has(block.id)) return { toolCallId: block.id, input: block.arguments, details: clean.get(block.id) };
				// errored/dangling pose — it did not go through; keep scanning
			}
			continue;
		}
	}
	return null;
}

/** The problem closed last, with none open since: by its conclusion, or by the learner
 *  discarding it. The same honest fold as activeProblemOf: only clean calls count. */
export function closedProblemOf(
	messages: readonly LhMessage[],
): { toolCallId: string; input: unknown; details: unknown; discarded: boolean } | null {
	const clean = cleanToolCalls(messages);
	let closed: "concluded" | "discarded" | null = null;
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			if ((m as LhMarkerMessage).customType === "problem-dismissed") closed ??= "discarded";
			continue;
		}
		if (role !== "assistant") continue;
		const assistant = m as AssistantMessage;
		for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
			const block = assistant.content[bi]!;
			if (block.type !== "toolCall" || !clean.has(block.id)) continue;
			if (block.name === PRACTICE_CONCLUDE_TOOL) closed ??= "concluded";
			else if (block.name === PRACTICE_PROBLEM_TOOL) {
				return closed ? { toolCallId: block.id, input: block.arguments, details: clean.get(block.id), discarded: closed === "discarded" } : null;
			}
		}
	}
	return null;
}

/** The choices a problem shows as tick rows. */
export interface ProblemChoices {
	labels: string[];
	/** Select all that apply. */
	multiSelect: boolean;
}

const CHOICE_FIELDS = { properties: { options: { type: "array" }, multiSelect: { type: "boolean" } } };

/** The choices a problem's pose carries, read as the display reads any model-authored input:
 *  a pose with none, or with options that are not all labelled, shows none. The server has
 *  already refused a pose with a wrong number of options. */
export function problemChoicesOf(input: unknown): ProblemChoices | null {
	const healed = healEncodedArguments(input, CHOICE_FIELDS);
	if (!isRecord(healed) || !Array.isArray(healed.options)) return null;
	const labels = healed.options.map((o) => (isRecord(o) && typeof o.label === "string" ? o.label.trim() : ""));
	if (labels.length === 0 || labels.some((label) => label === "")) return null;
	return { labels, multiSelect: healed.multiSelect === true };
}
