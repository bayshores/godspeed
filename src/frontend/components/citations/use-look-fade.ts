import { useLayoutEffect, useRef, type RefObject } from "react";
import { DUR_MS as FADE_MS, EASE_OUT, prefersReducedMotion } from "@/frontend/components/presence";

/** The longest the old look waits for the new pictures before it fades anyway. */
const WAIT_MS = 1500;

/** A copy only to look at: nothing finds it, nothing reads it twice. */
function stillCopy(el: HTMLElement): HTMLElement {
	const copy = el.cloneNode(true) as HTMLElement;
	for (const old of copy.querySelectorAll("[data-still]")) old.remove();
	for (const part of [copy, ...copy.querySelectorAll("[data-testid], [id]")]) {
		part.removeAttribute("data-testid");
		part.removeAttribute("id");
	}
	copy.setAttribute("data-still", "");
	copy.setAttribute("aria-hidden", "true");
	Object.assign(copy.style, { position: "absolute", inset: "0", pointerEvents: "none" });
	return copy;
}

/**
 * Cross-fades the element `ref` holds when `look` changes: a still copy of how it looked lies over
 * it until its new pictures have loaded (SteadyImg marks one loading with data-loading), then fades
 * out. With reduced motion the new look is just there.
 */
export function useLookFade(ref: RefObject<HTMLElement | null>, look: unknown) {
	// The copy is taken while the element still looks the old way.
	const last = useRef(look);
	const copy = useRef<HTMLElement | null>(null);
	if (last.current !== look) {
		last.current = look;
		copy.current = ref.current && !prefersReducedMotion() ? stillCopy(ref.current) : null;
	}
	useLayoutEffect(() => {
		const el = ref.current;
		const still = copy.current;
		copy.current = null;
		if (!el || !still || typeof still.animate !== "function") return;
		el.append(still);
		const start = performance.now();
		const loading = () => [...el.children].some((part) => part !== still && part.querySelector("[data-loading]"));
		let frame = 0;
		const wait = () => {
			if (loading() && performance.now() - start < WAIT_MS) {
				frame = requestAnimationFrame(wait);
				return;
			}
			const fade = still.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE_OUT, fill: "forwards" });
			fade.finished.then(() => still.remove(), () => still.remove());
		};
		frame = requestAnimationFrame(wait);
		return () => {
			cancelAnimationFrame(frame);
			still.remove();
		};
		// The element is the same for the component's life.
	}, [look]);
}
