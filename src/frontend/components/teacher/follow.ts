/**
 * Follow mode. Pure.
 *
 * With Follow on (the default), the window goes to the page of each
 * change. Only the Follow chip's Stop turns it off. While you
 * type or a dialog is open it waits, and catches up RESUME_MS after you
 * stop. It never leaves a lesson where you have unsent text, or a mock,
 * unless you asked to go.
 * With Follow off, a fresh change on another page offers a "Go to" button.
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

/** Pages that show one space (the window's space must match first). A
 *  lesson belongs to its space too. */
function spaceScopedPage(page: string): boolean {
	return page === "/space" || page.startsWith("/space/") || page === "/graph" || page.startsWith("/chat/");
}

/** What Follow must do to show an action's page: switch space, go to the
 *  page, both, or nothing. A lesson with unsent text keeps the window, and
 *  so does a mock, unless the learner asked to go. */
export function followMoves(
	action: { page: string; spaceId: string | null },
	here: { path: string; activeSpace: string | null; lessonDraft: boolean; asked: boolean },
): { switchSpace: { to: string | null } | null; go: string | null } {
	const held = here.path.startsWith("/space/mock/") || (here.lessonDraft && here.path.startsWith("/chat/"));
	if (held && !here.asked) return { switchSpace: null, go: null };
	const switchSpace = spaceScopedPage(action.page) && action.spaceId !== here.activeSpace ? { to: action.spaceId } : null;
	return { switchSpace, go: action.page !== here.path ? action.page : null };
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
	return ({ "/": "Today", "/space": "Progress", "/space/files": "Files", "/graph": "Graph" } as Record<string, string>)[page] ?? "page";
}

/** The stored Follow choice ("0" = off). On by default. */
export function parseFollow(raw: string | null): boolean {
	return raw !== "0";
}

/** Only the app's own pages are ever navigated to (never a raw URL from
 *  the wire). */
export function safePage(page: string): string | null {
	return /^\/(?:space(?:\/files)?|graph|chat\/[A-Za-z0-9_-]+)?$/.test(page) ? page : null;
}
