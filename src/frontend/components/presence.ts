/**
 * usePresence: keeps an element mounted
 * long enough to play its exit animation. Pair the returned `state` with
 * the motion classes in src/frontend/globals.css (.lh-pop / .lh-dialog / .lh-fade
 * read data-state="open" | "closed").
 *
 *   const menu = usePresence(open);
 *   {menu.mounted && <div className="lh-pop" data-state={menu.state}>…</div>}
 *
 * Opening shows immediately; closing flips state to "closed", then
 * unmounts after `exitMs` (the --lh-dur-fast token, 110 ms). With reduced
 * motion on, it unmounts at once. First render returns the `open` value
 * as-is, so server and static renders match what callers render today.
 */

import { useEffect, useMemo, useState } from "react";

/** The motion tokens of globals.css, for animations and waits run from code: --lh-dur-fast, --lh-dur,
 *  --lh-dur-page, --lh-ease-out and --lh-ease-in. tests/frontend/motion-times.test.ts holds them equal. */
export const FAST_MS = 110;
export const DUR_MS = 160;
export const PAGE_MS = 420;
export const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
export const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

// One live query for the app's lifetime: .matches follows the OS setting,
// so hot callers (every fold, every countdown tick) skip a rebuild.
let reducedMotionQuery: MediaQueryList | null = null;

export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	reducedMotionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
	return reducedMotionQuery.matches;
}

export function usePresence(open: boolean, exitMs: number = FAST_MS): { mounted: boolean; state: "open" | "closed" } {
	const [mounted, setMounted] = useState(open);
	useEffect(() => {
		if (open) {
			setMounted(true);
			return;
		}
		if (!mounted) return;
		if (prefersReducedMotion() || exitMs <= 0) {
			setMounted(false);
			return;
		}
		const timer = setTimeout(() => setMounted(false), exitMs);
		return () => clearTimeout(timer);
	}, [open, mounted, exitMs]);
	return { mounted: open || mounted, state: open ? "open" : "closed" };
}

/** An item of a list held while it leaves. */
export type Leaving<T> = { item: T; leaving: boolean };

/** usePresence for a list: what leaves `items` stays `exitMs` more, after them, marked `leaving`,
 *  so its exit plays (.lh-fade with data-state="closed"). With reduced motion it goes at once. */
export function useLeavingList<T extends { key: string }>(items: readonly T[], exitMs: number = FAST_MS): Leaving<T>[] {
	const [last, setLast] = useState(items);
	const [gone, setGone] = useState<readonly T[]>([]);
	// Read in the render that drops it, so the leaving one is never missing for a frame.
	if (items !== last) {
		const kept = new Set(items.map((item) => item.key));
		const left = prefersReducedMotion() ? [] : last.filter((item) => !kept.has(item.key));
		const leftKeys = new Set(left.map((item) => item.key));
		setGone([...gone.filter((item) => !kept.has(item.key) && !leftKeys.has(item.key)), ...left]);
		setLast(items);
	}
	useEffect(() => {
		if (gone.length === 0) return;
		const timer = setTimeout(() => setGone([]), exitMs);
		return () => clearTimeout(timer);
	}, [gone, exitMs]);
	return useMemo(() => [...items.map((item) => ({ item, leaving: false })), ...gone.map((item) => ({ item, leaving: true }))], [items, gone]);
}
