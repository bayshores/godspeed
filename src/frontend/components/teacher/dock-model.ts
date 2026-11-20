/**
 * The teacher's panel: what it shows, how wide it is beside the strip,
 * and how far it pushes the page left. Pure.
 */
import type { TerminalRecord, TerminalRole } from "@/frontend/components/terminal/terminal-model";
import type { PaneBounds } from "@/frontend/components/ui/pane-width-model";

/** The panel's body: the agent's screen, the Activity list, or Activity while the teacher's
 *  screen is in its own window ("popped": the head then has Follow, Chats and Put back). */
export type PanelView = "terminal" | "activity" | "popped";

/** What the panel's body is: the screen in the desktop app (Activity then
 *  hangs from its key in the head) unless the teacher's screen is popped out, Activity in a
 *  browser. */
export const panelBody = (terminals: boolean, popped: boolean): PanelView => (!terminals ? "activity" : popped ? "popped" : "terminal");

/** The screen the panel shows: the helper's only while there is one. */
export const shownScreen = (picked: TerminalRole, helper: boolean): TerminalRole => (picked === "helper" && helper ? "helper" : "teacher");

/**
 * The open panel shows a key that starts the teacher: on the teacher's
 * screen, the start pair before any start or Start again once it ended;
 * in a browser, the start pair above Activity while no agent is here.
 * Nothing elsewhere repeats that key while it shows.
 */
export function panelStarts(p: { view: PanelView; screen: TerminalRole; terminals: boolean; noAgent: boolean; teacher: TerminalRecord | null; outside: boolean }): boolean {
	if (p.view === "popped") return false;
	if (p.view === "activity") return !p.terminals && p.noAgent;
	if (p.screen !== "teacher") return false;
	return p.teacher ? !!p.teacher.ended : !p.outside;
}

/** The panel's width: the learner drags its left edge. The narrowest
 *  still shows the agent's screen 40 columns wide. */
export const PANEL_WIDTH: PaneBounds = { initial: 620, min: 360, max: 900 };
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/**
 * The open panel's width and how far it pushes the page left, in the
 * room left of the strip (`roomWidth`; `pageWidth` is the page's part of
 * it). It runs from the top bar to the window's bottom, as wide as
 * `wanted`, and pushes the page by that much, narrower when the page
 * would drop under 480; a page with no room for even the narrowest panel
 * is covered instead. A narrow window gets the panel across all its room.
 */
export function panelLayout(roomWidth: number, pageWidth: number, wanted: number): { width: number; push: number } {
	if (roomWidth < DOCK_FULL_BELOW) return { width: roomWidth, push: 0 };
	const room = pageWidth - MIN_PAGE;
	if (room < PANEL_WIDTH.min) return { width: Math.min(wanted, roomWidth), push: 0 };
	const width = Math.min(wanted, room);
	return { width, push: width };
}
