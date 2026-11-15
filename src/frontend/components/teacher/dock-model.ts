/**
 * The teacher's docked panel: what it shows, how wide it is, and how far
 * it pushes the page left so nothing sits under it. While the agent's
 * screen shows, it is wide enough for the whole screen at its largest
 * font. Pure.
 */
import { FULL_SCREEN_WIDTH, screenWidth, type TerminalRecord, type TerminalRole } from "@/frontend/components/terminal/terminal-model";

/** The panel's body: the agent's screen or the Activity list. */
export type PanelView = "terminal" | "activity";

/** What the panel can show: the screen only in the desktop app. A lesson
 *  has its own Activity, so there the panel is the screen alone. */
export function panelViews(inLesson: boolean, terminals: boolean): PanelView[] {
	if (inLesson) return terminals ? ["terminal"] : [];
	return terminals ? ["terminal", "activity"] : ["activity"];
}

/** The view the panel opens on: the one picked, while it can show it. */
export const viewIn = (views: readonly PanelView[], picked: PanelView): PanelView | null => (views.includes(picked) ? picked : (views[0] ?? null));

/** The screen the panel shows: the helper's only while there is one. */
export const shownScreen = (picked: TerminalRole, helper: boolean): TerminalRole => (picked === "helper" && helper ? "helper" : "teacher");

/**
 * The open panel shows a key that starts the teacher: on the teacher's
 * screen, the start pair before any start or Start again once it ended;
 * in a browser, the start pair above Activity while no agent is here.
 * Nothing elsewhere repeats that key while it shows.
 */
export function panelStarts(p: { view: PanelView; screen: TerminalRole; terminals: boolean; noAgent: boolean; teacher: TerminalRecord | null; outside: boolean }): boolean {
	if (p.view === "activity") return !p.terminals && p.noAgent;
	if (p.screen !== "teacher") return false;
	return p.teacher ? !!p.teacher.ended : !p.outside;
}

export const DOCK_WIDTH = 400;
/** The screen card's margins and padding on both sides, and the panel's left border. */
const SCREEN_FRAME = 2 * 12 + 2 * 18 + 2;
/** The whole screen at 14 px. */
export const TERMINAL_DOCK_WIDTH = FULL_SCREEN_WIDTH + SCREEN_FRAME;
/** The narrowest screen panel that pushes the page: the whole screen at 12 px. */
export const TERMINAL_PUSH_MIN = screenWidth(12) + SCREEN_FRAME;
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/**
 * How wide the open panel is, how far it pushes the page left, and whether
 * it is wide. It is 400 and pushes while the page keeps 480, until the
 * agent's screen shows (`screen`: a live or ended terminal; before a start
 * the panel is a sentence and two keys). With a screen it pushes too, as
 * wide as the page allows up to the whole screen at 14 px, as long as the
 * screen keeps 12 px (the font fit shrinks it); below that it covers the
 * page at its full width and keeps the narrow push, so swapping to the
 * screen never widens the page. A lesson draws its own top bar, which a
 * push would cut short above the panel: there the panel covers. A narrow
 * window gets the whole width.
 */
export function dockLayout(
	viewportWidth: number,
	pageWidth: number,
	view: PanelView,
	screen: boolean,
	overLesson: boolean,
): { width: number; push: number; wide: boolean } {
	const wide = view === "terminal" && screen;
	if (viewportWidth < DOCK_FULL_BELOW) return { width: viewportWidth, push: 0, wide };
	const room = overLesson ? 0 : pageWidth - MIN_PAGE;
	const narrowPush = room >= DOCK_WIDTH ? DOCK_WIDTH : 0;
	if (!wide) return { width: DOCK_WIDTH, push: narrowPush, wide };
	if (room >= TERMINAL_PUSH_MIN) {
		const width = Math.min(TERMINAL_DOCK_WIDTH, room);
		return { width, push: width, wide };
	}
	return { width: Math.min(TERMINAL_DOCK_WIDTH, viewportWidth), push: narrowPush, wide };
}
