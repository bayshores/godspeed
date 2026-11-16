import { useEffect } from "react";

/** A fade is at most this long, and at most a quarter of the element, so a short one keeps text between its fades. */
const FADE = 48;

/** Sets the element's top and bottom fade lengths (`.lh-scroll-fade`) from how much text is cut off at each edge. */
export function useScrollFade(element: HTMLElement | null) {
	useEffect(() => {
		if (!element) return;
		const set = () => {
			const fade = Math.min(FADE, element.clientHeight / 4);
			const below = Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop);
			element.style.setProperty("--lh-fade-top", `${Math.min(element.scrollTop, fade)}px`);
			element.style.setProperty("--lh-fade-bottom", `${Math.min(below, fade)}px`);
		};
		const sizes = new ResizeObserver(set);
		const watch = () => {
			sizes.disconnect();
			sizes.observe(element);
			for (const child of element.children) sizes.observe(child);
			set();
		};
		const children = new MutationObserver(watch);
		children.observe(element, { childList: true });
		element.addEventListener("scroll", set, { passive: true });
		watch();
		return () => {
			element.removeEventListener("scroll", set);
			sizes.disconnect();
			children.disconnect();
		};
	}, [element]);
}
