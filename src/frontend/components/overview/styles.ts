/** The look of a big Key: the size of a page's main action and the grey key beside it. */
export const BIG_KEY = "h-12 max-w-full min-w-0 px-7 text-item";

/** A page's one dark key: the next deadline's Study or Work on it, or, with none, the path's. */
export const MAIN_KEY = `${BIG_KEY} lh-btn-main`;

/** A row that opens something. */
export const ROW = "lh-press flex items-center gap-3.5 px-1 hover:bg-tone focus-visible:bg-tone";

/** Answer outcome → block color (right / wrong / didn't know). */
export const OUTCOME_BG = {
	right: "bg-ans-right",
	hinted: "bg-[var(--lh-ramp-3)]",
	wrong: "bg-ans-wrong",
	dontKnow: "bg-ans-dontknow",
} as const;
