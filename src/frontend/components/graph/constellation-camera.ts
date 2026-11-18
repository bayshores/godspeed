/**
 * The Graph picture's camera: how far in it is zoomed and where it looks.
 * Zoom 1 is the fitted picture; zooming in spreads the stars apart on screen,
 * and once neighbouring stars are far enough apart (the pitch) the picture is
 * near and each topic shows as its figure. The view never leaves the
 * picture. Pure.
 */
import { NAME_GAP, NAME_LINE, type Cluster, type Rect, type Sky } from "./constellation-layout.ts";

/** `x`, `y`: the layout point at the view's centre. */
export interface Cam {
	z: number;
	x: number;
	y: number;
}

/** The picture's box on screen (as wide as the fitted picture, as tall as its room), the fit scale and the laid-out picture's size. */
export interface Frame {
	w: number;
	h: number;
	scale: number;
	skyW: number;
	skyH: number;
}

/** A camera with the picture it looks at, so it can be carried onto the picture laid out again. */
export interface Shot {
	sky: Sky;
	f: Frame;
	/** The usual star gap, in layout points. */
	nn: number;
	cam: Cam;
}

/** Where the camera is asked to fly: into a topic (unless already near on the fact), to the whole space, or back to where it was before the first fly-in. */
export type Flight = { to: "topic"; id: string; fact: string | null } | { to: "whole" } | { to: "back" };
/** A flight asked for, numbered so each flies once. */
export type Aim = Flight & { seq: number };

/** What outlives the picture while a narrow window shows a panel in its place. */
export interface CameraMemory {
	shot: Shot | null;
	/** The view before the first fly-in of the open pick, null at none. */
	back: Shot | null;
	/** The last Aim flown, so a picture mounted again does not fly it twice. */
	done: number;
}

/** Layout to screen: screen = layout * k + t. */
interface Proj {
	k: number;
	tx: number;
	ty: number;
}

/** A star is never drawn bigger than this on screen; only the gaps keep growing. */
export const STAR_CAP = 12;
/** The pitch, in screen points, from which the picture is near: each topic shows as its figure. */
const NEAR_PITCH = 28;
/** The pitch from which facts are moons; a flight into a topic lands at least this close. */
export const MOON_PITCH = 44;
/** A flight into a topic never lands closer than this, so the topic keeps its facts close together. */
const FLY_PITCH = 72;
/** The deepest zoom: neighbouring stars this far apart on screen. */
const TOP_PITCH = 92;
/** Topic names start moving down to their figures from this share of the near pitch. */
const KEEP = 0.75;
/** A flight to a topic fits its disc to this share of the box's shorter side. */
const FILL = 0.6;

/** The whole space, at its top left: the box may be taller than the fitted picture, never smaller. */
export const homeCam = (f: Frame): Cam => ({ z: 1, x: f.w / 2 / f.scale, y: f.h / 2 / f.scale });

export const zoomed = (c: Cam) => c.z > 1.001;

export function project(c: Cam, f: Frame): Proj {
	const k = f.scale * c.z;
	return { k, tx: f.w / 2 - c.x * k, ty: f.h / 2 - c.y * k };
}

export function toLayout(p: Proj, sx: number, sy: number): { x: number; y: number } {
	return { x: (sx - p.tx) / p.k, y: (sy - p.ty) / p.k };
}

/** The part of the picture in view, in layout points, grown by `margin` screen points. */
export function viewRect(c: Cam, f: Frame, margin = 0): Rect {
	const k = f.scale * c.z;
	const hw = (f.w / 2 + margin) / k;
	const hh = (f.h / 2 + margin) / k;
	return { x0: c.x - hw, x1: c.x + hw, y0: c.y - hh, y1: c.y + hh };
}

/** Zoom kept between 1 and `zMax`, and the view kept inside the picture; a picture smaller than the box keeps to its top left. */
function clampCam(c: Cam, f: Frame, zMax: number): Cam {
	const z = Math.min(zMax, Math.max(1, c.z));
	const k = f.scale * z;
	const keep = (v: number, half: number, size: number) => (2 * half >= size ? half : Math.min(size - half, Math.max(half, v)));
	return { z, x: keep(c.x, f.w / 2 / k, f.skyW), y: keep(c.y, f.h / 2 / k, f.skyH) };
}

/** Zoom by `factor` keeping the layout point under the screen point (sx, sy) where it is, like a map. */
export function zoomAt(c: Cam, f: Frame, factor: number, sx: number, sy: number, zMax: number): Cam {
	const at = toLayout(project(c, f), sx, sy);
	const z = Math.min(zMax, Math.max(1, c.z * factor));
	const k = f.scale * z;
	return clampCam({ z, x: at.x - (sx - f.w / 2) / k, y: at.y - (sy - f.h / 2) / k }, f, zMax);
}

/** Move the view by a drag of (dx, dy) screen points: the picture follows the pointer. */
export function panBy(c: Cam, f: Frame, dx: number, dy: number, zMax: number): Cam {
	const k = f.scale * c.z;
	return clampCam({ z: c.z, x: c.x - dx / k, y: c.y - dy / k }, f, zMax);
}

const zoomForPitch = (pitch: number, nn: number, f: Frame) => pitch / (nn * f.scale);

export const topZoom = (nn: number, f: Frame) => Math.max(1, zoomForPitch(TOP_PITCH, nn, f));

export const pitchOf = (c: Cam, f: Frame, nn: number) => nn * f.scale * c.z;

/** Whether the picture is near, so each topic shows as its figure; the fitted picture never is. */
export const isNear = (pitch: number, z: number) => z > 1.001 && pitch >= NEAR_PITCH;

/** 0 well short of near, 1 once near, evenly between: topic names move this share of the way from their discs to under their figures. */
export function nearRamp(pitch: number, z: number): number {
	if (z <= 1.001) return 0;
	return Math.min(1, Math.max(0, (pitch - NEAR_PITCH * KEEP) / (NEAR_PITCH * (1 - KEEP))));
}

/** Room kept above a topic's top star when the topic is taller than the box. */
const TOP_ROOM = 8;

/**
 * Where a flight to a topic lands: the zoom at which its disc fills FILL of
 * the box's shorter side, between MOON_PITCH and FLY_PITCH and never past
 * `zMax`, with room under it for its name. A topic taller than the box keeps
 * its top stars in view.
 */
export function camOnTopic(k: Cluster, f: Frame, nn: number, zMax: number): Cam {
	const d = 2 * k.r;
	const below = NAME_GAP + k.text.length * NAME_LINE;
	const z = Math.min(zMax, zoomForPitch(FLY_PITCH, nn, f), Math.max(zoomForPitch(MOON_PITCH, nn, f), (FILL * Math.min(f.w, f.h)) / d / f.scale));
	const kz = f.scale * z;
	const top = Math.min(k.cy, ...k.stars.map((st) => st.cy));
	const y = d * kz + below > f.h - 2 * TOP_ROOM ? top + (f.h / 2 - TOP_ROOM - STAR_CAP / 2) / kz : k.cy + below / 2 / kz;
	return clampCam({ z, x: k.cx, y }, f, zMax);
}

/** The least move that brings a layout rect into view (with `pad` screen points of room); the same camera when it is in. */
export function camShowing(c: Cam, f: Frame, r: Rect, pad: number, zMax: number): Cam {
	const v = viewRect(c, f, -pad);
	const shift = (lo: number, hi: number, v0: number, v1: number) => (hi - lo > v1 - v0 ? (lo + hi) / 2 - (v0 + v1) / 2 : lo < v0 ? lo - v0 : hi > v1 ? hi - v1 : 0);
	const dx = shift(r.x0, r.x1, v.x0, v.x1);
	const dy = shift(r.y0, r.y1, v.y0, v.y1);
	return dx === 0 && dy === 0 ? c : clampCam({ z: c.z, x: c.x + dx, y: c.y + dy }, f, zMax);
}

/** A step of a flight from `a` to `b` at `t` (0 to 1): zoom changes evenly in ratio, the centre so the target point moves steadily onto it. */
export function between(a: Cam, b: Cam, t: number): Cam {
	const z = a.z * (b.z / a.z) ** t;
	// The share of the way the centre has gone, measured on screen, so a deep zoom does not drift past its target.
	const s = Math.abs(a.z - b.z) < 1e-6 ? t : (1 / a.z - 1 / z) / (1 / a.z - 1 / b.z);
	return { z, x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
}

export const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** One wheel event's zoom factor, at the speed of the app's other zoomable view. A pinch in a webview without gesture events arrives as a wheel with ctrlKey and small deltas, so it counts for more. */
export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
	const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
	return Math.exp(-px * (pinch ? 0.01 : 0.0015));
}

/** Stars per topic measured for the usual gap: the sunflower's spacing is even, so a sample gives the same median as every star. */
const PITCH_SAMPLE = 64;

/** The usual gap between a star and its nearest neighbour, in layout points: the median over a sample of stars with one. */
export function starPitch(sky: Pick<Sky, "clusters" | "s">): number {
	const gaps: number[] = [];
	for (const k of sky.clusters) {
		const step = Math.max(1, Math.floor(k.stars.length / PITCH_SAMPLE));
		for (let i = 0; i < k.stars.length; i += step) {
			const a = k.stars[i]!;
			let best = Infinity;
			for (const b of k.stars) if (b !== a) best = Math.min(best, Math.hypot(a.cx - b.cx, a.cy - b.cy));
			if (best < Infinity) gaps.push(best);
		}
	}
	if (gaps.length === 0) return sky.s * 2;
	gaps.sort((a, b) => a - b);
	return gaps[Math.floor(gaps.length / 2)]!;
}

/**
 * A shot's camera on the picture laid out again (a panel docked or closed):
 * centred on the same point relative to the nearest topic, at the same
 * pitch, so near stays near. The whole space stays the whole space.
 */
export function carryCam(from: Shot, to: Omit<Shot, "cam">, zMax: number): Cam {
	const c = from.cam;
	if (!zoomed(c)) return homeCam(to.f);
	let near: Cluster | null = null;
	let bd = Infinity;
	for (const k of from.sky.clusters) {
		const d = Math.hypot(k.cx - c.x, k.cy - c.y);
		if (d < bd) [bd, near] = [d, k];
	}
	const z = zoomForPitch(pitchOf(c, from.f, from.nn), to.nn, to.f);
	const there = near && to.sky.byTopic.get(near.topic.id);
	if (!near || !there) return clampCam({ z, x: c.x, y: c.y }, to.f, zMax);
	const r = to.nn / from.nn;
	return clampCam({ z, x: there.cx + (c.x - near.cx) * r, y: there.cy + (c.y - near.cy) * r }, to.f, zMax);
}

