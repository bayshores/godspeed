/** A list's or sheet's title on the Progress tab, over an ink rule. */
export const TITLE = "border-b-[1.5px] border-ink pb-1.5 text-xl leading-tight text-ink";

/** A row that opens something, with a dotted rule under all but the last. */
export const ROW = "lh-press flex items-center gap-3.5 border-b border-dotted border-edge px-1 hover:bg-tone focus-visible:bg-tone [li:last-child>&]:border-b-0";

/** Answer outcome → block color (right / wrong / didn't know). */
export const OUTCOME_BG = {
	right: "bg-ans-right",
	wrong: "bg-ans-wrong",
	dontKnow: "bg-ans-dontknow",
} as const;
