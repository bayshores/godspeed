/**
 * Follow mode. Pure.
 *
 * With Follow on, Halley takes you to the page of each change. Going to a
 * page yourself turns it off ("Stopped following"). While you type or a
 * dialog is open it waits, and catches up RESUME_MS after you stop. It
 * never leaves a lesson where you have unsent text. With
 * Follow off, a fresh change on another page offers a "Go to" button.
 */

export const RESUME_MS = 3000;
export const STOPPED_NOTICE = "Stopped following";
/** How long "Stopped following" shows. */
export const NOTICE_MS = 2200;
/** localStorage key (Follow is remembered across restarts). */
export const FOLLOW_KEY = "lh:halley-follow";

export interface FollowState {
	on: boolean;
	/** The path Follow itself is navigating to (its own route change). */
	expected: string | null;
	/** Last time the learner was typing or had a dialog open. */
	lastBusyAt: number | null;
	notice: string | null;
}

export type FollowEvent =
	| { type: "toggle"; on: boolean }
	/** Follow is about to go to this path. */
	| { type: "navigating"; path: string }
	/** The route changed to this path. */
	| { type: "route"; path: string }
	/** The learner is typing or a dialog is open, right now. */
	| { type: "busy"; at: number }
	| { type: "clear-notice" };

export const FOLLOW_OFF: FollowState = { on: false, expected: null, lastBusyAt: null, notice: null };

export function followReducer(s: FollowState, e: FollowEvent): FollowState {
	switch (e.type) {
		case "toggle":
			return { ...s, on: e.on, expected: null, notice: null };
		case "navigating":
			return s.on ? { ...s, expected: e.path } : s;
		case "route":
			if (!s.on) return s.expected ? { ...s, expected: null } : s;
			if (s.expected === e.path) return { ...s, expected: null };
			return { ...s, on: false, expected: null, notice: STOPPED_NOTICE };
		case "busy":
			return { ...s, lastBusyAt: e.at };
		case "clear-notice":
			return s.notice ? { ...s, notice: null } : s;
	}
}

/** Whether Follow may act now: always when off; when on, only while the
 *  learner isn't busy and RESUME_MS have passed since they last were. */
export function followReady(s: FollowState, busyNow: boolean, now: number): boolean {
	if (!s.on) return true;
	if (busyNow) return false;
	return s.lastBusyAt === null || now - s.lastBusyAt >= RESUME_MS;
}

/** Pages that show one class (the window's class must match first). */
function classScopedPage(page: string): boolean {
	return page === "/class" || page.startsWith("/class/") || page === "/graph";
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

/** The stored Follow choice ("1" = on). Off by default. */
export function parseFollow(raw: string | null): boolean {
	return raw === "1";
}

/** Only the app's own pages are ever navigated to (never a raw URL from
 *  the wire). */
export function safePage(page: string): string | null {
	return /^\/(?:class(?:\/files)?|graph|chat\/[A-Za-z0-9_-]+)?$/.test(page) ? page : null;
}
