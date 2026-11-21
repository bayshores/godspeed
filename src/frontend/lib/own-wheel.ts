/** Pixels per unit of a wheel event's delta: a line is 16, a page 400. */
export function wheelUnit(deltaMode: number): number {
	return deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
}

/** Must match OWN_ZOOM in crates/shell/src/shim.js. */
const OWN_ZOOM = "data-lh-own-zoom";

/**
 * Gives `el` the wheel for a view that zooms itself, and marks it so the
 * desktop app's pinch zoom leaves it alone. Not passive: React's listener
 * is, and cannot stop the page scrolling. Returns the cleanup.
 */
export function ownWheel(el: HTMLElement, onWheel: (e: WheelEvent) => void): () => void {
	el.setAttribute(OWN_ZOOM, "");
	el.addEventListener("wheel", onWheel, { passive: false });
	return () => {
		el.removeAttribute(OWN_ZOOM);
		el.removeEventListener("wheel", onWheel);
	};
}
