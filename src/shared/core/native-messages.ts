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

import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import {
	NEXT_PROBLEM_TEXT,
	openProblemText,
} from "./contracts/chat.ts";
import { compactAnswerForModel } from "./question-grading.ts";
import type { QuestionAnswerData } from "./question-data.ts";
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
