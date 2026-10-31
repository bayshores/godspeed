/**
 * Shared pan/zoom viewport math for the plan popup and the mermaid focus.
 * Fully zoomed out is the fit (whichever axis binds), panning locks at that
 * floor, and wheel zoom keeps the cursor point fixed. Pure so tests can pin
 * it (tests/pan-zoom.test.ts), since the overlays are render-tested without
 * live pointer events.
 */

/** Zoom ceiling for every surface that uses this math; 4× is enough to
 *  read node titles closely. */
export const ZOOM_MAX = 4;
/** Viewport breathing room subtracted by the fit. */
const FIT_PAD = 16;
/** The fit never zooms IN past this — a tiny diagram must not blow up. */
export const FIT_ZOOM_MAX = 1.5;

/** A pan/zoom viewport state (translate + scale; origin top-left). */
export interface Viewport {
	zoom: number;
	x: number;
	y: number;
}

/** The fit zoom for a box in a viewport: a true fit, capped at
 *  FIT_ZOOM_MAX; the 0.02 minimum only guards degenerate viewports. Pure. */
export function fitZoomFor(box: { w: number; h: number }, viewport: { w: number; h: number }): number {
	if (!viewport.w || !viewport.h || box.w === 0) return 1;
	return Math.max(0.02, Math.min((viewport.w - FIT_PAD) / box.w, (viewport.h - FIT_PAD) / box.h, FIT_ZOOM_MAX));
}

/** Centers a box (at the given zoom) in the viewport. Pure. */
export function fitGraphView(box: { w: number; h: number }, viewport: { w: number; h: number }, zoom: number): Viewport {
	return { zoom, x: (viewport.w - box.w * zoom) / 2, y: (viewport.h - box.h * zoom) / 2 };
}

/** Zoom by `factor` keeping `focus` (viewport coordinates) visually fixed,
 *  clamped to [floor, ZOOM_MAX]. At the floor the view re-fits + RE-CENTERS
 *  (the fit IS the floor — a locked view there has nothing to move). Pure. */
export function zoomedGraphView(
	view: Viewport,
	factor: number,
	floor: number,
	focus: { x: number; y: number },
	box: { w: number; h: number },
	viewport: { w: number; h: number },
): Viewport {
	const zoom = Math.min(Math.max(view.zoom * factor, floor), ZOOM_MAX);
	if (zoom === view.zoom) return view;
	if (zoom <= floor) return fitGraphView(box, viewport, floor);
	const k = zoom / view.zoom;
	return { zoom, x: focus.x - (focus.x - view.x) * k, y: focus.y - (focus.y - view.y) * k };
}
