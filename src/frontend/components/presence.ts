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
 *  --lh-dur-slow, --lh-dur-page, --lh-ease-out and --lh-ease-in. tests/frontend/motion-times.test.ts
 *  holds them equal. */
export const FAST_MS = 110;
export const DUR_MS = 160;
export const SLOW_MS = 220;
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

/** A leaving item and the kept item it follows (null: the list's start). */
type Gone<T> = { item: T; after: string | null };

function withGone<T extends { key: string }>(items: readonly T[], gone: readonly Gone<T>[]): Leaving<T>[] {
	const after = (key: string | null) => gone.filter((g) => g.after === key).map((g) => ({ item: g.item, leaving: true }));
	return [...after(null), ...items.flatMap((item) => [{ item, leaving: false }, ...after(item.key)])];
}

/** usePresence for a list: what leaves `items` stays `exitMs` more in its place, marked `leaving`,
 *  so its exit plays (.lh-fade with data-state="closed"). With reduced motion it goes at once.
 *  `items` keeps its identity between renders while it holds the same things (useMemo). */
export function useLeavingList<T extends { key: string }>(items: readonly T[], exitMs: number = FAST_MS): Leaving<T>[] {
	const [last, setLast] = useState(items);
	const [gone, setGone] = useState<readonly Gone<T>[]>([]);
	// Read in the render that drops it, so the leaving one is never missing for a frame.
	if (items !== last) {
		const kept = new Set(items.map((item) => item.key));
		const next: Gone<T>[] = [];
		if (!prefersReducedMotion()) {
			let after: string | null = null;
			for (const { item } of withGone(last, gone)) {
				if (kept.has(item.key)) after = item.key;
				else next.push({ item, after });
			}
		}
		setGone(next);
		setLast(items);
	}
	useEffect(() => {
		if (gone.length === 0) return;
		const timer = setTimeout(() => setGone([]), exitMs);
		return () => clearTimeout(timer);
	}, [gone, exitMs]);
	return useMemo(() => withGone(items, gone), [items, gone]);
}
