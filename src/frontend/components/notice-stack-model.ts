/** Which notices show in the peek, and how many wait folded on the strip. Pure. */

/** At most this many notices show at once; the rest wait their turn. */
const MAX_SHOWN = 3;

/** A notice that shows by itself does so this long, then folds into the strip. */
export const PRESENT_MS = 12_000;

/** "error": something failed or broke, ahead of all and the only kind that
 *  shows by itself beside the strip. "first": an update, ahead of the rest.
 *  "quiet": a quiet space, one at a time. */
export type NoticeKind = "error" | "first" | "quiet";

/** Which notices show by themselves: all where no strip is to wait on (the
 *  first steps), errors beside the strip, none under the teacher's open panel. */
export type Alone = "all" | "errors" | "none";

const rank = (n: Notice) => (n.kind === "error" ? 0 : n.kind === "first" ? 1 : 2);

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
 * The notices in the stack's order, to what shows: errors, then "first"
 * ones, then the rest, which keep their order, one "quiet" notice at a
 * time, 3 at most. Those `alone` lets show by themselves do so until they
 * fold; the others wait folded, so no page has a card laid over it unasked.
 * `open` (the folded ones were asked for) shows them all.
 */
export function noticeView(notices: readonly Notice[], now: number, open: boolean, alone: Alone): NoticeView {
	const ranked = [...notices].sort((a, b) => rank(a) - rank(b));
	let quiet = false;
	const taking = ranked.filter((n) => {
		if (n.kind !== "quiet") return true;
		if (quiet) return false;
		quiet = true;
		return true;
	});
	const fresh = taking.filter((n) => n.foldAt > now && (alone === "all" || (alone === "errors" && n.kind === "error")));
	const shown = (open ? taking : fresh).slice(0, MAX_SHOWN);
	return {
		shown: shown.map((n) => n.id),
		waiting: taking.length - fresh.length,
	};
}
