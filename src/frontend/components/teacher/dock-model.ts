/**
 * The teacher's docked panel: its tabs, how wide it is, and how far it
 * pushes the page left so nothing sits under it. The Terminal tab is wide
 * enough for the agent's whole screen at its largest font. Pure.
 */
import { FULL_SCREEN_WIDTH, screenWidth, type TerminalRecord, type TerminalRole } from "@/frontend/components/terminal/terminal-model";

export type PanelTab = "talk" | "activity" | "terminal";

/** The panel's tabs: Terminal only in the desktop app. A lesson is the
 *  chat and has its own Activity, so there the panel is the Terminal alone. */
export function panelTabs(inLesson: boolean, terminals: boolean): PanelTab[] {
	if (inLesson) return terminals ? ["terminal"] : [];
	return terminals ? ["talk", "activity", "terminal"] : ["talk", "activity"];
}

/** The screen the Terminal tab shows: the helper's only while there is one. */
export const shownScreen = (picked: TerminalRole, helper: boolean): TerminalRole => (picked === "helper" && helper ? "helper" : "teacher");

/**
 * The open panel shows a key that starts the teacher: Talk's start pair
 * while no agent is here, or on the Terminal tab's teacher screen, the
 * empty tab's start pair or an ended screen's Start again. Nothing
 * elsewhere repeats that key while it shows.
 */
export function panelStarts(p: { tab: PanelTab; screen: TerminalRole; noAgent: boolean; teacher: TerminalRecord | null; outside: boolean }): boolean {
	if (p.tab === "talk") return p.noAgent;
	if (p.tab !== "terminal" || p.screen !== "teacher") return false;
	return p.teacher ? !!p.teacher.ended : !p.outside;
}

export const DOCK_WIDTH = 400;
/** The screen's padding on both sides and the panel's left border. */
const SCREEN_FRAME = 2 * 12 + 2;
/** The whole screen at 14 px. */
export const TERMINAL_DOCK_WIDTH = FULL_SCREEN_WIDTH + SCREEN_FRAME;
/** The narrowest Terminal tab that pushes the page: the whole screen at 12 px. */
export const TERMINAL_PUSH_MIN = screenWidth(12) + SCREEN_FRAME;
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/**
 * How wide the open panel is, how far it pushes the page left, and whether
 * it is wide. Talk and Activity are 400 and push while the page keeps 480,
 * and so is the Terminal tab until it has a screen to show (`screen`: a
 * live or ended terminal); before a start it is a sentence and two keys.
 * With a screen it pushes too, as wide as the page allows up to the whole screen at 14 px,
 * as long as the screen keeps 12 px (the font fit shrinks it); below that
 * it covers the page at its full width and keeps Talk's push, so switching
 * tabs never widens the page. A lesson draws its own top bar, which a push
 * would cut short above the panel: there the panel covers. A narrow
 * window gets the whole width.
 */
export function dockLayout(
	viewportWidth: number,
	pageWidth: number,
	tab: PanelTab,
	screen: boolean,
	overLesson: boolean,
): { width: number; push: number; wide: boolean } {
	const wide = tab === "terminal" && screen;
	if (viewportWidth < DOCK_FULL_BELOW) return { width: viewportWidth, push: 0, wide };
	const room = overLesson ? 0 : pageWidth - MIN_PAGE;
	const talkPush = room >= DOCK_WIDTH ? DOCK_WIDTH : 0;
	if (!wide) return { width: DOCK_WIDTH, push: talkPush, wide };
	if (room >= TERMINAL_PUSH_MIN) {
		const width = Math.min(TERMINAL_DOCK_WIDTH, room);
		return { width, push: width, wide };
	}
	return { width: Math.min(TERMINAL_DOCK_WIDTH, viewportWidth), push: talkPush, wide };
}
