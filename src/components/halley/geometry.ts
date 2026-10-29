/**
 * Halley's geometry. Pure: corners, the peek and
 * snapping, where to sit beside a target, the screen-edge point for an
 * off-screen target, the spring step, and the comet trail's shape.
 */

export interface Point {
	x: number;
	y: number;
}
export interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

// ─── sizes ──────────────────────────────────────────────────────────────────

/** The dot's diameter, everywhere. */
export const SIZE = 40;
/** How much of it shows above the edge at rest: the top and the eyes. */
export const PEEK = 24;
/** The gap under it when it rises fully out of the edge. */
export const RISE_GAP = 16;
/** Narrower than this, the window counts as narrow (the sidebar's own
 *  auto-close width). */
export const NARROW_WIDTH = 928;

// ─── corners ────────────────────────────────────────────────────────────────

export type Corner = "br" | "bl";
export const CORNER_KEY = "lh:halley-corner";

/** The gap from the area's side edges. */
export const SIDE_INSET = 28;

/** A saved top corner (it could rest there once) reads as the bottom
 *  corner on the same side. */
export function parseCorner(raw: string | null): Corner {
	return raw === "bl" || raw === "tl" ? "bl" : "br";
}

/** The bottom corner of `area` nearest to a point (where a drag ends). */
export function nearestCorner(p: Point, area: Box): Corner {
	return p.x >= area.left + area.width / 2 ? "br" : "bl";
}

/** Halley's top-left in a bottom corner of `area`: peeking over the
 *  bottom edge, or risen fully out of it. */
export function cornerSpot(corner: Corner, area: Box, size: number, risen: boolean): Point {
	const x = corner === "br" ? area.left + area.width - SIDE_INSET - size : area.left + SIDE_INSET;
	const bottom = area.top + area.height;
	return { x, y: risen ? bottom - RISE_GAP - size : bottom - PEEK };
}

function overlaps(a: Box, b: Box): boolean {
	return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/** Move a resting spot above something it would cover (the update
 *  banner), keeping `gap` between them. */
export function clearOf(spot: Point, size: number, obstacle: Box | null, gap = 12): Point {
	if (!obstacle) return spot;
	if (!overlaps({ left: spot.x, top: spot.y, width: size, height: size }, obstacle)) return spot;
	return { x: spot.x, y: obstacle.top - gap - size };
}

// ─── targets ────────────────────────────────────────────────────────────────

/** Gap between a target and Halley beside it. */
const BESIDE_GAP = 10;

/** Halley's center beside a target: just past its right end, vertically
 *  centered. A target that reaches the window's right edge (a full-width
 *  row) gets Halley over its right end instead. Kept inside the viewport. */
export function besideTarget(rect: Box, size: number, viewport: { width: number; height: number }): Point {
	const half = size / 2;
	const cy = clamp(rect.top + rect.height / 2, half + 8, viewport.height - half - 8);
	const right = rect.left + rect.width + BESIDE_GAP + half;
	if (right + half + 8 <= viewport.width) return { x: right, y: cy };
	return { x: clamp(rect.left + rect.width - BESIDE_GAP - half, half + 8, viewport.width - half - 8), y: cy };
}

/** For a target outside the visible region: Halley's center at the
 *  region's edge nearest it, and the unit direction to point its eyes. */
export function edgeToward(rect: Box, region: Box, size: number): { at: Point; dir: Point } {
	const half = size / 2 + 8;
	const t = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	const at = {
		x: clamp(t.x, region.left + half, region.left + region.width - half),
		y: clamp(t.y, region.top + half, region.top + region.height - half),
	};
	const dx = t.x - at.x;
	const dy = t.y - at.y;
	const len = Math.hypot(dx, dy) || 1;
	return { at, dir: { x: dx / len, y: dy / len } };
}

/** The smallest box around several. */
export function unionBox(boxes: readonly Box[]): Box | null {
	if (boxes.length === 0) return null;
	const left = Math.min(...boxes.map((b) => b.left));
	const top = Math.min(...boxes.map((b) => b.top));
	const right = Math.max(...boxes.map((b) => b.left + b.width));
	const bottom = Math.max(...boxes.map((b) => b.top + b.height));
	return { left, top, width: right - left, height: bottom - top };
}

// ─── flight ─────────────────────────────────────────────────────────────────

/** One 60 Hz step of the spring (the prototype's feel: pull 0.07, damping 0.74). */
export function springStep(p: Point, v: Point, target: Point): { p: Point; v: Point } {
	const vx = (v.x + (target.x - p.x) * 0.07) * 0.74;
	const vy = (v.y + (target.y - p.y) * 0.07) * 0.74;
	return { p: { x: p.x + vx, y: p.y + vy }, v: { x: vx, y: vy } };
}

/** Moving faster than this (px per step) counts as flying. */
export const FLYING_SPEED = 1.5;

/** Settled: close to the target and nearly still. */
export function settled(p: Point, v: Point, target: Point): boolean {
	return Math.hypot(target.x - p.x, target.y - p.y) < 0.5 && Math.hypot(v.x, v.y) < 0.05;
}

// ─── the trail ──────────────────────────────────────────────────────────────

/** How much recent path the trail shows. */
const TRAIL_MS = 130;

export interface TrailPoint extends Point {
	t: number;
}

/** Keep only the last TRAIL_MS of positions. Mutates and returns `hist`. */
export function pruneTrail(hist: TrailPoint[], now: number, ms = TRAIL_MS): TrailPoint[] {
	while (hist.length && now - hist[0]!.t > ms) hist.shift();
	return hist;
}

/**
 * The comet trail: a closed outline along the recent centers, tapering
 * from nothing at the tail to `radius` at the head (the dot's own width).
 * null when there is too little movement to draw (resting).
 * `from` is the head and `to` the tail, for the fading gradient.
 */
export function trailShape(hist: readonly TrailPoint[], radius: number): { d: string; from: Point; to: Point } | null {
	const pts = hist.filter((q, i) => i === 0 || Math.hypot(q.x - hist[i - 1]!.x, q.y - hist[i - 1]!.y) > 0.5);
	const n = pts.length;
	if (n < 3) return null;
	const tail = pts[0]!;
	const head = pts[n - 1]!;
	if (Math.hypot(head.x - tail.x, head.y - tail.y) < 12) return null;
	const L: string[] = [];
	const R: string[] = [];
	for (let i = 0; i < n; i++) {
		const a = pts[Math.max(0, i - 1)]!;
		const b = pts[Math.min(n - 1, i + 1)]!;
		let nx = -(b.y - a.y);
		let ny = b.x - a.x;
		const len = Math.hypot(nx, ny) || 1;
		nx /= len;
		ny /= len;
		const w = radius * Math.pow(i / (n - 1), 1.3);
		const q = pts[i]!;
		L.push(`${r1(q.x + nx * w)},${r1(q.y + ny * w)}`);
		R.push(`${r1(q.x - nx * w)},${r1(q.y - ny * w)}`);
	}
	return { d: `M${L.join(" L")} L${R.reverse().join(" L")} Z`, from: { x: head.x, y: head.y }, to: { x: tail.x, y: tail.y } };
}

function r1(n: number): number {
	return Math.round(n * 10) / 10;
}

function clamp(v: number, lo: number, hi: number): number {
	return lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
}
