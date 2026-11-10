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

import { useEffect, useState } from "react";

/** Matches --lh-dur-fast in src/frontend/globals.css. */
const EXIT_MS = 110;

// One live query for the app's lifetime: .matches follows the OS setting,
// so hot callers (every fold, every countdown tick) skip a rebuild.
let reducedMotionQuery: MediaQueryList | null = null;

export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	reducedMotionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
	return reducedMotionQuery.matches;
}

export function usePresence(open: boolean, exitMs: number = EXIT_MS): { mounted: boolean; state: "open" | "closed" } {
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
