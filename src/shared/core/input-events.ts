/**
 * THE INPUT-EVENTS CONTRACT: POST /api/chat carries `{chatId, input}` —
 * ONE explicit event, never a client transcript. The server owns the
 * record; a send tells it what HAPPENED, not what the client's list looks
 * like. An input event retries safely: nothing was appended when a POST
 * is refused.
 *
 * The teach events (practice adds `next`, below):
 *   text    — a learner-authored user message (composer send, initial
 *             topic, the demo error-fix loop)
 *   answer  — the pending question's graded result (QuestionAnswerData,
 *             built client-side exactly as today; a dismissal is an answer
 *             carrying its flag), with files when the question takes them
 *             (answerTakesFiles). Server-side this becomes the call's
 *             native tool result.
 *   continue — run the next turn on the current record (mount
 *             continuations, job-settle re-syncs: the record ends at an
 *             answered question with no teacher reaction yet).
 *   side    — a side question: the learner asks the teacher something
 *             (text, files or both) while a question waits, which stays
 *             open around it. With a problem open, a message is plain
 *             text: the learner's work on it, or a question about it.
 *   opener-answer — the answer to the next topic's opener (a question
 *             topic_done stored, shown by the app after Keep going), or
 *             its skip.
 *
 * Server-originated delivery (the wake pipeline's steers) is NOT a client
 * input — the handler accepts it on the same path (TurnInput) so every
 * turn rides one composition.
 */

import type { QuestionAnswerData } from "./question-core.ts";
import type { LhMessage } from "./native-messages.ts";
import {
	activeProblemOf,
	concludedByDismissalPair,
	danglingQuestionOf,
	newAnswerResult,
	newNextMessage,
	newProblemDismissedMarker,
	newSideQuestion,
	newUserMessage,
	pendingProblemDismissalOf,
} from "./native-messages.ts";
import { answerTakesFiles, toolQuestionKind } from "./pending.ts";
import {
	attachmentRefusal,
	base64Bytes,
	MAX_ATTACHMENTS,
	TOO_MANY_REFUSAL,
	type AttachmentPart,
	type ChatAttachment,
} from "./attachments.ts";

/** One client-originated input event (the POST body's `input`). */
export type ChatInput =
	/** `about.opener`: Ask Teacher on a shown opener (its topic_done call
	 *  id); the opener stays open. */
	| { type: "text"; text: string; attachments?: ChatAttachment[]; about?: { opener: string } }
	| { type: "answer"; toolCallId: string; answer: QuestionAnswerData; attachments?: ChatAttachment[] }
	| { type: "continue" }
	| { type: "side"; text: string; attachments?: ChatAttachment[] }
	/** The practice move-on signal: the learner's
	 *  explicit go-ahead during the between-problems pause — the Next
	 *  chip or Enter on an empty composer. Practice sessions only, and
	 *  only with nothing active. */
	| { type: "next" }
	/** His answer to the next topic's opener, which has no tool call of
	 *  its own; null is Skip question. */
	| { type: "opener-answer"; topicDoneCallId: string; answer: QuestionAnswerData | null };

/** The dismissal event: NEVER composes a
 *  turn — the silent route appends + persists and wakes nothing. The
 *  answer rides the event (mirroring the answer event) but must actually
 *  BE a dismissal: the silent path must never inject a live answer
 *  wake-free. Parallel question calls each get their own dismiss event;
 *  results reference their calls by id, so the appends stay independent. */
type DismissInput =
	| { type: "dismiss"; toolCallId: string; answer: QuestionAnswerData }
	/** The problem discard (practice): ask-style — the
	 *  silent route appends the UI-only marker and wakes nothing; the
	 *  conclude pair rides the user's NEXT input (inputAppends). */
	| { type: "dismiss-problem"; problemCallId: string };

/** Parse and validate a dismissal event off a request body. */
export function parseDismissInput(input: unknown): DismissInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	if (i.type === "dismiss-problem") {
		if (typeof i.problemCallId !== "string" || i.problemCallId.length === 0) {
			throw new ChatInputError("dismiss-problem input requires problemCallId");
		}
		return { type: "dismiss-problem", problemCallId: i.problemCallId };
	}
	if (i.type !== "dismiss") throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	if (typeof i.toolCallId !== "string" || i.toolCallId.length === 0) {
		throw new ChatInputError("dismiss input requires toolCallId");
	}
	const answer = i.answer as QuestionAnswerData | undefined;
	if (typeof answer !== "object" || answer === null) {
		throw new ChatInputError("dismiss input requires the dismissal answer object");
	}
	if (answer.dismissed !== true) {
		throw new ChatInputError("dismiss input's answer must be a dismissal (dismissed: true)");
	}
	return { type: "dismiss", toolCallId: i.toolCallId, answer };
}

/** The native appends a dismissal makes (pure — same orphan discipline
 *  as answers: the call must be a DANGLING question call, or — the
 *  practice variant — the ACTIVE problem). */
export function dismissAppends(record: { messages: LhMessage[] }, input: DismissInput): LhMessage[] {
	if (input.type === "dismiss-problem") {
		const active = activeProblemOf(record.messages);
		if (!active || active.toolCallId !== input.problemCallId) {
			throw new ChatInputError("dismiss-problem input targets no active problem");
		}
		return [newProblemDismissedMarker(input.problemCallId)];
	}
	const pending = danglingQuestionOf(record.messages);
	if (!pending || pending.toolCallId !== input.toolCallId) {
		throw new ChatInputError("dismiss input targets no pending question call");
	}
	if (input.answer.kind !== toolQuestionKind(pending.tool)) {
		throw new ChatInputError("dismiss input's answer kind does not match the question");
	}
	return [newAnswerResult(input.toolCallId, pending.tool, input.answer)];
}

/** A malformed input event (the honest 400 — the orphan-trap discipline). */
export class ChatInputError extends Error {}

/** Parse and validate an input event off a request body. */
export function parseChatInput(input: unknown): ChatInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	switch (i.type) {
		case "text": {
			const attachments = parseAttachments(i.attachments);
			if (typeof i.text !== "string" || (i.text.trim().length === 0 && !attachments)) {
				throw new ChatInputError("text input requires non-empty text or attachments");
			}
			return { type: "text", text: i.text, ...(attachments ? { attachments } : {}) };
		}
		case "answer": {
			if (typeof i.toolCallId !== "string" || i.toolCallId.length === 0) {
				throw new ChatInputError("answer input requires toolCallId");
			}
			if (typeof i.answer !== "object" || i.answer === null) {
				throw new ChatInputError("answer input requires the graded answer object");
			}
			const attachments = parseAttachments(i.attachments);
			return { type: "answer", toolCallId: i.toolCallId, answer: i.answer as QuestionAnswerData, ...(attachments ? { attachments } : {}) };
		}
		case "continue":
			return { type: "continue" };
		case "side": {
			const attachments = parseAttachments(i.attachments);
			if (typeof i.text !== "string" || (i.text.trim().length === 0 && !attachments)) {
				throw new ChatInputError("side input requires non-empty text or attachments");
			}
			return { type: "side", text: i.text, ...(attachments ? { attachments } : {}) };
		}
		case "next":
			return { type: "next" };
		default:
			throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	}
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** An input's files: absent, or 1 to MAX_ATTACHMENTS well-formed files the
 *  composer would have accepted. Anything else is a 400. */
function parseAttachments(raw: unknown): ChatAttachment[] | undefined {
	if (raw === undefined) return undefined;
	if (!Array.isArray(raw) || raw.length === 0) throw new ChatInputError("attachments must be a non-empty list");
	if (raw.length > MAX_ATTACHMENTS) throw new ChatInputError(TOO_MANY_REFUSAL);
	return raw.map((a: unknown) => {
		const { name, mimeType, data } = (a ?? {}) as Record<string, unknown>;
		if (typeof name !== "string" || !name.trim() || typeof mimeType !== "string" || !mimeType) {
			throw new ChatInputError("each attachment requires a name and a mimeType");
		}
		if (typeof data !== "string" || data.length % 4 !== 0 || !BASE64.test(data)) {
			throw new ChatInputError(`${name} is not valid base64`);
		}
		const refusal = attachmentRefusal({ name, type: mimeType, size: base64Bytes(data) });
		if (refusal) throw new ChatInputError(refusal);
		return { name, mimeType, data };
	});
}

/**
 * The native appends an input event makes to the record (pure). The caller
 * persists them write-ahead; the agent's context is the record plus these.
 *
 * Answer validation is the orphan-400 discipline: the call must be a
 * DANGLING QUESTION call in the record (posed, never answered) — anything
 * else 400s honestly instead of silently interrupting a question or
 * double-answering.
 *
 * `attachments` are the input's files as the server stored them (pictures
 * normalized, PDFs saved): they join the learner's message.
 */
export function inputAppends(
	record: { messages: LhMessage[]; kind?: string },
	input: ChatInput,
	attachments: readonly AttachmentPart[] = [],
): LhMessage[] {
	switch (input.type) {
		case "text":
			return [...dismissalConclusion(record), newUserMessage(input.text, attachments)];
		case "answer": {
			const pending = danglingQuestionOf(record.messages);
			if (!pending || pending.toolCallId !== input.toolCallId) {
				throw new ChatInputError("answer input targets no pending question call");
			}
			if (attachments.length > 0 && !answerTakesFiles(pending.tool)) {
				throw new ChatInputError(`a ${pending.tool} answer takes no files`);
			}
			return [newAnswerResult(input.toolCallId, pending.tool, input.answer, attachments)];
		}
		case "continue":
			return dismissalConclusion(record);
		case "side":
			if (!danglingQuestionOf(record.messages)) {
				throw new ChatInputError("side input requires a waiting question");
			}
			return [newSideQuestion(input.text, attachments)];
		case "next": {
			// Honest 400s: the signal is a between-problems affordance —
			// practice, study and homework only, nothing active, and the client
			// gates make violations unreachable in practice anyway.
			if (record.kind !== "practice" && record.kind !== "study" && record.kind !== "homework") {
				throw new ChatInputError("next input is a practice, study or homework session affordance");
			}
			if (activeProblemOf(record.messages)) {
				throw new ChatInputError("next input requires no active problem");
			}
			return [...dismissalConclusion(record), newNextMessage()];
		}
		case "opener-answer":
			// Only the server's copy reads the record's openers.
			throw new ChatInputError("opener-answer input is appended by the server");
	}
}

/** The deferred conclude synthesis: a
 *  problem-dismissal marker waits for the user's next input — the pair
 *  (synthetic conclude call + ack) rides ahead of it, so the agent reads
 *  the dismissal through its own vocabulary and the slot frees. Pure;
 *  empty when nothing dismissals pend. */
function dismissalConclusion(record: { messages: LhMessage[] }): LhMessage[] {
	const problemCallId = pendingProblemDismissalOf(record.messages);
	return problemCallId ? concludedByDismissalPair(problemCallId) : [];
}

