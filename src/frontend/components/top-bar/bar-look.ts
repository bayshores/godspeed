/** A top bar tab: the lit one is a block of the page's paper. A tab whose
 *  menu hangs open under it stays the bar's color, so the two read as one. */
export const BAR_TAB = "lh-press flex min-w-0 items-center gap-2 px-4 text-[15px] whitespace-nowrap";
export const barTabState = (lit: boolean) => (lit ? "bg-background font-medium text-ink" : "text-bar-ink hover:bg-bar-ink/10");

/** A word in a bar whose panel is open: a block of the bar's ink. */
export const BAR_WORD_ON = "bg-bar-ink font-medium text-bar hover:bg-bar-ink";

/** A page's own word in the top bar (bar-slots.tsx) and Menu: a small key in the bar's colors, the
 *  same on every page; `on` while its panel is open. */
export const barWord = (on: boolean) => `lh-btn lh-btn-small lh-btn-bar self-center${on ? " lh-btn-on" : ""}`;

/** What a pop-up hangs from, the nearest around its word: the page's words in the app's top bar
 *  (a line of their own in a narrow window), the app's top bar, or a page's own bar. */
export const BARS = ".lh-bar-actions, .lh-app-bar, .lh-own-bar";

/** One entry of a top bar menu. */
export const MENU_ITEM = "lh-press flex items-center px-3 py-2 text-left text-[15px] text-ink hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
