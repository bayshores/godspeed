/**
 * THE INPUT-EVENTS CONTRACT: POST /api/chat carries `{chatId, input}` —
 * ONE explicit event, never a client transcript. The server owns the
 * record; a send tells it what HAPPENED, not what the client's list looks
 * like. An input event retries safely: nothing was appended when a POST
 * is refused.
 *
 * The teach events (practice adds `next` and homework `open`, below):
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
 *   open    — a pick from a homework lesson's problem list; the teacher
 *             opens that problem, done or not.
 *   opener-answer — the answer to the next topic's opener (a question
 *             topic_done stored, shown by the app after Keep going), or
 *             its skip.
 *
 * Server-originated delivery (the wake pipeline's steers) is NOT a client
 * input — the handler accepts it on the same path (TurnInput) so every
 * turn rides one composition.
 */

import type { QuestionAnswerData } from "./question-core.ts";
import type { ReviewOf } from "./contracts/chat.ts";
import type { LhMessage } from "./native-messages.ts";
import {
	activeProblemOf,
	concludedByDismissalPair,
	danglingQuestionOf,
	newAnswerResult,
	newNextMessage,
	newOpenProblemMessage,
	
	newSideQuestion,
	newUserMessage,
	pendingProblemDismissalOf } from "./native-messages.ts";
import { answerTakesFiles } from "./pending.ts";
import {
	
	
	
	
	type AttachmentPart,
	type ChatAttachment } from "./attachments.ts";

/** One client-originated input event (the POST body's `input`). */
export type ChatInput =
	/** `about`: Ask Teacher on a shown opener (its topic_done call id) or
	 *  on the open question from earlier (with the option labels picked so
	 *  far); either stays open. */
	| { type: "text"; text: string; attachments?: ChatAttachment[]; about?: { opener: string } | { reviewOf: ReviewOf; picked?: string[] } }
	| { type: "answer"; toolCallId: string; answer: QuestionAnswerData; attachments?: ChatAttachment[] }
	| { type: "continue" }
	| { type: "side"; text: string; attachments?: ChatAttachment[] }
	/** The practice move-on signal: the learner's
	 *  explicit go-ahead during the between-problems pause — the Next
	 *  chip or Enter on an empty composer. Practice sessions only, and
	 *  only with nothing active. */
	| { type: "next" }
	/** A pick from a homework lesson's problem list, done or not: the
	 *  teacher opens that one. */
	| { type: "open"; number: string }
	/** His answer to the next topic's opener, which has no tool call of
	 *  its own; null is Skip question. */
	| { type: "opener-answer"; topicDoneCallId: string; answer: QuestionAnswerData | null };

/** A malformed input event (the honest 400 — the orphan-trap discipline). */
class ChatInputError extends Error {}

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
		case "open": {
			if (record.kind !== "homework") {
				throw new ChatInputError("open input is a homework session affordance");
			}
			if (danglingQuestionOf(record.messages)) {
				throw new ChatInputError("open input waits for the pending question's answer");
			}
			if ((activeProblemOf(record.messages)?.input as { number?: unknown } | undefined)?.number === input.number) {
				throw new ChatInputError("that problem is already open");
			}
			return [...dismissalConclusion(record), newOpenProblemMessage(input.number)];
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

