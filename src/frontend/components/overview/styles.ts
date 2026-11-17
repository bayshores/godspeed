/** A Progress sheet's padding: every sheet starts its content 24 points in from its sides. */
export const SHEET = "px-6 pt-5 pb-[22px]";

/** A sheet's head: its title, and its key if it has one, on one 40-point line, so the titles of the two columns line up. */
export const HEAD = "flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-2";

/** A sheet's title on the Progress tab. */
export const TITLE = "min-w-0 text-xl leading-snug text-ink";

/** The page's one dark key: the next deadline's (or, with none, the path's) Study or Work on it. */
export const MAIN_KEY = "lh-btn lh-btn-main h-12 max-w-full min-w-0 px-7 text-[17px]";

/** A row that opens something. */
export const ROW = "lh-press flex items-center gap-3.5 px-1 hover:bg-tone focus-visible:bg-tone";

/** Answer outcome → block color (right / wrong / didn't know). */
export const OUTCOME_BG = {
	right: "bg-ans-right",
	hinted: "bg-[var(--lh-ramp-3)]",
	wrong: "bg-ans-wrong",
	dontKnow: "bg-ans-dontknow",
} as const;
