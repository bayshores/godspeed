/**
 * Follow mode. Pure.
 *
 * With Follow on (the default), the window goes to the page of each
 * change. The Follow key in the teacher's panel turns it off and on. While
 * you type or a dialog is open it waits, and catches up RESUME_MS after you
 * stop; the slip says why it waits. It never leaves a lesson where you have
 * unsent text, or a mock, unless you asked to go.
 * With Follow off, a fresh change on another page offers a "Go to" button.
 * A page the agent opens goes there with Follow off too, unless the window
 * holds; then it waits as a "Go to" button with Follow on or off.
 */

export const RESUME_MS = 3000;
/** localStorage key (the learner's choice, remembered across restarts). */
export const FOLLOW_KEY = "lh:follow";

/** Why Follow waits: the learner types, or a dialog is open. */
export type FollowPause = "type" | "dialog";

export interface FollowState {
	on: boolean;
	/** The last time the learner was typing or had a dialog open, and which. */
	busy: { at: number; why: FollowPause } | null;
}

export type FollowEvent =
	| { type: "toggle"; on: boolean }
	/** The learner is typing or a dialog is open, right now. */
	| { type: "busy"; at: number; why: FollowPause };

export const FOLLOW_DEFAULT: FollowState = { on: true, busy: null };

export function followReducer(s: FollowState, e: FollowEvent): FollowState {
	switch (e.type) {
		case "toggle":
			return { ...s, on: e.on };
		case "busy":
			return { ...s, busy: { at: e.at, why: e.why } };
	}
}

/** Why Follow waits now, or null when it may act: never when off; when on,
 *  while a dialog is open and until RESUME_MS after the learner was last busy. */
export function followPause(s: FollowState, dialogNow: boolean, now: number): FollowPause | null {
	if (!s.on) return null;
	if (dialogNow) return "dialog";
	return s.busy && now - s.busy.at < RESUME_MS ? s.busy.why : null;
}

/** Pages that show one space (the window's space must match first). A
 *  lesson belongs to its space too. */
function spaceScopedPage(page: string): boolean {
	return page === "/space" || page.startsWith("/space/") || page === "/graph" || page.startsWith("/chat/");
}

/** The window stays where it is: on a mock, or on a lesson with unsent text. */
export function followHeld(path: string, lessonDraft: boolean): boolean {
	return path.startsWith("/space/mock/") || (lessonDraft && path.startsWith("/chat/"));
}

/** A page the agent opens waits as a held "Go to" while the window holds
 *  (a mock, unsent lesson text) or a dialog of the learner's is open;
 *  otherwise it goes there, Follow on or off. Only a click goes anyway. */
export function openWaits(here: { path: string; lessonDraft: boolean; dialog: boolean }): boolean {
	return here.dialog || followHeld(here.path, here.lessonDraft);
}

/** What Follow must do to show an action's page: switch space, go to the
 *  page, both, or nothing. A lesson with unsent text keeps the window, and
 *  so does a mock, unless the learner asked to go. */
export function followMoves(
	action: { page: string; spaceId: string | null },
	here: { path: string; activeSpace: string | null; lessonDraft: boolean; asked: boolean },
): { switchSpace: { to: string | null } | null; go: string | null } {
	if (followHeld(here.path, here.lessonDraft) && !here.asked) return { switchSpace: null, go: null };
	const switchSpace = spaceScopedPage(action.page) && action.spaceId !== here.activeSpace ? { to: action.spaceId } : null;
	return { switchSpace, go: action.page !== here.path ? action.page : null };
}

/** How long a change on another page keeps its "Go to" button, a held
 *  open too. */
export const GO_OFFER_MS = 10 * 60_000;

/** A held open stays offered until its page is reached or it is
 *  GO_OFFER_MS old; a newer one replaces it. */
export function heldStill(held: { page: string; at: string }, here: { path: string; now: number }): boolean {
	return held.page !== here.path && here.now - Date.parse(held.at) < GO_OFFER_MS;
}

/** The change to offer "Go to" for while Follow is off: the newest one
 *  that is not a background check's (its notice card is the tell), while
 *  it is fresh and its page isn't the one you're on. `recent` is newest
 *  first. */
export function goOffer<A extends { page: string; at: string; background?: true }>(recent: readonly A[], here: { follow: boolean; path: string; now: number }): A | null {
	const newest = recent.find((a) => !a.background);
	if (!newest || here.follow) return null;
	const page = safePage(newest.page);
	if (!page || page === here.path) return null;
	return here.now - Date.parse(newest.at) < GO_OFFER_MS ? newest : null;
}

/** The page's name on the "Go to" button. */
export function pageName(page: string): string {
	if (page.startsWith("/chat/")) return "lesson";
	if (page.startsWith("/space/deadline/")) return page.endsWith("/cheat-sheet") ? "cheat sheet" : "deadline";
	const names: Record<string, string> = { "/": "Home", "/space": "Progress", "/space/files": "Files", "/space/deadlines": "Deadlines", "/graph": "Graph" };
	return names[page] ?? "page";
}

/** Sent to the lesson on screen when the agent opens a cheat sheet; the
 *  lesson on that deadline cancels it and opens the sheet beside itself. */
export const OPEN_SHEET_EVENT = "lh:open-sheet";

/** The deadline whose cheat sheet the page is, or null. */
export function sheetDeadline(page: string): string | null {
	return /^\/space\/deadline\/([A-Za-z0-9_-]+)\/cheat-sheet$/.exec(page)?.[1] ?? null;
}

/** The stored Follow choice ("0" = off). On by default. */
export function parseFollow(raw: string | null): boolean {
	return raw !== "0";
}

/** Only the app's own pages are ever navigated to (never a raw URL from
 *  the wire). */
export function safePage(page: string): string | null {
	return /^\/(?:space(?:\/files|\/deadlines|\/deadline\/[A-Za-z0-9_-]+(?:\/cheat-sheet)?)?|graph|chat\/[A-Za-z0-9_-]+)?$/.test(page) ? page : null;
}
