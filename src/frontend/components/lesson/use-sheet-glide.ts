import { useLayoutEffect, useState, type RefCallback } from "react";
import { EASE_OUT, prefersReducedMotion } from "@/frontend/components/presence";
import { glideMs, type Box } from "./sheet-glide-model";


const boxOf = (el: HTMLElement): Box => ({ width: el.offsetWidth, height: el.offsetHeight });
/** The window a sheet is laid out in: the app's, and the lesson's own window when the sheet scrolls in it (it changes size as the pinned
 *  "Your turn" does, and is laid out for a pinned one a moment after that one left). */
const roomOf = (el: HTMLElement) => {
	const lesson = el.closest(".lh-lesson-window");
	return `${window.innerWidth} ${window.innerHeight} ${lesson?.clientHeight ?? ""} ${lesson?.classList.contains("lh-lesson-pinned") ?? ""}`;
};

/** Watches the sheets it is given and glides each to its new height; `hold` says whether they take their sizes at once from now. */
function sheetGlide(): { ref: RefCallback<HTMLElement>; hold: (still: boolean) => void } {
	// Null until a sheet's size is first seen: where it stood before the page was laid out around it is no size to glide from.
	const seen = new Map<HTMLElement, { box: Box; room: string } | null>();
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
			const now = { box: boxOf(el), room: roomOf(el) };
			seen.set(el, now);
			if (!was) continue;
			if (was.room !== now.room) laidOutAnew();
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
		return () => {
			watch?.unobserve(el);
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
 * The ref for the lesson's sheets: each glides to its new height where it would jump (a reply
 * landing, the desk opening, a key arriving in "Your turn"). Sheets that change together glide
 * together, in the same time, so the gap between them holds. What a sheet holds is laid out at
 * its new size at once and the sheet's edge uncovers or covers it. While the book's pages are on
 * their way (`still`) the sheets take their sizes at once: that move lays them out itself. With
 * reduced motion nothing glides.
 */
export function useSheetGlide(still: boolean): RefCallback<HTMLElement> {
	const [glide] = useState(sheetGlide);
	// Before the sizes of this render are seen.
	useLayoutEffect(() => glide.hold(still), [glide, still]);
	return glide.ref;
}
