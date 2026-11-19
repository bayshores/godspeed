/**
 * THE NATIVE MESSAGE RECORD: chat records store pi's own message shapes —
 * the exact history the agent loop builds. Provider, model, usage,
 * stopReason, and thinking signatures are stamped by pi itself; replay is
 * `state.messages = record.messages` + `continue()` — the record IS the
 * agent state.
 *
 * WHY pi MESSAGES LACK OUR `id`: pi's session format gives every ENTRY an
 * id, never the message. This app needs a per-message id for client
 * identity (React keys, append-only adoption, the continuation seam), so
 * every record message carries ONE extra field — `id` — alongside the
 * native shape. The Rust server strips it before the provider sees it.
 *
 * UI-ONLY CONTENT: the probe→teach handoff, sub-agent steers,
 * and plan blocks are LhMarkerMessage — shaped like pi's own
 * CustomMessage ({role:"custom", customType, content, display, details}).
 * The Rust server flattens markers to their canonical user text
 * (single-sourced in core/contracts) and filters the UI-only ones.
 *
 * Answers: the learner's answer IS the tool call's ToolResultMessage —
 * appended natively at answer time. The synthetic "question posed"
 * placeholder is an in-memory loop device (terminate) and is never
 * persisted: the record ends at the
 * unanswered call in the pose→answer window, where no turn can run (the
 * question gate holds steers; a POST would 409).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { isQuestionTool } from "./pending.ts";
import {
	TOPIC_DONE_TOOL,
	NEXT_PROBLEM_TEXT,
	openProblemText,
} from "./contracts/chat.ts";
import { compactAnswerForModel, type QuestionAnswerData } from "./question-core.ts";
import { newMessageId } from "./message-id.ts";
import type { AttachmentPart } from "./attachments.ts";

// ─── The record's message type ───────────────────────────────────────────────

/**
 * The app's custom message (declaration-merged into pi-agent-core's
 * CustomAgentMessages below). Shaped like pi's own CustomMessage —
 * `content` is the MODEL-facing text (single-sourced in core/contracts,
 * never fake human speech), `details` is the UI payload (never
 * model-visible), `display` marks messages the UI renders (our projection
 * keys rendering on customType; the flag documents intent).
 */
export interface LhMarkerMessage {
	/** Record identity (pi messages carry no id — see the file header). */
	id: string;
	role: "custom";
	customType:
		| "graph-context"
		| "space-context"
		| "study-context"
		| "homework-context"
		| "today-context"
		| "probe-handoff"
		| "subagent-steer"
		| "subagent-abort"
		| "plan-block"
		| "practice-thinking"
		| "practice-next"
		| "teach-me"
		| "problem-dismissed"
		| "compaction"
		| "keep-going"
		| "opener-answer"
		| "app-note"
		| "review"
		| "keep-check"
		| "analogy-drop"
		| "phrase-drop";
	/** The model-facing text ("" for plan blocks — UI-only). */
	content: string;
	/** Model-facing files after the text: the pictures and PDF notes of an
	 *  older lesson's thinking submission. */
	attachments?: AttachmentPart[];
	display: boolean;
	/** The UI payload — per-customType, never model-visible. */
	details: unknown;
	timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		lhMarker: LhMarkerMessage;
	}
}

/** A record message: a native pi message (or our marker) plus the record id.
 *  A user message asked while a question waits carries `side` (stripped at
 *  the wire like `id`). */
export type LhMessage = ((UserMessage & { side?: true }) | AssistantMessage | ToolResultMessage | LhMarkerMessage) & { id: string };

// ─── explicit learner-facing output ─────────────────────────────────────────

export const SEND_TO_USER_TOOL = "send_to_user";

/** Read the output tool's message without changing the native call. Also
 * accepts partial arguments while streaming; malformed/empty inputs carry
 * no prose. This projection is independent of the currently selected model. */
export function sendToUserText(block: unknown): string | undefined {
	if (!block || typeof block !== "object") return undefined;
	const call = block as { type?: unknown; name?: unknown; arguments?: unknown };
	if (call.type !== "toolCall" || call.name !== SEND_TO_USER_TOOL) return undefined;
	if (!call.arguments || typeof call.arguments !== "object") return undefined;
	const message = (call.arguments as { message?: unknown }).message;
	return typeof message === "string" && message.trim() ? message : undefined;
}

// ─── constructors (the input-event → native append mapping lives in
//     core/input-events.ts; steers in core/contracts/jobs.ts) ─────────────────

/** A learner-authored user message (text input, verdict note). Files ride
 *  as content parts after the text; a message with files may have no text. */
export function newUserMessage(text: string, attachments: readonly AttachmentPart[] = []): LhMessage & UserMessage {
	return {
		id: newMessageId(),
		role: "user",
		content: attachments.length === 0 ? text : [...(text.trim() ? [{ type: "text" as const, text }] : []), ...attachments],
		timestamp: Date.now(),
	};
}

/** A side question: the learner asks the teacher something while a
 *  question waits, with files like any learner message. The question
 *  stays open around it (danglingQuestionOf). */
export function newSideQuestion(text: string, attachments: readonly AttachmentPart[] = []): LhMessage & UserMessage {
	return { ...newUserMessage(text, attachments), side: true };
}

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

/** The learner's answer — the question call's tool result.
 *  TWO AUDIENCES: the MODEL sees the
 *  compact learner-only record (compactAnswerForModel — the call's own
 *  arguments already carry the question/options/explanation/commitment;
 *  restating them would double every answer's tokens), while `details` keeps
 *  the FULL graded QuestionAnswerData for the record and the UI. The
 *  answer's files follow the record as content parts. */
export function newAnswerResult(
	toolCallId: string,
	toolName: string,
	answer: unknown,
	attachments: readonly AttachmentPart[] = [],
): LhMessage & ToolResultMessage {
	return {
		id: newMessageId(),
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: JSON.stringify(compactAnswerForModel(answer as QuestionAnswerData)) }, ...attachments],
		// ToolResultMessage.details is JsonRepresentation —
		// our payloads are JSON-safe answer structures, so the cast is honest.
		details: answer as ToolResultMessage["details"],
		isError: false,
		timestamp: Date.now(),
	};
}

// ─── practice sessions ───────────────────────────────────────────────────────

/** The practice agent's two tools (the conclude-before-next-problem gate's
 *  vocabulary — the tool-execute layer owns the tools themselves). */
export const PRACTICE_PROBLEM_TOOL = "problem";
export const PRACTICE_CONCLUDE_TOOL = "conclude";

/** One picked proposition of the graph-context marker (the learner's map
 *  pick — name + statement as the learner SAW them at pick time). */
export interface GraphContextPick {
	id: string;
	name: string;
	statement: string;
}

// ─── spaces ─────────────────────────────────────────────────────────────────

/** The learner's explicit move-on signal: appended by
 *  the next input (the composer band's chip, or Enter on an empty
 *  composer during the between-problems pause). The content is the
 *  single-sourced NEXT_PROBLEM_TEXT — the model's unambiguous go-ahead;
 *  the transcript renders its own compact line off the marker (never
 *  the content). */
export function newNextMessage(): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-next",
		content: NEXT_PROBLEM_TEXT,
		display: true,
		details: {},
		timestamp: Date.now(),
	};
}

/** The learner's pick of a homework problem: a go-ahead naming the one to
 *  open. The transcript draws its own line off the marker. */
export function newOpenProblemMessage(number: string): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-next",
		content: openProblemText(number),
		display: true,
		details: { number },
		timestamp: Date.now(),
	};
}

/** The problem-dismissal marker (ask-style discard): UI-ONLY. The server
 *  gives the model a synthesized conclude call with outcome "dismissed"
 *  at the learner's next input. */
export function newProblemDismissedMarker(problemCallId: string): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "problem-dismissed",
		content: "",
		display: true,
		details: { problemCallId },
		timestamp: Date.now(),
	};
}

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
	// A batch acking a problem POSE or a stored topic_done owes nothing:
	// terminate:true ended that turn DELIBERATELY (the learner's next input
	// is the next turn), and unlike a question's placeholder the result
	// PERSISTS. Without this fold a reload would wake a phantom turn.
	const endedTurn = results.some(
		(m) => !m.isError && ((m.toolName === PRACTICE_PROBLEM_TOOL && m.details == null) || m.toolName === TOPIC_DONE_TOOL),
	);
	if (endedTurn) return false;
	const answered = resultIdsFrom(messages.slice(ownerAt + 1));
	const calls = (content as Array<{ type?: string; id?: string }>).filter(
		(b) => b.type === "toolCall" && typeof b.id === "string",
	);
	return calls.length > 0 && calls.every((b) => answered.has(b.id!));
}
