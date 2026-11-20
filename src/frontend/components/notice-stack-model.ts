/** Which notices show in the peek, and how many wait folded on the strip. Pure. */

/** At most this many notices show at once; the rest wait their turn. */
const MAX_SHOWN = 3;

/** A notice shows by itself this long, then folds into the strip. */
export const PRESENT_MS = 12_000;

/** "first": update and restart, ahead of the rest. "quiet": a quiet
 *  space, one at a time. */
export type NoticeKind = "first" | "quiet";

export interface Notice {
	id: string;
	kind: NoticeKind | null;
	/** When it folds into the strip (ms); never, for one that closes by itself. */
	foldAt: number;
}

interface NoticeView {
	/** The ids on screen, in the stack's order. */
	shown: string[];
	/** How many are folded, for the strip's count; it stays while the peek shows them. */
	waiting: number;
}

/**
 * The notices in the stack's order, to what shows: "first" ones before the
 * rest, which keep their order, one "quiet" notice at a time, 3 at most.
 * One shows by itself until it folds; `open` (the folded ones were asked
 * for) shows those too. `covered` (the teacher's panel is open where the
 * cards would show): none shows by itself, all wait folded.
 */
export function noticeView(notices: readonly Notice[], now: number, open: boolean, covered: boolean): NoticeView {
	const ranked = [...notices].sort((a, b) => Number(b.kind === "first") - Number(a.kind === "first"));
	let quiet = false;
	const taking = ranked.filter((n) => {
		if (n.kind !== "quiet") return true;
		if (quiet) return false;
		quiet = true;
		return true;
	});
	const fresh = covered ? [] : taking.filter((n) => n.foldAt > now);
	const shown = (open ? taking : fresh).slice(0, MAX_SHOWN);
	return {
		shown: shown.map((n) => n.id),
		waiting: taking.length - fresh.length,
	};
}
