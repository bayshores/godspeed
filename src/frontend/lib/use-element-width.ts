import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** An element's width, followed as it resizes; `initial` holds until it is measured. */
export function useElementWidth<T extends HTMLElement>(initial: number): [number, RefObject<T | null>] {
	const ref = useRef<T | null>(null);
	const [width, setWidth] = useState(initial);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const observer = new ResizeObserver(() => setWidth(el.clientWidth));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return [width, ref];
}
