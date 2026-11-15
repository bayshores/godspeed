/**
 * The teacher's docked panel: its tabs, how wide it is, and how far it
 * pushes the page left so nothing sits under it. The Terminal tab is wide
 * enough for the agent's whole screen at its largest font. Pure.
 */
import { FULL_SCREEN_WIDTH } from "@/frontend/components/terminal/terminal-model";

export type PanelTab = "talk" | "activity" | "terminal";

/** The panel's tabs: Terminal only in the desktop app. A lesson is the
 *  chat and has its own Activity, so there the panel is the Terminal alone. */
export function panelTabs(inLesson: boolean, terminals: boolean): PanelTab[] {
	if (inLesson) return terminals ? ["terminal"] : [];
	return terminals ? ["talk", "activity", "terminal"] : ["talk", "activity"];
}

export const DOCK_WIDTH = 400;
/** The whole screen at 14 px, its padding on both sides and the panel's left border. */
export const TERMINAL_DOCK_WIDTH = FULL_SCREEN_WIDTH + 2 * 12 + 2;
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/** How wide the docked panel is: 400, or the Terminal tab's width as far
 *  as the window allows, or the whole window when it is narrow. */
export function dockWidth(viewportWidth: number, terminal: boolean): number {
	if (viewportWidth < DOCK_FULL_BELOW) return viewportWidth;
	return terminal ? Math.min(TERMINAL_DOCK_WIDTH, viewportWidth) : DOCK_WIDTH;
}

/** How far the open panel pushes the page: its width while the page keeps
 *  room enough, else zero. The Terminal tab keeps Talk's push when its own
 *  would make the page too narrow, so switching tabs never widens the page;
 *  the panel covers the rest. A lesson draws its own top bar, which a push
 *  would cut short above the panel: there the panel covers. */
export function dockPush(viewportWidth: number, pageWidth: number, terminal: boolean, overLesson: boolean): number {
	if (viewportWidth < DOCK_FULL_BELOW || overLesson) return 0;
	const push = (width: number) => pageWidth - width >= MIN_PAGE;
	if (terminal && push(TERMINAL_DOCK_WIDTH)) return TERMINAL_DOCK_WIDTH;
	return push(DOCK_WIDTH) ? DOCK_WIDTH : 0;
}
