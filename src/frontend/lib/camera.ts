/** A view that pans and zooms: the screen shows a point p of what it holds at p × zoom + (x, y). */
export interface Camera {
	x: number;
	y: number;
	zoom: number;
}

/** Zoom to `zoom`, keeping the point under the screen point `at` still. */
export function zoomAt(cam: Camera, zoom: number, at: { x: number; y: number }): Camera {
	const k = zoom / cam.zoom;
	return { zoom, x: at.x - (at.x - cam.x) * k, y: at.y - (at.y - cam.y) * k };
}

/** "100%". */
export function zoomLabel(zoom: number): string {
	return `${Math.round(zoom * 100)}%`;
}
