/** Room left above what the page rests on, the same as the page's own top padding. */
export const REST_PAD = 24;

/** A part this far down "Your turn" (in windows) is shown from its own start, not the sheet's. */
const PART_DEPTH = 0.6;

/**
 * Where the lesson page rests, as a scroll position. Its end is the default: "Your turn" ends at
 * the window's end with the lesson text above it. When that would hide the start of the newest
 * thing, the page rests on that start instead: the learner's last message once the teacher
 * writes back while "Your turn" stays open, else the part the learner is on when it sits deep in
 * the sheet, else the sheet's top. Each place is measured from the page's top, in pixels.
 */
export function restingTop(end: number, page: { view: number; sheet: number | null; part: number | null; reply: number | null }): number {
	if (page.sheet === null) return end;
	const deepPart = page.part !== null && page.part - page.sheet > page.view * PART_DEPTH ? page.part : null;
	const start = page.reply ?? deepPart ?? page.sheet;
	return Math.max(0, Math.min(end, start - REST_PAD));
}
