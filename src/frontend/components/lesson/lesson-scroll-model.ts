/** The page's own padding, read from its CSS: room above what it rests on and under its last sheet. */
export type Pads = { top: number; end: number };

/** A part this far down "Your turn" (in windows) is shown from its own start, not the sheet's. */
const PART_DEPTH = 0.6;

/** A line cut this far below its top is shown whole; deeper cuts are left alone. */
const SNAP_REACH = 48;

/** "Your turn" as the page measures it, in pixels. */
type Sheet = {
	/** Its top, from the page's top. */
	top: number;
	height: number;
	/** Beside the lesson text, where it always fits the window, instead of under it. */
	beside: boolean;
};

/**
 * Where the lesson page rests, as a scroll position. Its end is the default: the lesson text's
 * newest words at the window's end. With no "Your turn", a reply that landed and is longer than
 * the window is read from its start (`reply`: where the learner's last message, or the page,
 * begins). Under the text, "Your turn" ends at the window's end; when that would hide the start
 * of the newest thing, the page rests on that start instead: the learner's last message once the
 * teacher writes back while "Your turn" stays open, else the part the learner is on when it sits
 * deep in the sheet, else the sheet's top. Beside the text "Your turn" always fits the window, so
 * the page rests at its end. Places are measured from the page's top; `part` from the sheet's.
 */
export function restingTop(end: number, page: { view: number; pads: Pads; sheet: Sheet | null; part: number | null; reply: number | null }): number {
	const { view, pads, sheet, part, reply } = page;
	if (sheet === null) return reply === null ? end : Math.max(0, Math.min(end, reply - pads.top));
	if (sheet.beside) return end;
	const deepPart = part !== null && part > view * PART_DEPTH ? part : null;
	const start = reply ?? (deepPart === null ? sheet.top : sheet.top + deepPart);
	return Math.max(0, Math.min(end, start - pads.top));
}

/**
 * The resting place moved up just enough that the window's top edge does not cut a line of
 * text through its letters. `lines` are the line boxes the edge crosses, from the page's top.
 */
export function wholeLineTop(rest: number, lines: { top: number; bottom: number }[]): number {
	const cut = lines.filter((l) => l.top < rest && l.bottom > rest && rest - l.top <= SNAP_REACH);
	return cut.length === 0 ? rest : Math.max(0, Math.min(...cut.map((l) => l.top)));
}

/**
 * Whether the lesson text and "Your turn" sit as a pair: while something waits, and on
 * through the teacher's reply to it, so the text does not jump to the middle and back
 * between one question and the next.
 */
export function keepPair(paired: boolean, turn: boolean, busy: boolean): boolean {
	return turn || (paired && busy);
}
