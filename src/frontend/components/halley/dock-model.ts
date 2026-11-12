/**
 * The teacher's docked panel: how wide it is, and how far it pushes the
 * page left so nothing sits under it. Pure.
 */

export const DOCK_WIDTH = 400;
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;
/** The page is never pushed narrower than this; the panel covers it instead. */
const MIN_PAGE = 480;

/** How wide the docked panel is: 400, or the whole window when it is narrow. */
export function dockWidth(viewportWidth: number): number {
	return viewportWidth < DOCK_FULL_BELOW ? viewportWidth : DOCK_WIDTH;
}

/** How far the open panel pushes the page: its width, or zero when it takes
 *  the whole window or the page would get too narrow. */
export function dockPush(viewportWidth: number, pageWidth: number): number {
	if (viewportWidth < DOCK_FULL_BELOW) return 0;
	return pageWidth - DOCK_WIDTH < MIN_PAGE ? 0 : DOCK_WIDTH;
}
