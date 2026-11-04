/**
 * How the studio's stage shows the pages: two side by side (front and
 * back) when they still read well that way, else one under the other,
 * each scaled to fit the stage's height.
 */

/** Padding around the pages, the gap between two, a page's caption. */
const PAD = 56;
export const PAGE_GAP = 32;
export const CAPTION = 28;
/** Below this, side by side is too small to read: stack instead. */
const MIN_SIDE_BY_SIDE = 0.45;

export function pagesLayout(o: { stageW: number; stageH: number; pageW: number; pageH: number; pages: number }): { scale: number; perRow: number } {
	const fit = (perRow: number) => Math.min((o.stageH - PAD - CAPTION) / o.pageH, (o.stageW - PAD - (perRow - 1) * PAGE_GAP) / (perRow * o.pageW));
	const clamp = (s: number) => Math.max(0.2, Math.min(2, s));
	if (o.pages >= 2 && fit(2) >= MIN_SIDE_BY_SIDE) return { scale: clamp(fit(2)), perRow: 2 };
	return { scale: clamp(fit(1)), perRow: 1 };
}

/** The caption under a page: "Front" and "Back" for two, else its number. */
export function pageCaption(index: number, pages: number): string {
	if (pages === 2) return index === 0 ? "Front" : "Back";
	return pages === 1 ? "" : `Page ${index + 1}`;
}
