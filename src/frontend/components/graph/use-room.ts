/**
 * The room the Graph page gives its picture and panel, kept current: its
 * width, the height from its top to the foot line, and how far the page
 * reaches past its left, right and top. The page never scrolls.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { FOOT } from "./graph-foot.tsx";

/** The room before it is measured: the page's widest column, less its sides. */
const WIDEST = 1192;
const TALLEST = 600;
/** The least height the room reports, however short the window. */
const LEAST = 120;
/** The room kept between the picture and the foot line. */
const ABOVE_FOOT = 16;

export type Room = ReturnType<typeof useRoom>;

export function useRoom() {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: WIDEST, height: TALLEST, edges: { left: 0, right: 0, top: 0 } });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const page = (el.closest("[data-testid=graph-page]") ?? document.documentElement).getBoundingClientRect();
			const box = el.getBoundingClientRect();
			const height = Math.max(LEAST, Math.floor(page.bottom - box.top - ABOVE_FOOT - FOOT));
			const edges = { left: Math.round(box.left - page.left), right: Math.round(page.right - box.right), top: Math.round(box.top - page.top) };
			const same = (o: typeof size) => o.width === el.clientWidth && o.height === height && o.edges.left === edges.left && o.edges.right === edges.right && o.edges.top === edges.top;
			if (el.clientWidth > 0) setSize((o) => (same(o) ? o : { width: el.clientWidth, height, edges }));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		if (el.parentElement) ro.observe(el.parentElement);
		window.addEventListener("resize", measure);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return { ref, ...size };
}
