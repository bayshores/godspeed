/** A list's or sheet's title on the Progress tab. */
export const TITLE = "pb-1.5 text-xl leading-tight text-ink";

/** A row that opens something. */
export const ROW = "lh-press flex items-center gap-3.5 px-1 hover:bg-tone focus-visible:bg-tone";

/** Answer outcome → block color (right / wrong / didn't know). */
export const OUTCOME_BG = {
	right: "bg-ans-right",
	hinted: "bg-[var(--lh-ramp-3)]",
	wrong: "bg-ans-wrong",
	dontKnow: "bg-ans-dontknow",
} as const;
