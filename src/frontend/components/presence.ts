/**
 * usePresence: keeps an element mounted
 * long enough to play its exit animation. Pair the returned `state` with
 * the motion classes in src/frontend/globals.css (.lh-pop / .lh-hang / .lh-fade
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/** Keeps a closing thing on screen with its last `value` while it fades out (usePresence, with the
 *  words or the record it showed). */
export function useLastWhileClosing<T>(value: T | null): { mounted: boolean; state: "open" | "closed"; shown: T | null } {
	const presence = usePresence(value !== null);
	const [last, setLast] = useState(value);
	if (value !== null && value !== last) setLast(value);
	return { mounted: presence.mounted, state: presence.state, shown: value ?? last };
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

/* ARRIVAL MOTION: a message or card that
 * appears DURING the live session rises in once (.lh-rise). Whatever the
 * first render shows — a reopened lesson — never animates. Slots are keyed
 * by POSITION (message index, part index), not id: an optimistic message
 * that later swaps its local id for the server's keeps its slot, so the
 * remount never replays. The teacher's words are drawn as they are
 * written, so they need no arrival; reasoning is left alone. */
const ARRIVAL_WINDOW_MS = 400;

export type Arrive = (slot: string) => string | undefined;

/** `drawn`: false while what the slots belong to waits for its data, so what its first drawing
 *  holds stays at rest; a list of deadlines steps in a row that joins it later. */
export function useArrivals(drawn = true): Arrive {
	const firstSeen = useRef(new Map<string, number | null>());
	const live = useRef(false);
	useEffect(() => {
		if (drawn) live.current = true;
	}, [drawn]);
	return useCallback((slot: string) => {
		const now = performance.now();
		let at = firstSeen.current.get(slot);
		if (at === undefined) {
			at = live.current ? now : null; // null: there at first render
			firstSeen.current.set(slot, at);
		}
		return at !== null && now - at < ARRIVAL_WINDOW_MS ? "lh-rise" : undefined;
	}, []);
}

/** How a row of a list moves: `leaving` while it fades out in its place, `joined` when it came
 *  after the list first drew (rowMotion). */
export type Moves = { leaving: boolean; joined: boolean };

/** The motion of one list: `items` (keyed, stable between renders, as useLeavingList asks), each
 *  with how it moves. `drawn`: false while the list waits for its data, so what its first drawing
 *  holds stays at rest. `seen`: keys the list may show later without stepping in ("Show all"). */
export function useListMotion<T extends { key: string }>(
	items: readonly T[],
	{ drawn = true, seen = [] }: { drawn?: boolean; seen?: readonly string[] } = {},
): (Moves & { item: T })[] {
	const held = useLeavingList(items);
	const arrive = useArrivals(drawn);
	for (const key of seen) arrive(key);
	return useMemo(() => held.map(({ item, leaving }) => ({ item, leaving, joined: !leaving && !!arrive(item.key) })), [held, arrive]);
}

/** How long what just happened counts as just now: time for the page to read it back and for its
 *  mark to print (tests/frontend/motion-times.test.ts holds it no shorter than that). */
export const MOMENT_MS = 2 * PAGE_MS;

/**
 * What just happened, by its id, for the moment its mark plays: set it where the thing happens (an
 * answer sent, a deadline saved as done), and it is null again after MOMENT_MS. Whatever is drawn
 * without it having been set is at rest, however it came to be drawn (a page opening, a window
 * resized, a row moved to another list).
 */
export function useJustNow(): [string | null, (id: string | null) => void] {
	const [id, setId] = useState<string | null>(null);
	useEffect(() => {
		if (id === null) return;
		const timer = setTimeout(() => setId(null), MOMENT_MS);
		return () => clearTimeout(timer);
	}, [id]);
	return [id, setId];
}
