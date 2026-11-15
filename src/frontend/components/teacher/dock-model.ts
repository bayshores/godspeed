/**
 * The teacher's docked panel: its tabs, how wide it is, and how far it
 * pushes the page left so nothing sits under it. The Terminal tab is wide
 * enough for the agent's whole screen at its largest font. Pure.
 */
import { FULL_SCREEN_WIDTH, screenWidth } from "@/frontend/components/terminal/terminal-model";

export type PanelTab = "talk" | "activity" | "terminal";

/** The panel's tabs: Terminal only in the desktop app. A lesson is the
 *  chat and has its own Activity, so there the panel is the Terminal alone. */
export function panelTabs(inLesson: boolean, terminals: boolean): PanelTab[] {
	if (inLesson) return terminals ? ["terminal"] : [];
	return terminals ? ["talk", "activity", "terminal"] : ["talk", "activity"];
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
 * How wide the open panel is and how far it pushes the page left. Talk and
 * Activity are 400 and push while the page keeps 480. The Terminal tab
 * pushes too, as wide as the page allows up to the whole screen at 14 px,
 * as long as the screen keeps 12 px (the font fit shrinks it); below that
 * it covers the page at its full width and keeps Talk's push, so switching
 * tabs never widens the page. A lesson draws its own top bar, which a push
 * would cut short above the panel: there the panel covers. A narrow
 * window gets the whole width.
 */
export function dockLayout(viewportWidth: number, pageWidth: number, terminal: boolean, overLesson: boolean): { width: number; push: number } {
	if (viewportWidth < DOCK_FULL_BELOW) return { width: viewportWidth, push: 0 };
	const room = overLesson ? 0 : pageWidth - MIN_PAGE;
	const talkPush = room >= DOCK_WIDTH ? DOCK_WIDTH : 0;
	if (!terminal) return { width: DOCK_WIDTH, push: talkPush };
	if (room >= TERMINAL_PUSH_MIN) {
		const width = Math.min(TERMINAL_DOCK_WIDTH, room);
		return { width, push: width };
	}
	return { width: Math.min(TERMINAL_DOCK_WIDTH, viewportWidth), push: talkPush };
}
