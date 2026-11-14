/** A top bar tab: the lit one is a block of the page's paper. */
export const BAR_TAB = "lh-press flex min-w-0 items-center gap-2 px-4 text-[15px] whitespace-nowrap";
export const barTabState = (lit: boolean) => (lit ? "bg-background font-medium text-ink" : "text-bar-ink hover:bg-bar-ink/10");

/** One entry of a top bar menu. */
export const MENU_ITEM = "lh-press flex items-center px-3 py-2 text-left text-[15px] text-ink hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
