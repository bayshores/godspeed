import { useEffect, useState } from "react";

/** The page's room above its first sheet and below its last (overview-body's pt and pb). */
const TOP = 22;
const FOOT = 36;

function scrollerOf(el: HTMLElement): HTMLElement | null {
	for (let up = el.parentElement; up; up = up.parentElement) {
		if (/auto|scroll/.test(getComputedStyle(up).overflowY)) return up;
	}
	return null;
}

/**
 * Where a sticky column stops as its page scrolls: 22 points under the
 * scroller's top while it fits in the window, else with its foot 36 points
 * above the window's, so every part of a tall column can still be scrolled
 * to. Give the column's element to the setter.
 */
export function useStickyTop(): [(el: HTMLElement | null) => void, number] {
	const [el, setEl] = useState<HTMLElement | null>(null);
	const [top, setTop] = useState(TOP);
	useEffect(() => {
		const scroller = el && scrollerOf(el);
		if (!el || !scroller) return;
		const place = () => setTop(Math.min(TOP, scroller.clientHeight - el.offsetHeight - FOOT));
		const watch = new ResizeObserver(place);
		watch.observe(el);
		watch.observe(scroller);
		return () => watch.disconnect();
	}, [el]);
	return [setEl, top];
}
