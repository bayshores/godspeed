/**
 * Text size is the app's zoom. The stops are the shell's zoom ladder, so a
 * slider position and the factor the shell keeps map one to one.
 */

/** Must match LADDER in crates/shell/src/zoom.rs. */
const LADDER = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export const ZOOM_STOPS = LADDER.length;

/** The stop nearest `factor`. */
export function zoomIndex(factor: number): number {
	let best = 0;
	for (let i = 1; i < LADDER.length; i++) if (Math.abs(LADDER[i]! - factor) < Math.abs(LADDER[best]! - factor)) best = i;
	return best;
}

export function zoomFactor(index: number): number {
	return LADDER[index]!;
}

export function zoomLabel(index: number): string {
	return `${Math.round(zoomFactor(index) * 100)}%`;
}
