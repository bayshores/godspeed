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
 */

import type { QuestionAnswerData } from "./question-data.ts";
import type { ReviewOf } from "./contracts/chat.ts";
import type { ChatAttachment } from "./attachments.ts";

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
