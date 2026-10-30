import { useLayoutEffect, useRef, type RefObject } from "react";

/** Replays an element's one-shot .lh-rise: the class is removed, a reflow
 *  restarts it, and it is put back. Reduced motion: .lh-rise is inert, so
 *  this does nothing visible. */
export function replayRise(el: HTMLElement | null): void {
	if (!el) return;
	el.classList.remove("lh-rise");
	void el.offsetWidth;
	el.classList.add("lh-rise");
}

/** Plays .lh-rise on `ref` each time `key` changes — never on first mount
 *  and never on a plain re-render or streamed update. The
 *  element's own className must not carry lh-rise (this owns it). */
export function useRiseOnChange(ref: RefObject<HTMLElement | null>, key: unknown): void {
	const prev = useRef(key);
	useLayoutEffect(() => {
		if (Object.is(prev.current, key)) return;
		prev.current = key;
		replayRise(ref.current);
	}, [ref, key]);
}
