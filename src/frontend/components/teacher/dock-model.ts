/**
 * The teacher's panel: what it shows, how wide it is beside the strip,
 * and how far it pushes the page left. Pure.
 */
import type { PaneBounds } from "@/frontend/components/ui/pane-width-model";

/** The panel's body: its chat (Activity then hangs from its key in the head); Activity alone on a
 *  page with its own box for the teacher ("activity": the head then has no keys); or Activity while
 *  the chat is in a window of its own ("popped": the head then has Follow and Put back). */
export type PanelView = "chat" | "activity" | "popped";

/** A page with its own box for the teacher, a lesson or a cheat sheet: the one place to type there. */
export function hasOwnBox(path: string): boolean {
	return /^\/chat\//.test(path) || /^\/space\/deadline\/[^/]+\/cheat-sheet/.test(path);
}

/** `ownBox`: the page has its own box. `need`: a card in the panel's chat waits to be allowed, which
 *  only that chat can show. */
export function panelBody(popped: boolean, ownBox: boolean, need: boolean): PanelView {
	if (popped) return "popped";
	return ownBox && !need ? "activity" : "chat";
}

/** The chat the panel showed when it popped out (an empty value is a new chat), which the popped
 *  window shows, and which the panel shows again when it is put back. */
export const SHOWN_CHAT_KEY = "lh:teacher-chat";

/** The panel's width: the learner drags its left edge. */
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
