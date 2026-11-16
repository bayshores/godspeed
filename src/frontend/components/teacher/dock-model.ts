/**
 * The teacher's panel: what it shows, its size as a window hanging from
 * the top bar, and how far it pushes the page left once it is docked down
 * the window's right edge. Pure.
 */
import type { TerminalRecord, TerminalRole } from "@/frontend/components/terminal/terminal-model";
import type { PaneBounds } from "@/frontend/components/ui/pane-width-model";

/** The panel's body: the agent's screen or the Activity list. */
export type PanelView = "terminal" | "activity";

/** What the panel's body is: the screen in the desktop app (Activity then
 *  hangs from its key in the head), Activity in a browser. */
export const panelBody = (terminals: boolean): PanelView => (terminals ? "terminal" : "activity");

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
export const PANEL_WIDTH: PaneBounds = { initial: 620, min: 360, max: 900 };
/** Its height as a window: with the default width, the shape of a
 *  terminal. The shortest still shows the screen's 10 rows. */
export const PANEL_HEIGHT = { initial: 460, min: 320 };
/** A window's height, or "full": docked down the window's right edge. */
export type PanelHeight = number | "full";
/** A window dragged this close to the window's bottom docks. */
const DOCK_SNAP = 40;
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/** A height as the learner left it: docked once it comes near the bottom
 *  of the `room` under the top bar. */
function settled(height: number, room: number): PanelHeight {
	return height >= room - DOCK_SNAP ? "full" : Math.round(Math.max(PANEL_HEIGHT.min, height));
}

/** A stored height, or the default when it is missing or not one. */
export function storedHeight(raw: string | null): PanelHeight {
	if (raw === "full") return "full";
	const n = raw ? Number(raw) : NaN;
	return Number.isFinite(n) ? Math.round(Math.max(PANEL_HEIGHT.min, n)) : PANEL_HEIGHT.initial;
}

/** The height while its bottom edge is dragged: it grows as the pointer
 *  moves down. */
export function draggedHeight(startHeight: number, startY: number, y: number, room: number): PanelHeight {
	return settled(startHeight + y - startY, room);
}

/** How far one arrow press moves the bottom edge (px). */
const KEY_STEP = 16;

/** The height after a key on the bottom edge, or null when the key isn't
 *  one of its keys: the arrows move it the way they point, Home is the
 *  shortest and End docks it. `shown` is the height drawn now. */
export function keyedHeight(shown: number, key: string, room: number): PanelHeight | null {
	if (key === "Home") return PANEL_HEIGHT.min;
	if (key === "End") return "full";
	if (key !== "ArrowUp" && key !== "ArrowDown") return null;
	// Out of the dock in one press.
	const from = Math.min(shown, room - DOCK_SNAP);
	return settled(from + (key === "ArrowDown" ? KEY_STEP : -KEY_STEP), room);
}

/**
 * The open panel's size and how far it pushes the page left. `viewport`
 * is the window's width and the room under the top bar. A window (a
 * height that fits the room) lies over the page at the size the learner
 * left it. Docked (`height: null`, down to the window's bottom) it is as
 * wide as `wanted` and pushes the page by that much, narrower when the
 * page would drop under 480; a page with no room for even the narrowest
 * panel is covered instead. A narrow window gets the panel across its
 * whole width.
 */
export function panelLayout(
	viewport: { width: number; height: number },
	pageWidth: number,
	wanted: { width: number; height: PanelHeight },
): { width: number; height: number | null; push: number } {
	if (viewport.width < DOCK_FULL_BELOW) return { width: viewport.width, height: null, push: 0 };
	if (wanted.height !== "full" && wanted.height < viewport.height) return { width: Math.min(wanted.width, viewport.width), height: wanted.height, push: 0 };
	const room = pageWidth - MIN_PAGE;
	if (room < PANEL_WIDTH.min) return { width: Math.min(wanted.width, viewport.width), height: null, push: 0 };
	const width = Math.min(wanted.width, room);
	return { width, height: null, push: width };
}
