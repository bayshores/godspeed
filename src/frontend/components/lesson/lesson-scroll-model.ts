/** Room left above what the page rests on, the same as the page's own top padding. */
export const REST_PAD = 24;

/** The page's room under its last sheet. */
const FOOT_PAD = 28;

/** A part this far down "Your turn" (in windows) is shown from its own start, not the sheet's. */
const PART_DEPTH = 0.6;

/** A line cut this far below its top is shown whole; deeper cuts are left alone. */
const SNAP_REACH = 48;

/** "Your turn" as the page measures it, in pixels. */
type Sheet = {
	/** Its top, from the page's top. */
	top: number;
	height: number;
	/** Beside the lesson text, held in view as the text scrolls, instead of under it. */
	beside: boolean;
};

/**
 * Where the lesson page rests, as a scroll position. Its end is the default: the lesson text's
 * newest words at the window's end. Under the text, "Your turn" ends at the window's end; when
 * that would hide the start of the newest thing, the page rests on that start instead: the
 * learner's last message once the teacher writes back while "Your turn" stays open, else the
 * part the learner is on when it sits deep in the sheet, else the sheet's top. Beside the text,
 * a sheet taller than the window shows its top while the page rests just short of its end, by
 * as much as the sheet overflows. Places are measured from the page's top; `part` from the sheet's.
 */
export function restingTop(end: number, page: { view: number; sheet: Sheet | null; part: number | null; reply: number | null }): number {
	const { view, sheet, part, reply } = page;
	if (sheet === null) return end;
	const deepPart = part !== null && part > view * PART_DEPTH ? part : null;
	if (sheet.beside) {
		const over = Math.max(0, sheet.height + REST_PAD + FOOT_PAD - view);
		if (reply !== null || over === 0) return end;
		return Math.max(0, end - over + Math.min(over, deepPart ?? 0));
	}
	const start = reply ?? (deepPart === null ? sheet.top : sheet.top + deepPart);
	return Math.max(0, Math.min(end, start - REST_PAD));
}

/**
 * How "Your turn" holds still beside the lesson text (sticky). While it fits the window it
 * stays under the step line. Taller, it sits at the foot of its column and shows its top
 * until the page nears its end, then slides up with the page so its foot (the box and its
 * keys) comes into view at the end.
 */
export function turnStick(height: number, view: number): { alignSelf: "start"; top: number } | { alignSelf: "end"; bottom: number } {
	return height + REST_PAD + FOOT_PAD <= view ? { alignSelf: "start", top: REST_PAD } : { alignSelf: "end", bottom: view - REST_PAD - height };
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
