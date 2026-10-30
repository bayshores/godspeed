/** A resizable pane's width rules: its default and the range a drag may reach. */
export interface PaneBounds {
	initial: number;
	min: number;
	max: number;
}

export function clampWidth(width: number, { min, max }: PaneBounds): number {
	return Math.round(Math.min(max, Math.max(min, width)));
}

/** A stored width, or the default when it is missing or not a number. */
export function storedWidth(raw: string | null, bounds: PaneBounds): number {
	const n = raw ? Number(raw) : NaN;
	return Number.isFinite(n) ? clampWidth(n, bounds) : bounds.initial;
}

/**
 * The width while dragging. `edge` is the side of the pane the handle sits
 * on: a handle on the right edge (the sidebar) widens the pane as the
 * pointer moves right; one on the left edge (the Your-turn panel) widens it
 * as the pointer moves left.
 */
export function draggedWidth(startWidth: number, startX: number, x: number, edge: "left" | "right", bounds: PaneBounds): number {
	const delta = edge === "right" ? x - startX : startX - x;
	return clampWidth(startWidth + delta, bounds);
}
