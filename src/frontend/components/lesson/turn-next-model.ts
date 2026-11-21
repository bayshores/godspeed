/**
 * "Your turn" with nothing to answer: what is next and the one key that goes
 * on, the finished task the right page keeps, whether the lesson's book is
 * open, and whether the sheet is drawn. Pure.
 */
import { askLine, savedLine, type LessonAsk, type LessonNotes, type VaultNote } from "@/frontend/components/vault/note-pages-model";
import { answerForPresentation, closedProblemOf, isQuestionTool, isRecord, openerQuestionId, PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL, type LessonStop, type LhMessage, type LhViewMessage, type QuestionAnswerData } from "@/shared/core";

/** What the next state's key does. */
export type NextAction = "keep-going" | "next" | "done-for-today" | "start-again";

/** What the last topic's "Your turn" shows of the lesson's notes: its pages, the line saying
 *  whether they are saved and the "My words" ask it owes now, if any. */
export interface TurnNotes {
	pages: VaultNote[];
	saved: string | null;
	ask: LessonAsk | null;
}

/** The next state: a line saying what is next, and the key. */
export interface TurnNext {
	/** Null leaves the line out. */
	line: string | null;
	key: { label: string; action: NextAction } | null;
	/** Only at the last topic, with notes to show. */
	notes?: TurnNotes;
}

/**
 * The next state, or null while the teacher writes with no stop to go on
 * from. At a stop he has not kept going from, the key goes on from it, even
 * while the teacher reads ahead; the last topic ends the day instead. With no
 * stop, the go-ahead key shows once the teacher is done, unless an error line
 * is up (its Try again answers first), and Start again shows after a first
 * reply was stopped with nothing written. A problem list's key names its
 * problem, so its stop has no line. At the last topic the lesson's notes
 * show too: its pages, and while a "My words" ask is owed, the ask is the
 * line.
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
	/** The lesson's notes (useLessonNotes); null without a notes folder. */
	notes: LessonNotes | null;
	/** The notes go to an Obsidian vault. */
	obsidian: boolean;
}): TurnNext | null {
	const { stop } = s;
	if (stop?.kind === "end") {
		const done = { label: "Done for today", action: "done-for-today" } as const;
		const ask = s.notes?.asks[0] ?? null;
		const pages = s.notes?.pages ?? [];
		const line = ask ? askLine(ask.name) : "That was the last topic.";
		return { line, key: done, ...(pages.length > 0 || ask ? { notes: { pages, saved: savedLine(pages, s.obsidian), ask } } : {}) };
	}
	if (stop) return { line: s.problemList ? null : stopLine(stop), key: s.goLabel ? { label: s.goLabel, action: "keep-going" } : null };
	if (s.busy) return null;
	if (s.error) return { line: null, key: null };
	if (s.goLabel) return { line: null, key: { label: s.goLabel, action: "next" } };
	return { line: null, key: s.nothingWritten ? { label: "Start again", action: "start-again" } : null };
}

/** What "Your turn" shows with nothing waiting: the next state, or, while the
 *  teacher writes with no stop to go on from, its last line, dimmed. */
export interface TurnShown {
	next: TurnNext;
	dim: boolean;
}

/** The next state, when there is one; while the teacher writes, the last
 *  next state's line (`lastLine`) stays, with no key. */
export function turnShown(s: { next: TurnNext | null; lastLine: string | null }): TurnShown {
	return s.next ? { next: s.next, dim: false } : { next: { line: s.lastLine, key: null }, dim: true };
}

/** The task the learner last finished, kept on the right page until the lesson goes on: a
 *  question he answered or skipped, or a problem that was concluded or discarded. */
type HeldTask =
	| { kind: "question"; toolCallId: string; answer: QuestionAnswerData }
	| { kind: "problem"; toolCallId: string; input: unknown; details: unknown; discarded: boolean };

/** The markers of the learner going on: from a stop, to the next problem, or asking to be taught. */
const GO_ON: ReadonlySet<string> = new Set(["keep-going", "practice-next", "teach-me"]);

/**
 * The task the right page keeps, or null. A finished task stays through
 * lines the learner types and what the teacher writes back, and through a
 * question from earlier. It goes once he went on and the teacher's reply to
 * that landed whole with words in it: a reply still on its way, stopped or
 * failed keeps it. It also goes when nothing can follow it (`goOn`: a key
 * to go on stands, or a turn runs). A problem still open is no held task.
 * `record` is the saved lesson; `view` holds a question's answer as the
 * lesson shows it (an opener's question lives only there).
 */
export function heldTask(record: readonly LhMessage[], view: readonly LhViewMessage[], s: { busy: boolean; goOn: boolean }): HeldTask | null {
	if (!s.busy && !s.goOn) return null;
	const found = lastFinished(record, s.busy);
	if (found === null) return null;
	if (found.kind === "problem") {
		const problem = closedProblemOf(record);
		return problem && { kind: "problem", ...problem };
	}
	for (const message of view) {
		const part = message.parts.find((p) => p.toolCallId === found.id && p.state === "output-available");
		if (!part) continue;
		const saved = part.output as QuestionAnswerData | undefined;
		return typeof saved?.questionText === "string" ? { kind: "question", toolCallId: found.id, answer: answerForPresentation(saved, part.input) } : null;
	}
	return null;
}

/** What the learner finished last, read from the end of the record. */
function lastFinished(record: readonly LhMessage[], busy: boolean): { kind: "question"; id: string } | { kind: "problem" } | null {
	// Of the teacher's replies after the place the walk stands at: whether the newest ended whole, and whether any holds words.
	let whole: boolean | null = null;
	let words = false;
	for (let i = record.length - 1; i >= 0; i--) {
		const m = record[i]!;
		if (m.role === "assistant") {
			whole ??= m.stopReason === "stop" || m.stopReason === "length";
			words ||= m.content.some((block) => block.type === "text" && block.text.trim() !== "");
		} else if (m.role === "toolResult" && !m.isError) {
			if (isQuestionTool(m.toolName)) return { kind: "question", id: m.toolCallId };
			if (m.toolName === PRACTICE_CONCLUDE_TOOL) return { kind: "problem" };
			if (m.toolName === PRACTICE_PROBLEM_TOOL) return null;
		} else if (m.role === "custom") {
			if (m.customType === "opener-answer") {
				const ref = isRecord(m.details) ? m.details.topicDoneCallId : undefined;
				return typeof ref === "string" ? { kind: "question", id: openerQuestionId(ref) } : null;
			}
			if (m.customType === "problem-dismissed") return { kind: "problem" };
			if (GO_ON.has(m.customType) && !busy && whole === true && words) return null;
		}
	}
	return null;
}

/** Whether the lesson's book is open, so the right page shows: the teacher asks, a problem is
 *  open, or a finished task is kept. A question from earlier shows wherever the box stands. */
export function bookOpen(s: { question: "teacher" | "review" | null; problem: boolean; held: boolean }): boolean {
	return s.question === "teacher" || s.problem || s.held;
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
