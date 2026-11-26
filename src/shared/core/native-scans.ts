/**
 * Reading the native record: which questions wait, which a side question or a learner message
 * interrupted, and whether the record owes a continuation. Pure folds over LhMessage[].
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { isQuestionTool } from "./pending.ts";
import { TOPIC_DONE_TOOL } from "./contracts/chat.ts";
import { PRACTICE_PROBLEM_TOOL, VISUAL_TOOL, type LhMessage } from "./native-messages.ts";
import { problemPieceOf } from "./problem-piece.ts";

function isSideQuestion(m: LhMessage): boolean {
	return m.role === "user" && m.side === true;
}

function isPlainLearnerMessage(m: LhMessage): boolean {
	return m.role === "user" && m.side !== true;
}

/** Question calls a plain learner message came after before any answer:
 *  the model got the interrupted result, so they no longer wait. */
export function interruptedQuestions(messages: readonly LhMessage[]): Set<string> {
	const waiting = new Set<string>();
	const out = new Set<string>();
	for (const m of messages) {
		if (m.role === "assistant") {
			for (const block of m.content) if (block.type === "toolCall" && isQuestionTool(block.name)) waiting.add(block.id);
		} else if (m.role === "toolResult") {
			waiting.delete(m.toolCallId);
		} else if (isPlainLearnerMessage(m)) {
			for (const id of waiting) out.add(id);
			waiting.clear();
		}
	}
	return out;
}

/** A compaction marker or a UI-only marker (a plan block, a problem
 *  dismissal, Keep going, an answer to a question from earlier):
 *  bookkeeping that lands between a question and the next learner message
 *  without being part of either. */
function isBookkeeping(m: LhMessage): boolean {
	return m.role === "custom" && ["compaction", "plan-block", "problem-dismissed", "keep-going", "review", "keep-check", "analogy-drop", "phrase-drop"].includes(m.customType);
}

/** A hidden note for the agent that rides right ahead of the learner's
 *  message it came with: the [Today] note or an app note. */
function ridesAhead(m: LhMessage): boolean {
	return m.role === "custom" && (m.customType === "today-context" || m.customType === "app-note");
}

/** The index of the side question right after the assistant message at `i`
 *  (past its tool results, bookkeeping and the notes riding ahead of it),
 *  or -1. */
function sideQuestionAfter(messages: readonly LhMessage[], i: number): number {
	for (let j = i + 1; j < messages.length; j++) {
		const m = messages[j]!;
		if (m.role === "toolResult" || isBookkeeping(m) || ridesAhead(m)) continue;
		return isSideQuestion(m) ? j : -1;
	}
	return -1;
}

/** The question calls a side question was asked around: call id → the
 *  index of the message that asked it and of that side question. Their
 *  result, if any, comes after the side question. */
export function sideHeldQuestions(messages: readonly LhMessage[]): Map<string, { callAt: number; sideAt: number }> {
	const answeredAt = new Map<string, number>();
	messages.forEach((m, j) => {
		if (m.role === "toolResult") answeredAt.set(m.toolCallId, j);
	});
	const held = new Map<string, { callAt: number; sideAt: number }>();
	messages.forEach((m, j) => {
		if (m.role !== "assistant") return;
		const side = sideQuestionAfter(messages, j);
		if (side < 0) return;
		for (const block of m.content) {
			if (block.type !== "toolCall" || !isQuestionTool(block.name)) continue;
			if ((answeredAt.get(block.id) ?? side) >= side) held.set(block.id, { callAt: j, sideAt: side });
		}
	});
	return held;
}

// ─── the one model-facing seam (the agent's convertToLlm) ────────────────────

/** The ids of every toolResult in the tail (for the dangling-call scan). */
function resultIdsFrom(messages: readonly AgentMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role === "toolResult") {
			ids.add((m as ToolResultMessage).toolCallId);
		}
	}
	return ids;
}

// ─── native scans ────────────────────────────────────────────────────────────

/** The pending-question gate (findPendingToolCall's native twin): the
 *  NEWEST assistant message's FIRST question-tool call with no result in
 *  the tail — one question at a time, the dock's subject. A reply to a
 *  side question passes the look on to the messages before that side
 *  question, so the question it was asked around stays open. A plain
 *  learner message closes it: the model gets the interrupted result. */
export function danglingQuestionOf(
	messages: readonly LhMessage[],
): { toolCallId: string; tool: string; input: unknown } | null {
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		if (isPlainLearnerMessage(m)) return null;
		if (m.role !== "assistant") continue;
		const answered = resultIdsFrom(messages.slice(mi + 1));
		for (const block of m.content) {
			if (block.type !== "toolCall") continue;
			if (!isQuestionTool(block.name)) continue;
			if (answered.has(block.id)) continue;
			return { toolCallId: block.id, tool: block.name, input: block.arguments };
		}
		if (!repliesToSideQuestion(messages, mi)) return null; // its questions are all answered
	}
	return null;
}

/** Is the assistant message at `i` part of a reply to a side question
 *  (only reply steps and bookkeeping lie between it and that question)? */
function repliesToSideQuestion(messages: readonly LhMessage[], i: number): boolean {
	for (let j = i - 1; j >= 0; j--) {
		const m = messages[j]!;
		if (m.role === "assistant" || m.role === "toolResult" || isBookkeeping(m)) continue;
		return isSideQuestion(m);
	}
	return false;
}

/** Every toolResult id in the record — answer-event validation (the call
 *  must be a DANGLING question call, not an already-answered one). */
export function answeredCallIds(messages: readonly LhMessage[]): Set<string> {
	return resultIdsFrom(messages);
}

// ─── the continuation fold ───────────────────────────────────────────────────

/**
 * Does the record END on un-consumed tool results — a turn that stopped
 * after its tools ran (a job dispatch's ack, an aborted answer turn),
 * leaving the agent owing a continuation? This is the mount/sync
 * continuation seam's gate (chat.tsx): when true and nothing runs, the
 * client sends {type:"continue"} and the teacher picks up from the record.
 *
 * The fold: the last message is a toolResult, and the results' OWNING
 * assistant message has at least one call, ALL of them answered (a
 * dangling question — the dock's domain — fails the all-answered rule and
 * never fires a turn).
 */
export function needsContinuation(record: readonly LhMessage[]): boolean {
	// Compaction and UI-only markers (a Keep going or an answer to a
	// question from earlier written mid-turn) are not part of the turn, so
	// the fold reads past them.
	const messages = record.filter((m) => !isBookkeeping(m));
	const last = messages[messages.length - 1];
	if (!last || (last as { role?: string }).role !== "toolResult") return false;
	// A plot sent with no guess ended its turn on purpose (terminate:true), like a
	// problem pose: it stays up while his open question waits.
	const tail = last as ToolResultMessage;
	if (tail.toolName === "plot" && !tail.isError && (tail.details as { onPlot?: unknown } | undefined)?.onPlot === undefined) return false;
	// The trailing results batch (contiguous by construction — the agent
	// appends its batch; the question gate keeps a quiz call and its
	// learner answer adjacent).
	let start = messages.length - 1;
	while (
		start > 0 &&
		(messages[start - 1] as { role?: string } | undefined)?.role === "toolResult"
	) {
		start--;
	}
	// An answer given after side questions: its call sits before them.
	const ownerAt = sideHeldQuestions(messages).get((last as ToolResultMessage).toolCallId)?.callAt ?? start - 1;
	const owner = messages[ownerAt];
	if (!owner || (owner as { role?: string }).role !== "assistant") return false;
	const content = (owner as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	const results = messages.slice(start) as ToolResultMessage[];
	// A batch acking a problem POSE (bare, or carrying the piece it is printed as) or a stored topic_done owes nothing:
	// terminate:true ended that turn DELIBERATELY (the learner's next input
	// is the next turn), and unlike a question's placeholder the result
	// PERSISTS. Without this fold a reload would wake a phantom turn.
	// A drawn figure that is all the batch held owes nothing either: the agent ended its turn after it.
	if (results.every((m) => m.toolName === VISUAL_TOOL && !m.isError && typeof (m.details as { svg?: unknown } | null)?.svg === "string")) return false;
	const endedTurn = results.some(
		(m) => !m.isError && ((m.toolName === PRACTICE_PROBLEM_TOOL && (m.details == null || problemPieceOf(m.details) !== null)) || m.toolName === TOPIC_DONE_TOOL),
	);
	if (endedTurn) return false;
	const answered = resultIdsFrom(messages.slice(ownerAt + 1));
	const calls = (content as Array<{ type?: string; id?: string }>).filter(
		(b) => b.type === "toolCall" && typeof b.id === "string",
	);
	return calls.length > 0 && calls.every((b) => answered.has(b.id!));
}
