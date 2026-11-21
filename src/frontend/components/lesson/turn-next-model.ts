/**
 * "Your turn" with nothing to answer: what is next and the one key that goes
 * on, what stays while the teacher writes, and whether the sheet is drawn. Pure.
 */
import { answerForPresentation, isQuestionTool, isRecord, openerQuestionId, type LessonStop, type LhMessage, type LhViewMessage, type QuestionAnswerData } from "@/shared/core";

/** What the next state's key does. */
export type NextAction = "keep-going" | "next" | "done-for-today" | "start-again";

/** The next state: a line saying what is next, and the key. */
export interface TurnNext {
	/** Null leaves the line out. */
	line: string | null;
	key: { label: string; action: NextAction } | null;
}

/**
 * The next state, or null while the teacher writes with no stop to go on
 * from. At a stop he has not kept going from, the key goes on from it, even
 * while the teacher reads ahead; the last topic ends the day instead. With no
 * stop, the go-ahead key shows once the teacher is done, unless an error line
 * is up (its Try again answers first), and Start again shows after a first
 * reply was stopped with nothing written. A problem list's key names its
 * problem, so its stop has no line.
 */
export function turnNext(s: {
	/** The stop he has not kept going from. */
	stop: LessonStop | null;
	/** The lesson has a problem list (homework, a lesson on files). */
	problemList: boolean;
	/** The go-ahead key's label (goAheadLabel). */
	goLabel: string | null;
	busy: boolean;
	error: boolean;
	/** A first reply was stopped before the teacher wrote anything (nothingWritten). */
	nothingWritten: boolean;
}): TurnNext | null {
	const { stop } = s;
	if (stop?.kind === "end") return { line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" } };
	if (stop) return { line: s.problemList ? null : stopLine(stop), key: s.goLabel ? { label: s.goLabel, action: "keep-going" } : null };
	if (s.busy) return null;
	if (s.error) return { line: null, key: null };
	if (s.goLabel) return { line: null, key: { label: s.goLabel, action: "next" } };
	return { line: null, key: s.nothingWritten ? { label: "Start again", action: "start-again" } : null };
}

/** A question the learner answered or skipped, as its answered card reads it. */
export interface AnsweredQuestion {
	toolCallId: string;
	answer: QuestionAnswerData;
}

/** What "Your turn" shows with nothing waiting: the next state, or, while the
 *  teacher writes with no stop to go on from, the last thing the learner acted
 *  on, dimmed. */
export type TurnShown = { kind: "next"; next: TurnNext; dim: boolean } | { kind: "answered"; answered: AnsweredQuestion };

/**
 * The next state, when there is one. While the teacher writes, the question
 * the learner just answered or skipped stays; after anything else he did, the
 * last next state's line stays, with no key. `lastLine` is that line.
 */
export function turnShown(s: { next: TurnNext | null; answered: AnsweredQuestion | null; lastLine: string | null }): TurnShown {
	if (s.next) return { kind: "next", next: s.next, dim: false };
	if (s.answered) return { kind: "answered", answered: s.answered };
	return { kind: "next", next: { line: s.lastLine, key: null }, dim: true };
}

/** The markers of what the learner did other than answer a question: going on
 *  from a stop, to the next problem, asking to be taught, dropping a problem,
 *  answering a question from earlier. */
const OTHER_MOVES: ReadonlySet<string> = new Set(["keep-going", "practice-next", "teach-me", "problem-dismissed", "review"]);

/**
 * The question the learner answered or skipped last, when that is the last
 * thing he did: null once he has sent a line or made another move since.
 * `record` is the saved lesson, read for what he did; `view` holds the
 * answer as the lesson shows it (an opener's question lives only there).
 */
export function lastAnswered(record: readonly LhMessage[], view: readonly LhViewMessage[]): AnsweredQuestion | null {
	const id = lastAnswerId(record);
	if (id === null) return null;
	for (const message of view) {
		const part = message.parts.find((p) => p.toolCallId === id && p.state === "output-available");
		if (!part) continue;
		const saved = part.output as QuestionAnswerData | undefined;
		return typeof saved?.questionText === "string" ? { toolCallId: id, answer: answerForPresentation(saved, part.input) } : null;
	}
	return null;
}

function lastAnswerId(record: readonly LhMessage[]): string | null {
	for (let i = record.length - 1; i >= 0; i--) {
		const m = record[i]!;
		if (m.role === "user") return null;
		if (m.role === "toolResult" && isQuestionTool(m.toolName) && !m.isError) return m.toolCallId;
		if (m.role !== "custom") continue;
		if (m.customType === "opener-answer") {
			const ref = isRecord(m.details) ? m.details.topicDoneCallId : undefined;
			return typeof ref === "string" ? openerQuestionId(ref) : null;
		}
		if (OTHER_MOVES.has(m.customType)) return null;
	}
	return null;
}

/** What a topic or problem stop says is next. */
function stopLine(stop: LessonStop): string | null {
	if (stop.next === null) return null;
	return stop.kind === "topic" ? `${stop.next} is next.` : `Next is ${stop.next}.`;
}

/**
 * Whether "Your turn" is drawn: not before the lesson starts, unless it
 * already holds something to press or a line about the turn; then for the
 * whole lesson, beside the text or under it, so the box is always there.
 */
export function turnDrawn(s: { started: boolean; holds: boolean }): boolean {
	return s.started || s.holds;
}
