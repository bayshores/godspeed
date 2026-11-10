import { useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";

/**
 * The highlight under a hovered row slides to it (globals.css,
 * .lh-hover-bar) instead of blinking on, like a cursor moving down a list.
 * Rows carry data-row and sit above the bar (position: relative); the
 * list is position: relative, takes `ref` and the two handlers, and
 * renders `bar` first.
 */
export function useHoverBar<T extends HTMLElement>(): {
	ref: RefObject<T | null>;
	onPointerOver: (e: PointerEvent<T>) => void;
	onPointerLeave: () => void;
	bar: ReactNode;
} {
	const ref = useRef<T>(null);
	const [at, setAt] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [inside, setInside] = useState(false);
	return {
		ref,
		onPointerOver: (e) => {
			const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
			if (!row || !ref.current?.contains(row) || row.matches(":disabled")) return;
			setInside(true);
			setAt({ top: row.offsetTop, left: row.offsetLeft, width: row.offsetWidth, height: row.offsetHeight });
		},
		onPointerLeave: () => setInside(false),
		bar: at && <span aria-hidden className="lh-hover-bar" style={{ transform: `translateY(${at.top}px)`, left: at.left, width: at.width, height: at.height, opacity: inside ? 1 : 0 }} />,
	};
}
