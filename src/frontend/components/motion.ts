import { useLayoutEffect, useRef, type RefObject } from "react";

/** Replays an element's one-shot motion class (.lh-rise, .lh-block-in): the class is removed, a
 *  reflow restarts it, and it is put back. Reduced motion: those classes are inert, so this does
 *  nothing visible. */
function replay(el: HTMLElement | null, cls: string): void {
	if (!el) return;
	el.classList.remove(cls);
	void el.offsetWidth;
	el.classList.add(cls);
}

/** Plays `cls` on `ref` each time `key` changes — never on first mount
 *  and never on a plain re-render or streamed update. The
 *  element's own className must not carry `cls` (this owns it). */
export function useReplayOnChange(ref: RefObject<HTMLElement | null>, key: unknown, cls: string): void {
	const prev = useRef(key);
	useLayoutEffect(() => {
		if (Object.is(prev.current, key)) return;
		prev.current = key;
		replay(ref.current, cls);
	}, [ref, key, cls]);
}

/** A thing that joins a list after the list first drew (useArrivals): it steps in, once what left
 *  in the same moment has played its exit (--lh-dur-fast). */
export const JOINED = "lh-block-in [--lh-block-delay:var(--lh-dur-fast)]";
