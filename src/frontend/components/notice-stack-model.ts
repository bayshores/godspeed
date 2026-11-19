/** Which notices show under the pill, and what the pill says of them. Pure. */

/** At most this many notices show at once; the rest wait their turn. */
const MAX_SHOWN = 3;

/** A notice shows by itself this long, then folds into the pill. */
export const PRESENT_MS = 12_000;

/** "first": update and restart, ahead of the rest. "quiet": a quiet
 *  space, one at a time. */
export type NoticeKind = "first" | "quiet";

export interface Notice {
	id: string;
	title: string;
	kind: NoticeKind | null;
	/** A title and nothing under it. */
	bare: boolean;
	/** When it folds into the pill (ms); never, for one that closes by itself. */
	foldAt: number;
}

interface NoticeView {
	/** The ids on screen, in the stack's order. */
	shown: string[];
	/** The first notice still showing by itself: the pill says its title. */
	presenting: Notice | null;
	/** How many are folded, for the pill's count; it stays while the card shows them. */
	waiting: number;
}

/**
 * The notices in the stack's order, to what shows: "first" ones before the
 * rest, which keep their order, one "quiet" notice at a time, 3 at most.
 * One shows by itself until it folds; `open` (the pill's card is open)
 * shows the folded ones too. `covered` (the teacher's panel hangs where
 * the cards would): none shows by itself, all wait folded.
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
		presenting: fresh[0] ?? null,
		waiting: taking.length - fresh.length,
	};
}
