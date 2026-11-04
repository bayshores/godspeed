/**
 * The cheat sheet canvas's math: where each version's pages sit as
 * artboards, and the camera that pans and zooms over them. World units are
 * CSS pixels at 100% (a PDF point is 4/3 of one); the screen shows a world
 * point p at p × zoom + (x, y). Pure: the canvas component only feeds it
 * pointer and wheel numbers.
 */
import { pageCaption, type SheetVersion } from "@/core";

export interface Camera {
	x: number;
	y: number;
	zoom: number;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Artboard extends Rect {
	/** The version's number and the page's index in it (from 0). */
	n: number;
	page: number;
	label: string;
}

interface ArtboardGroup {
	n: number;
	/** Around all its pages, labels left out. */
	box: Rect;
	pages: Artboard[];
}

/** CSS pixels per PDF point. */
export const PX_PER_PT = 96 / 72;
/** Between pages of one version, and between versions. */
const PAGE_GAP = 48;
const GROUP_GAP = 200;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** The steps − and + move between. */
const STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Newest version first, left to right; each version's pages side by side,
 *  tops lined up. */
export function artboards(versions: readonly Pick<SheetVersion, "n" | "pages">[]): ArtboardGroup[] {
	let x = 0;
	return [...versions].reverse().map((v) => {
		const pages = v.pages.map((p, i) => {
			const w = p.widthPt * PX_PER_PT;
			const board: Artboard = { n: v.n, page: i, label: pageCaption(i, v.pages.length), x, y: 0, w, h: p.heightPt * PX_PER_PT };
			x += w + PAGE_GAP;
			return board;
		});
		x += GROUP_GAP - PAGE_GAP;
		return { n: v.n, box: bounds(pages)!, pages };
	});
}

/** The rectangle around several, or null for none. */
export function bounds(rects: readonly Rect[]): Rect | null {
	if (rects.length === 0) return null;
	const x = Math.min(...rects.map((r) => r.x));
	const y = Math.min(...rects.map((r) => r.y));
	const right = Math.max(...rects.map((r) => r.x + r.w));
	const bottom = Math.max(...rects.map((r) => r.y + r.h));
	return { x, y, w: right - x, h: bottom - y };
}

/** The camera that shows `box` whole and centered in the part of the view
 *  the panel leaves free, never past 100%. */
export function fitCamera(box: Rect, view: Rect, pad = 64): Camera {
	const zoom = clampZoom(Math.min(1, (view.w - 2 * pad) / box.w, (view.h - 2 * pad) / box.h));
	return {
		zoom,
		x: view.x + (view.w - box.w * zoom) / 2 - box.x * zoom,
		y: view.y + (view.h - box.h * zoom) / 2 - box.y * zoom,
	};
}

/** Zoom to `zoom`, keeping the world point under the screen point still. */
export function zoomAt(cam: Camera, zoom: number, at: { x: number; y: number }): Camera {
	const next = clampZoom(zoom);
	const k = next / cam.zoom;
	return { zoom: next, x: at.x - (at.x - cam.x) * k, y: at.y - (at.y - cam.y) * k };
}

/** The next step in or out from the zoom now (− and +). */
export function zoomStep(zoom: number, dir: 1 | -1): number {
	const eps = 0.001;
	return dir > 0 ? (STEPS.find((s) => s > zoom + eps) ?? MAX_ZOOM) : ([...STEPS].reverse().find((s) => s < zoom - eps) ?? MIN_ZOOM);
}

/** A wheel event's numbers. */
interface Wheel {
	deltaX: number;
	deltaY: number;
	/** 0 pixels, 1 lines, 2 pages. */
	deltaMode: number;
	/** A trackpad pinch arrives as a wheel with ctrlKey set. */
	ctrlKey: boolean;
	metaKey: boolean;
}

/** What a wheel does: a pinch or Ctrl/⌘ + scroll zooms toward the
 *  pointer, any other scroll pans. */
export function wheelCamera(cam: Camera, e: Wheel, at: { x: number; y: number }): Camera {
	const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
	if (e.ctrlKey || e.metaKey) return zoomAt(cam, cam.zoom * Math.exp((-e.deltaY * unit) / 300), at);
	return { ...cam, x: cam.x - e.deltaX * unit, y: cam.y - e.deltaY * unit };
}

/** "100%". */
export function zoomLabel(zoom: number): string {
	return `${Math.round(zoom * 100)}%`;
}

/** Where a world rectangle is on screen. */
export function onScreen(cam: Camera, r: Rect): Rect {
	return { x: r.x * cam.zoom + cam.x, y: r.y * cam.zoom + cam.y, w: r.w * cam.zoom, h: r.h * cam.zoom };
}

/** The part of a page that is on screen, in the page's own CSS pixels at
 *  100% (null when none of it is): what gets drawn sharp. */
export function visiblePart(cam: Camera, page: Rect, view: { w: number; h: number }): Rect | null {
	const s = onScreen(cam, page);
	const left = Math.max(0, s.x);
	const top = Math.max(0, s.y);
	const right = Math.min(view.w, s.x + s.w);
	const bottom = Math.min(view.h, s.y + s.h);
	if (right <= left || bottom <= top) return null;
	return { x: (left - s.x) / cam.zoom, y: (top - s.y) / cam.zoom, w: (right - left) / cam.zoom, h: (bottom - top) / cam.zoom };
}
