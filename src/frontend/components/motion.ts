import { useLayoutEffect, useRef, type RefObject } from "react";
import { cn } from "@/frontend/lib/utils";

/** Replays an element's one-shot motion class (.lh-rise, .lh-block-in): a class already on it is
 *  removed and a reflow restarts it, then it is put on. An element that has not worn it yet only
 *  takes it, so many boxes marked at once (a whole list ticked) cost no reflow each. Reduced
 *  motion: those classes are inert, so this does nothing visible. */
function replay(el: HTMLElement | null, cls: string): void {
	if (!el) return;
	if (el.classList.contains(cls)) {
		el.classList.remove(cls);
		void el.offsetWidth;
	}
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

/** A line or a row that comes under a key or a form (an error, a question), held by presence: it
 *  rises in, and fades out taking no click or focus. */
export function riseMotion(state: "open" | "closed", className?: string): { "data-state": "open" | "closed"; inert?: boolean; className: string } {
	return { "data-state": state, inert: state === "closed" || undefined, className: cn(state === "open" ? "lh-rise" : "lh-fade", className) };
}

/** A row or a card of a list held by useLeavingList: leaving, it fades out and takes no click or
 *  focus; joined after the list first drew, it steps in (JOINED). At rest it adds nothing. */
export function rowMotion(leaving: boolean, joined: boolean, className?: string): { "data-state"?: "closed"; inert?: boolean; className?: string } {
	return { "data-state": leaving ? "closed" : undefined, inert: leaving || undefined, className: cn(className, leaving ? "lh-fade" : joined && JOINED) || undefined };
}
