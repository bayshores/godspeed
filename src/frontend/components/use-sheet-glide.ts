import { useLayoutEffect, useState, type RefCallback } from "react";
import { EASE_OUT, prefersReducedMotion } from "@/frontend/components/presence";
import { glideMs, type Box } from "./sheet-glide-model";

const boxOf = (el: HTMLElement): Box => ({ width: el.offsetWidth, height: el.offsetHeight });
/** The window a sheet is laid out in. `key` changes when that window is laid out anew; `windowHeight` is the height of a
 *  window of the page's own a sheet scrolls in (a page that has one), which a sheet in it is carried along by. */
export interface SheetRoom {
	key: (el: HTMLElement) => string;
	windowHeight: (el: HTMLElement) => number | null;
}

/** The app's window alone. */
export const APP_ROOM: SheetRoom = { key: () => `${window.innerWidth} ${window.innerHeight}`, windowHeight: () => null };

/** The sheets being watched, each with its glide's reading of them. */
const watched = new WeakMap<Element, () => void>();

/**
 * Reads the sheet around `el` now, before the frame is drawn: for a change that lands whole (a problem folding), which WebKit would
 * draw at its new size for a frame before the resize watch starts the glide.
 */
export function glideSheetAround(el: Element): void {
	for (let at: Element | null = el; at; at = at.parentElement) {
		const read = watched.get(at);
		if (read) return read();
	}
}

/**
 * Watches the sheets it is given and glides each to its new height; `hold` says whether they take their sizes at once from now.
 * `early` also reads a sheet as soon as what it holds changes, before the frame is drawn: WebKit draws a size the resize watch
 * reports first and a glide started there only from the next frame, so a sheet whose content is swapped whole would snap.
 */
function sheetGlide(early: boolean, room: SheetRoom): { ref: RefCallback<HTMLElement>; hold: (still: boolean) => void } {
	// Null until a sheet's size is first seen: where it stood before the page was laid out around it is no size to glide from.
	const seen = new Map<HTMLElement, { box: Box; room: string; window: number | null } | null>();
	const gliding = new Map<HTMLElement, Animation>();
	let watch: ResizeObserver | null = null;
	let still = false;
	// A window that changed lays the sheets out more than once before the next frame (the height kept while
	// the teacher works is given up after the first), and none of it glides.
	let anew = false;
	const laidOutAnew = () => {
		if (anew) return;
		anew = true;
		requestAnimationFrame(() => (anew = false));
	};
	const hold = (now: boolean) => {
		still = now;
		if (still) for (const glide of gliding.values()) glide.finish();
	};
	const resized = () => {
		const moves: { el: HTMLElement; from: number; to: number; ms: number }[] = [];
		for (const [el, was] of seen) {
			// The sizes a glide passes through are its own.
			if (gliding.has(el)) continue;
			const now = { box: boxOf(el), room: room.key(el), window: room.windowHeight(el) };
			seen.set(el, now);
			if (!was) continue;
			if (was.room !== now.room) laidOutAnew();
			// The lesson's window follows the pinned "Your turn", which glides: a sheet in that window is carried along.
			if (was.window !== now.window) continue;
			const ms = glideMs(was.box, now.box, !anew);
			if (ms !== null) moves.push({ el, from: was.box.height, to: now.box.height, ms });
		}
		if (moves.length === 0 || still || prefersReducedMotion()) return;
		const duration = Math.max(...moves.map((move) => move.ms));
		for (const { el, from, to } of moves) {
			el.style.overflow = "clip";
			const glide = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: EASE_OUT });
			gliding.set(el, glide);
			// At rest the sheet takes the height of what it holds now; if that changed meanwhile, it glides on from here.
			const rest = () => {
				if (gliding.get(el) !== glide) return;
				gliding.delete(el);
				el.style.overflow = "";
			};
			glide.finished.then(rest, rest);
		}
	};
	const ref: RefCallback<HTMLElement> = (el) => {
		if (!el || typeof ResizeObserver === "undefined" || typeof el.animate !== "function") return;
		watch ??= new ResizeObserver(resized);
		seen.set(el, null);
		watch.observe(el);
		watched.set(el, resized);
		const edits = early ? new MutationObserver(resized) : null;
		edits?.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
		return () => {
			edits?.disconnect();
			watch?.unobserve(el);
			watched.delete(el);
			seen.delete(el);
			const glide = gliding.get(el);
			gliding.delete(el);
			glide?.cancel();
			el.style.overflow = "";
		};
	};
	return { ref, hold };
}

/**
 * The ref for sheets that glide to a new height where they would jump (in a lesson: a reply
 * landing, the desk opening, a key arriving in "Your turn"; on the Graph: one panel replacing
 * another in the slip). Sheets that change together glide together, in the same time, so the gap
 * between them holds. What a sheet holds is laid out at its new size at once and the sheet's edge
 * uncovers or covers it. While the book's pages are on their way (`still`) the sheets take their
 * sizes at once: that move lays them out itself. With reduced motion nothing glides.
 */
export function useSheetGlide(still: boolean, early = false, room: SheetRoom = APP_ROOM): RefCallback<HTMLElement> {
	const [glide] = useState(() => sheetGlide(early, room));
	// Before the sizes of this render are seen.
	useLayoutEffect(() => glide.hold(still), [glide, still]);
	return glide.ref;
}
