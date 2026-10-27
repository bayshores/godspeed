/** The Overview's shared card look (design/exports/overview.html). */
export const CARD = "flex w-full flex-col items-start gap-3.5 bg-panel px-[22px] py-5";
export const CARD_TITLE = "text-[17px] font-extrabold text-ink";

/** Answer outcome → block color (right / wrong / didn't know). */
export const OUTCOME_BG = {
	right: "bg-ans-right",
	wrong: "bg-ans-wrong",
	dontKnow: "bg-ans-dontknow",
} as const;
