/**
 * A lesson plugin's window: where it hangs from the top bar and how tall it is. Pure.
 */

/** One width for every plugin's page to lay out for. */
const WIDTH = 360;
/** Before the page says how tall it is: a key and a line of words, so a short page barely moves. */
const START_HEIGHT = 120;
/** The shortest window: one line of words with room around it. */
const FLOOR = 48;
/** Kept this far from the window's sides and bottom. */
const EDGE = 16;

/**
 * The window with its right edge at `edge` (the plugin's word's), moved left only as far as keeps it `EDGE`
 * from the window's left side. Its height is the page's (`reported`, or START_HEIGHT before the
 * page says), from FLOOR up to the room under the bar, whose bottom is `bar`.
 */
export function pluginWindowBox(edge: number, viewport: { width: number; height: number }, bar: number, reported: number | null): { right: number; width: number; height: number } {
	const width = Math.min(WIDTH, viewport.width - 2 * EDGE);
	const right = Math.max(0, Math.min(viewport.width - edge, viewport.width - width - EDGE));
	const room = viewport.height - bar - EDGE;
	const height = Math.max(FLOOR, Math.min(Math.ceil(reported ?? START_HEIGHT), room));
	return { right, width, height };
}
