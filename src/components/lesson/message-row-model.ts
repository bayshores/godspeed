import type { LhViewPart } from "@/core";

/**
 * The step separators a reply row draws: one only between two steps that
 * each show something. Steps of hidden work (a class-file search) would
 * otherwise stack empty lines.
 */
export function drawnSeparators(parts: readonly LhViewPart[], shows: (part: LhViewPart) => boolean): Set<number> {
	const drawn = new Set<number>();
	let shownBefore = false;
	let pending: number | null = null;
	parts.forEach((part, i) => {
		if (part.type === "step-start") {
			pending = i;
			return;
		}
		if (!shows(part)) return;
		if (pending !== null && shownBefore) drawn.add(pending);
		pending = null;
		shownBefore = true;
	});
	return drawn;
}
