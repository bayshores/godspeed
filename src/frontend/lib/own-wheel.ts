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
