/**
 * The magnifier's math: a pinch magnifies the page at the pointer, the page
 * keeps its layout, and a scroll moves the part shown. Its camera
 * (lib/camera.ts) is in points of the page's room, and the shown part never
 * leaves the room.
 */
import { zoomAt, type Camera } from "@/frontend/lib/camera";

/** The event the desktop shell sends for a pinch. Must match PINCH in crates/shell/src/shim.js. */
export const PINCH = "lh-pinch";

/** A pinch: how much bigger (`by` above 1) or smaller, at a point of the window. */
export interface Pinch {
	by: number;
	x: number;
	y: number;
}

export interface Room {
	w: number;
	h: number;
}

export const UNMAGNIFIED: Camera = { x: 0, y: 0, zoom: 1 };

const MOST = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `cam` kept inside the room; at 100% or less nothing is magnified. */
export function keepInRoom(cam: Camera, room: Room): Camera {
	if (cam.zoom <= 1) return UNMAGNIFIED;
	const zoom = Math.min(MOST, cam.zoom);
	return { zoom, x: clamp(cam.x, room.w - room.w * zoom, 0), y: clamp(cam.y, room.h - room.h * zoom, 0) };
}

/** A pinch by `by` at `at`, a point of the room: what is under it stays under it. */
export function pinchAt(cam: Camera, by: number, at: { x: number; y: number }, room: Room): Camera {
	return keepInRoom(zoomAt(cam, clamp(cam.zoom * by, 1, MOST), at), room);
}

/** A scroll moves the shown part; null at the room's edge, where the scroll is the page's. */
export function panBy(cam: Camera, dx: number, dy: number, room: Room): Camera | null {
	const next = keepInRoom({ ...cam, x: cam.x - dx, y: cam.y - dy }, room);
	return next.x === cam.x && next.y === cam.y ? null : next;
}

/** The shown part, as parts of the room from 0 to 1. */
export function shownPart(cam: Camera, room: Room): { x: number; y: number; w: number; h: number } {
	return { x: -cam.x / (room.w * cam.zoom), y: -cam.y / (room.h * cam.zoom), w: 1 / cam.zoom, h: 1 / cam.zoom };
}

/** The shown part moved so its middle is at (`fx`, `fy`), parts of the room. */
export function centerOn(cam: Camera, fx: number, fy: number, room: Room): Camera {
	return keepInRoom({ ...cam, x: room.w / 2 - fx * room.w * cam.zoom, y: room.h / 2 - fy * room.h * cam.zoom }, room);
}
