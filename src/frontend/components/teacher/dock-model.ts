/**
 * The teacher's docked panel: what it shows, how wide it is, and how far
 * it pushes the page left so nothing sits under it. Pure.
 */
import type { TerminalRecord, TerminalRole } from "@/frontend/components/terminal/terminal-model";
import type { PaneBounds } from "@/frontend/components/ui/pane-width-model";

/** The panel's body: the agent's screen or the Activity list. */
export type PanelView = "terminal" | "activity";

/** What the panel's body is: the screen in the desktop app (Activity then
 *  hangs from its key in the head), Activity in a browser. A lesson has its own
 *  Activity, so there the panel is the screen alone, or nothing. */
export function panelBody(inLesson: boolean, terminals: boolean): PanelView | null {
	if (terminals) return "terminal";
	return inLesson ? null : "activity";
}

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

/** The panel's width: the learner drags its left edge. The narrowest
 *  still shows the agent's screen 40 columns wide. */
export const PANEL_WIDTH: PaneBounds = { initial: 440, min: 360, max: 900 };
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/**
 * How wide the open panel is and how far it pushes the page left. It is
 * as wide as the learner left it (`wanted`) and pushes the page by that
 * much, narrower when the page would drop under 480. A page with no room
 * for even the narrowest panel is covered instead. A narrow window gets
 * the whole width.
 */
export function dockLayout(viewportWidth: number, pageWidth: number, wanted: number): { width: number; push: number } {
	if (viewportWidth < DOCK_FULL_BELOW) return { width: viewportWidth, push: 0 };
	const room = pageWidth - MIN_PAGE;
	if (room < PANEL_WIDTH.min) return { width: Math.min(wanted, viewportWidth), push: 0 };
	const width = Math.min(wanted, room);
	return { width, push: width };
}
