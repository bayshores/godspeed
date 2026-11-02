/**
 * The teacher's docked panel: how wide it is, and how far it pushes the
 * page left so nothing sits under it. Pure.
 */

export const DOCK_WIDTH = 400;
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The lesson's Your turn panel sits beside the reading pane from this
 *  window width (stacked under it below). */
const TURN_SIDE_BY_SIDE = 1100;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/** The Your turn panel's width when it sits at the right edge, else null. */
function sideTurn(viewportWidth: number, yourTurnWidth: number | null): number | null {
	return viewportWidth >= TURN_SIDE_BY_SIDE ? yourTurnWidth : null;
}

/** How wide the docked panel is: the whole window when it is narrow,
 *  otherwise 400, or the lesson's Your turn panel's width when that is
 *  wider, so the panel covers it. */
export function dockWidth(viewportWidth: number, yourTurnWidth: number | null): number {
	if (viewportWidth < DOCK_FULL_BELOW) return viewportWidth;
	return Math.min(viewportWidth, Math.max(DOCK_WIDTH, sideTurn(viewportWidth, yourTurnWidth) ?? 0));
}

/** How far the open panel pushes the page: the part of the panel that
 *  isn't over the Your turn panel (which it replaces while open). Zero
 *  when the panel takes the whole window or the page would get too narrow. */
export function dockPush(viewportWidth: number, pageWidth: number, yourTurnWidth: number | null): number {
	if (viewportWidth < DOCK_FULL_BELOW) return 0;
	const push = Math.max(0, dockWidth(viewportWidth, yourTurnWidth) - (sideTurn(viewportWidth, yourTurnWidth) ?? 0));
	return pageWidth - push < MIN_PAGE ? 0 : push;
}
