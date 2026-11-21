import { useState, type RefCallback } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { glideMs, type Box } from "./sheet-glide-model";

/** The app's curve for a thing that enters (--lh-ease-out). */
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

const boxOf = (el: HTMLElement): Box => ({ width: el.offsetWidth, height: el.offsetHeight });
/** The window a sheet is laid out in: the app's, and the lesson's own window when the sheet scrolls in it (it changes size as the pinned "Your turn" does). */
const roomOf = (el: HTMLElement) => `${window.innerWidth} ${window.innerHeight} ${el.closest(".lh-lesson-window")?.clientHeight ?? ""}`;

/** Watches the sheets it is given and glides each to its new height. */
function sheetGlide(): RefCallback<HTMLElement> {
	const seen = new Map<HTMLElement, { box: Box; room: string }>();
	const gliding = new Map<HTMLElement, Animation>();
	let watch: ResizeObserver | null = null;
	const resized = () => {
		const moves: { el: HTMLElement; from: number; to: number; ms: number }[] = [];
		for (const [el, was] of seen) {
			// The sizes a glide passes through are its own.
			if (gliding.has(el)) continue;
			const now = { box: boxOf(el), room: roomOf(el) };
			seen.set(el, now);
			const ms = glideMs(was.box, now.box, was.room === now.room);
			if (ms !== null) moves.push({ el, from: was.box.height, to: now.box.height, ms });
		}
		if (moves.length === 0 || prefersReducedMotion()) return;
		const duration = Math.max(...moves.map((move) => move.ms));
		for (const { el, from, to } of moves) {
			el.style.overflow = "clip";
			const glide = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: EASING });
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
	return (el) => {
		if (!el || typeof ResizeObserver === "undefined" || typeof el.animate !== "function") return;
		watch ??= new ResizeObserver(resized);
		seen.set(el, { box: boxOf(el), room: roomOf(el) });
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
}

/**
 * The ref for the lesson's sheets: each glides to its new height where it would jump (a reply
 * landing, the desk opening, a key arriving in "Your turn"). Sheets that change together glide
 * together, in the same time, so the gap between them holds. What a sheet holds is laid out at
 * its new size at once and the sheet's edge uncovers or covers it. With reduced motion nothing
 * glides.
 */
export function useSheetGlide(): RefCallback<HTMLElement> {
	return useState(sheetGlide)[0];
}
