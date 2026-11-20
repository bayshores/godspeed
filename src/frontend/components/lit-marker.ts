import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

const SIDES = ["left", "top", "width", "height"] as const;

/** The lit element's box inside the row, cut to what a scrolling strip around it shows. */
function litBox(row: HTMLElement, lit: Element): Box | null {
	const frame = row.getBoundingClientRect();
	let { left, right } = lit.getBoundingClientRect();
	const { top, height } = lit.getBoundingClientRect();
	for (let strip = lit.parentElement; strip && strip !== row; strip = strip.parentElement) {
		if (strip.scrollWidth <= strip.clientWidth) continue;
		const shown = strip.getBoundingClientRect();
		left = Math.max(left, shown.left);
		right = Math.min(right, shown.right);
	}
	return right > left && height > 0 ? { left: left - frame.left, top: top - frame.top, width: right - left, height } : null;
}

/**
 * The mark of the lit one of a row of tabs, as one box (.lh-lit-marker, the
 * ref this returns) that slides to it when another tab lights. When the row
 * is redrawn, resized or scrolled it follows at once. `row` holds the
 * marker and is positioned; `selector` finds the lit element in it; `lit`
 * names it.
 */
export function useLitMarker(row: RefObject<HTMLElement | null>, selector: string, lit: unknown): RefObject<HTMLDivElement | null> {
	const marker = useRef<HTMLDivElement>(null);
	const shown = useRef<{ lit: unknown; box: Box | null }>({ lit, box: null });
	const put = useCallback(
		(slide: boolean) => {
			const el = row.current;
			const mark = marker.current;
			if (!el || !mark) return;
			const target = el.querySelector(selector);
			const box = target && litBox(el, target);
			const was = shown.current.box;
			// Nothing moved: a slide on its way goes on.
			if (box && was ? SIDES.every((side) => Math.abs(box[side] - was[side]) < 0.5) : !box && !was) return;
			shown.current.box = box;
			mark.hidden = !box;
			if (!box) return;
			mark.toggleAttribute("data-slide", slide && !!was);
			for (const side of SIDES) mark.style[side] = `${box[side]}px`;
		},
		[row, selector],
	);
	useLayoutEffect(() => {
		const slide = !Object.is(shown.current.lit, lit);
		shown.current.lit = lit;
		put(slide);
	});
	useEffect(() => {
		const el = row.current;
		if (!el) return;
		const follow = () => put(false);
		const observer = new ResizeObserver(follow);
		observer.observe(el);
		for (const child of el.children) observer.observe(child);
		// Scrolling does not bubble: caught on its way down to a strip inside the row.
		el.addEventListener("scroll", follow, { capture: true, passive: true });
		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", follow, { capture: true });
		};
	}, [row, put]);
	return marker;
}
