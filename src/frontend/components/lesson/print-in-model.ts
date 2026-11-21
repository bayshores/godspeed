/**
 * A reply that just landed prints top to bottom, line by line, as if it were being written. Pure.
 */

/** One line's time, and the most a whole reply takes: a long reply prints its lines faster. */
const PRINT_LINE_MS = 60;
const PRINT_MOST_MS = 900;

/** When a block starts, how long it takes and in how many steps (its lines). */
interface PrintStep {
	at: number;
	ms: number;
	lines: number;
}

/** The blocks' times from their line counts, one after the other; a block that is not text is one line. */
export function printSchedule(lines: readonly number[]): PrintStep[] {
	const counts = lines.map((n) => Math.max(1, Math.round(n)));
	const total = counts.reduce((sum, n) => sum + n, 0);
	const line = Math.min(PRINT_LINE_MS, PRINT_MOST_MS / Math.max(1, total));
	let at = 0;
	return counts.map((n) => {
		const step = { at, ms: n * line, lines: n };
		at += step.ms;
		return step;
	});
}

/** How many lines a block of text this high holds; anything that is not plain lines counts as one. */
export function linesOf(height: number, lineHeight: number): number {
	return lineHeight > 0 && height > 0 ? Math.max(1, Math.round(height / lineHeight)) : 1;
}
