/**
 * Follow mode. Pure.
 *
 * With Follow on (the default), Halley takes you to the page of each
 * change. Only the Follow chip's Stop turns it off. While you
 * type or a dialog is open it waits, and catches up RESUME_MS after you
 * stop. It never leaves a lesson where you have unsent text. With Follow
 * off, a fresh change on another page offers a "Go to" button.
 */

export const RESUME_MS = 3000;
/** localStorage key (the learner's choice, remembered across restarts). */
export const FOLLOW_KEY = "lh:follow";

export interface FollowState {
	on: boolean;
	/** Last time the learner was typing or had a dialog open. */
	lastBusyAt: number | null;
}

export type FollowEvent =
	| { type: "toggle"; on: boolean }
	/** The learner is typing or a dialog is open, right now. */
	| { type: "busy"; at: number };

export const FOLLOW_DEFAULT: FollowState = { on: true, lastBusyAt: null };

export function followReducer(s: FollowState, e: FollowEvent): FollowState {
	switch (e.type) {
		case "toggle":
			return { ...s, on: e.on };
		case "busy":
			return { ...s, lastBusyAt: e.at };
	}
}

/** Whether Follow may act now: always when off; when on, only while the
 *  learner isn't busy and RESUME_MS have passed since they last were. */
export function followReady(s: FollowState, busyNow: boolean, now: number): boolean {
	if (!s.on) return true;
	if (busyNow) return false;
	return s.lastBusyAt === null || now - s.lastBusyAt >= RESUME_MS;
}

/** Pages that show one class (the window's class must match first). A
 *  lesson belongs to its class too, so the sidebar lists it. */
function classScopedPage(page: string): boolean {
	return page === "/class" || page.startsWith("/class/") || page === "/graph" || page.startsWith("/chat/");
}

/** What Follow must do to show an action's page: switch class, go to the
 *  page, both, or nothing. A lesson with unsent text keeps the window. */
export function followMoves(
	action: { page: string; classId: string | null },
	here: { path: string; activeClass: string | null; lessonDraft: boolean },
): { switchClass: { to: string | null } | null; go: string | null } {
	if (here.lessonDraft && here.path.startsWith("/chat/")) return { switchClass: null, go: null };
	const switchClass = classScopedPage(action.page) && action.classId !== here.activeClass ? { to: action.classId } : null;
	return { switchClass, go: action.page !== here.path ? action.page : null };
}

/** How long a change on another page keeps its "Go to" button. */
export const GO_OFFER_MS = 10 * 60_000;

/** The change to offer "Go to" for while Follow is off: the newest one,
 *  while it is fresh and its page isn't the one you're on. */
export function goOffer<A extends { page: string; at: string }>(newest: A | undefined, here: { follow: boolean; path: string; now: number }): A | null {
	if (!newest || here.follow) return null;
	const page = safePage(newest.page);
	if (!page || page === here.path) return null;
	return here.now - Date.parse(newest.at) < GO_OFFER_MS ? newest : null;
}

/** The page's name on the "Go to" button. */
export function pageName(page: string): string {
	if (page.startsWith("/chat/")) return "lesson";
	return ({ "/": "Home", "/class": "Overview", "/class/files": "Files", "/graph": "Graph" } as Record<string, string>)[page] ?? "page";
}

/** The stored Follow choice ("0" = off). On by default. */
export function parseFollow(raw: string | null): boolean {
	return raw !== "0";
}

/** Only the app's own pages are ever navigated to (never a raw URL from
 *  the wire). */
export function safePage(page: string): string | null {
	return /^\/(?:class(?:\/files)?|graph|chat\/[A-Za-z0-9_-]+)?$/.test(page) ? page : null;
}
