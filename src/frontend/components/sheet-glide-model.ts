/**
 * The lesson's sheets glide to a new height when what they hold changes. Pure.
 */

export interface Box {
	width: number;
	height: number;
}

/** The shortest and the longest glide, and the time each point of travel adds to the shortest. */
const SHORTEST_MS = 110;
export const LONGEST_MS = 320;
const MS_A_POINT = 0.35;

/**
 * How long a sheet takes to reach its new height, or null when it is placed at once: it was not
 * drawn before, its height is the same, or its width or the window changed, which lays the whole
 * page out anew. A line more in the writing box is there in a blink; a whole reply takes longer.
 */
export function glideMs(from: Box, to: Box, sameWindow: boolean): number | null {
	const travel = Math.abs(to.height - from.height);
	if (!sameWindow || from.width !== to.width || from.height === 0 || travel < 1) return null;
	return Math.min(LONGEST_MS, SHORTEST_MS + travel * MS_A_POINT);
}
