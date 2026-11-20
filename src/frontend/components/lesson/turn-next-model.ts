/**
 * "Your turn" with nothing to answer: what is next and the one key that goes
 * on, and where the sheet is drawn. Pure.
 */
import type { LessonStop } from "@/shared/core";

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
 * reply was stopped with nothing written. A homework key names its problem,
 * so its stop has no line.
 */
export function turnNext(s: {
	/** The stop he has not kept going from. */
	stop: LessonStop | null;
	homework: boolean;
	/** The go-ahead key's label (goAheadLabel). */
	goLabel: string | null;
	busy: boolean;
	error: boolean;
	/** A first reply was stopped before the teacher wrote anything (nothingWritten). */
	nothingWritten: boolean;
}): TurnNext | null {
	const { stop } = s;
	if (stop?.kind === "end") return { line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" } };
	if (stop) return { line: s.homework ? null : stopLine(stop), key: s.goLabel ? { label: s.goLabel, action: "keep-going" } : null };
	if (s.busy) return null;
	if (s.error) return { line: null, key: null };
	if (s.goLabel) return { line: null, key: { label: s.goLabel, action: "next" } };
	return { line: null, key: s.nothingWritten ? { label: "Start again", action: "start-again" } : null };
}

/** What a topic or problem stop says is next. */
function stopLine(stop: LessonStop): string | null {
	if (stop.next === null) return null;
	return stop.kind === "topic" ? `${stop.next} is next.` : `Next is ${stop.next}.`;
}

/**
 * Where "Your turn" is drawn: nowhere before the lesson starts; then beside
 * the text for the whole lesson, so the pair never drops to one column and
 * back between problems. Under the text (a narrow room) only while it holds
 * something to answer or press, or a line about the turn.
 */
export function turnPlace(s: { started: boolean; holds: boolean }): "both" | "beside" | null {
	if (s.holds) return "both";
	return s.started ? "beside" : null;
}
