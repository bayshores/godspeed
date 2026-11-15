/**
 * A lesson plugin's window: where it hangs from the lesson bar and how tall it is. Pure.
 */

/** One width for every plugin's page to lay out for. */
const WIDTH = 360;
/** Before the page says how tall it is: a key and a line of words, so a short page barely moves. */
const START_HEIGHT = 120;
/** The shortest window: one line of words with room around it. */
const FLOOR = 48;
/** Kept this far from the window's sides and bottom. */
const EDGE = 16;
/** The top bar it hangs from. */
const BAR = 48;

/**
 * The right edge the window lines up with. While "Your turn" sits beside the lesson's sheet, the
 * sheet's: the window lies wholly over the lesson, never over the question or across two sheets.
 * Stacked, the plugin's word's.
 */
export function windowEdge(word: number, reading: { right: number } | undefined, turn: { left: number } | undefined): number {
	return reading && turn && turn.left >= reading.right ? reading.right : word;
}

/**
 * The window with its right edge at `edge` (windowEdge), moved left only as far as keeps it `EDGE`
 * from the window's left side. Its height is the page's (`reported`, or START_HEIGHT before the
 * page says), from FLOOR up to the room under the bar.
 */
export function pluginWindowBox(edge: number, viewport: { width: number; height: number }, reported: number | null): { right: number; width: number; height: number } {
	const width = Math.min(WIDTH, viewport.width - 2 * EDGE);
	const right = Math.max(0, Math.min(viewport.width - edge, viewport.width - width - EDGE));
	const room = viewport.height - BAR - EDGE;
	const height = Math.max(FLOOR, Math.min(Math.ceil(reported ?? START_HEIGHT), room));
	return { right, width, height };
}
