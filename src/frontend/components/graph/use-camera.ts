/**
 * The Graph picture's camera as the person moves it: the wheel or a pinch
 * zooms toward the pointer (a Mac's pinch arrives as gesture events), a drag
 * pans, and an Aim flies it, onto a topic as its figure is drawn. A flight is
 * short and eased, a jump with reduced motion, and any wheel, drag or new
 * flight stops it. The camera lives in `memory` too, so a picture mounted
 * again (a narrow window's panel closing) starts where it was.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { ownWheel } from "@/frontend/lib/own-wheel";
import type { Sky } from "./constellation-layout.ts";
import {
	between,
	camOnTopic,
	carryCam,
	easeOut,
	homeCam,
	isNear,
	panBy,
	pitchOf,
	topZoom,
	viewRect,
	wheelFactor,
	zoomAt,
	zoomed,
	type Aim,
	type Cam,
	type CameraMemory,
	type Frame,
	type Shot,
} from "./constellation-camera.ts";

const FLY_MS = 300;
/** WebKit's pinch: `scale` is the pinch's size against its start. Not in the DOM types. */
type Gesture = Event & { scale: number; clientX: number; clientY: number };
const GESTURES = ["gesturestart", "gesturechange", "gestureend"];
/** How far a press must move to become a drag, in screen points. */
const DRAG = 3;

export function useCamera({
	sky,
	placed,
	frame,
	nn,
	memory,
	aim,
	box,
}: {
	sky: Sky;
	/** The sky with each fact at its figure place, where a flight to a topic lands. */
	placed: Sky;
	frame: Frame;
	nn: number;
	memory: RefObject<CameraMemory>;
	aim: Aim | null;
	box: RefObject<HTMLDivElement | null>;
}) {
	const zMax = topZoom(nn, frame);
	const [shot, setShot] = useState<Shot>(() => {
		const was = memory.current.shot;
		return { sky, f: frame, nn, cam: was ? carryCam(was, { sky, f: frame, nn }, zMax) : homeCam(frame) };
	});
	let current = shot;
	// A re-fit (a panel docks or closes) keeps the camera on the same part of the sky at the same pitch.
	if (shot.sky !== sky || shot.f !== frame) {
		current = { sky, f: frame, nn, cam: carryCam(shot, { sky, f: frame, nn }, zMax) };
		setShot(current);
	}
	memory.current.shot = current;
	// Written with the state, so two moves before a render each start from the one before.
	const live = useRef(current);
	live.current = current;
	const setCam = useCallback((cam: Cam) => {
		const s = live.current;
		if (cam.z === s.cam.z && cam.x === s.cam.x && cam.y === s.cam.y) return;
		live.current = { ...s, cam };
		setShot(live.current);
	}, []);

	// The figure places, read when an Aim flies; a change to them alone does not fly again.
	const figure = useRef(placed);
	figure.current = placed;
	/** The last flight to a topic, so its figure can draw in once it lands. */
	const [landed, setLanded] = useState<{ topic: string; seq: number } | null>(null);

	const flight = useRef(0);
	const land = useCallback(() => {
		cancelAnimationFrame(flight.current);
		flight.current = 0;
	}, []);
	const flyTo = useCallback(
		(to: Cam) => {
			land();
			if (prefersReducedMotion()) return setCam(to);
			const { cam: from, ...on } = live.current;
			const start = performance.now();
			const tick = (now: number) => {
				// A re-fit mid-flight moves every point: the flight lands at once on its destination carried onto the new picture.
				const s = live.current;
				if (s.sky !== on.sky || s.f !== on.f) {
					flight.current = 0;
					return setCam(carryCam({ ...on, cam: to }, s, topZoom(s.nn, s.f)));
				}
				const t = Math.min(1, (now - start) / FLY_MS);
				setCam(t >= 1 ? to : between(from, to, easeOut(t)));
				flight.current = t < 1 ? requestAnimationFrame(tick) : 0;
			};
			flight.current = requestAnimationFrame(tick);
		},
		[land, setCam],
	);
	useEffect(() => land, [land]);

	// Each Aim flies once, after the re-fit its pick caused.
	useEffect(() => {
		const m = memory.current;
		if (!aim || aim.seq <= m.done) return;
		m.done = aim.seq;
		const now = live.current;
		const top = topZoom(now.nn, now.f);
		if (aim.to === "whole") {
			m.back = null;
			return flyTo(homeCam(now.f));
		}
		if (aim.to === "back") {
			const back = m.back;
			m.back = null;
			if (back) flyTo(carryCam(back, now, top));
			return;
		}
		const k = figure.current.byTopic.get(aim.id);
		if (!k) return;
		const star = aim.fact ? figure.current.starById.get(aim.fact) : undefined;
		const v = viewRect(now.cam, now.f);
		if (star && isNear(pitchOf(now.cam, now.f, now.nn), now.cam.z) && star.cx > v.x0 && star.cx < v.x1 && star.cy > v.y0 && star.cy < v.y1) return;
		m.back ??= now;
		setLanded({ topic: aim.id, seq: aim.seq });
		flyTo(camOnTopic(k, now.f, now.nn, top));
	}, [aim, memory, flyTo]);

	// The wheel and a pinch zoom toward the pointer, one step per frame; the page itself never scrolls.
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		let factor = 1;
		let at = { x: 0, y: 0 };
		let raf = 0;
		// The scale a pinch had at its last change; 0 with no pinch on.
		let pinch = 0;
		const zoomBy = (by: number, e: { clientX: number; clientY: number }) => {
			land();
			const r = el.getBoundingClientRect();
			at = { x: e.clientX - r.left, y: e.clientY - r.top };
			factor *= by;
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				const s = live.current;
				setCam(zoomAt(s.cam, s.f, factor, at.x, at.y, topZoom(s.nn, s.f)));
				factor = 1;
			});
		};
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			// WebKit sends a pinch as gesture events and as ctrl wheels too: it counts once.
			if (pinch && e.ctrlKey) return;
			zoomBy(wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), e);
		};
		const onGesture = (e: Event) => {
			e.preventDefault();
			const g = e as Gesture;
			if (e.type === "gesturestart") pinch = 1;
			else if (e.type === "gestureend") pinch = 0;
			else if (pinch) {
				zoomBy(g.scale / pinch, g);
				pinch = g.scale;
			}
		};
		const offWheel = ownWheel(el, onWheel);
		for (const t of GESTURES) el.addEventListener(t, onGesture);
		return () => {
			offWheel();
			for (const t of GESTURES) el.removeEventListener(t, onGesture);
			cancelAnimationFrame(raf);
		};
	}, [box, land, setCam]);

	// A press on the zoomed-in picture that moves is a drag: the picture follows the pointer and the click that ends it does nothing.
	const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
	const dragged = useRef(false);
	const [dragging, setDragging] = useState(false);
	const drag = {
		down(e: PointerEvent<HTMLDivElement>) {
			// A drag whose release was lost (outside the window) never swallows a later click.
			dragged.current = false;
			// A press on a topic's name pans too; one that does not move stays the name's click.
			if (e.button !== 0 || !zoomed(live.current.cam)) return;
			press.current = { x: e.clientX, y: e.clientY, moved: false };
		},
		/** True while the pointer drags the picture. */
		move(e: PointerEvent<HTMLDivElement>): boolean {
			const p = press.current;
			if (!p) return false;
			const dx = e.clientX - p.x;
			const dy = e.clientY - p.y;
			if (!p.moved && Math.hypot(dx, dy) < DRAG) return false;
			if (!p.moved) {
				p.moved = true;
				e.currentTarget.setPointerCapture?.(e.pointerId);
				setDragging(true);
			}
			land();
			p.x = e.clientX;
			p.y = e.clientY;
			const s = live.current;
			setCam(panBy(s.cam, s.f, dx, dy, topZoom(s.nn, s.f)));
			return true;
		},
		up(e: PointerEvent<HTMLDivElement>) {
			// A cancelled press is followed by no click, so only a release marks one to skip.
			if (press.current?.moved) {
				dragged.current = e.type === "pointerup";
				e.currentTarget.releasePointerCapture?.(e.pointerId);
			}
			press.current = null;
			setDragging(false);
		},
		/** True once for the click that ends a drag. */
		ended(): boolean {
			const was = dragged.current;
			dragged.current = false;
			return was;
		},
	};

	return { cam: current.cam, zoomed: zoomed(current.cam), zMax, flyTo, drag, dragging, landed };
}

