import type { LhViewPart } from "@/shared/core";

/**
 * The step starts a reply row leaves room at: only between two steps that
 * each show something. Steps of hidden work (a space-file search) would
 * otherwise stack empty room. The next topic's opener (core/view.ts
 * openerParts) follows its stop's card with none.
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
		if (pending !== null && shownBefore && !isOpenerLead(part)) drawn.add(pending);
		pending = null;
		shownBefore = true;
	});
	return drawn;
}

function isOpenerLead(part: LhViewPart): boolean {
	return part.type === "text" && typeof part.id === "string" && part.id.startsWith("opener_");
}
