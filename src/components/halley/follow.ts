/**
 * Follow (plan 2026-10-28, Phase 4). Pure.
 *
 * With Follow on, Halley takes you to the page of each change. Going to a
 * page yourself turns it off ("Stopped following"). While you type or a
 * dialog is open it waits, and catches up RESUME_MS after you stop.
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
 *  page, both, or nothing. */
export function followMoves(
	action: { page: string; classId: string | null },
	here: { path: string; activeClass: string | null },
): { switchClass: { to: string | null } | null; go: string | null } {
	const switchClass = classScopedPage(action.page) && action.classId !== here.activeClass ? { to: action.classId } : null;
	return { switchClass, go: action.page !== here.path ? action.page : null };
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
