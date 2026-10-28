/**
 * useFold (motion wave, owner 2026-10-26): a folding section that stays
 * UNMOUNTED while closed (tests and SSR keep pinning hidden text as
 * absent) but still eases open and shut with `.lh-collapse`.
 *
 *   const fold = useFold(open);
 *   {fold.mounted && (
 *     <div className="lh-collapse" data-state={fold.state}><div>…</div></div>
 *   )}
 *
 * Opening mounts the section folded, then flips it open two frames later
 * so the grid-rows transition has a start. Closing folds first, then
 * unmounts after the --lh-dur token (160 ms). First render returns `open`
 * as-is, so server and static renders match. Reduced motion: no waits.
 */

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/components/presence";

/** Matches --lh-dur in src/app/globals.css (the .lh-collapse transition). */
const FOLD_MS = 160;

export function useFold(open: boolean, ms: number = FOLD_MS): { mounted: boolean; state: "open" | "closed" } {
	const [mounted, setMounted] = useState(open);
	const [shown, setShown] = useState(open);
	useEffect(() => {
		if (open) {
			if (!mounted) {
				setMounted(true);
				return;
			}
			if (shown) return;
			if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
				setShown(true);
				return;
			}
			// Two frames: the folded state must be styled before it opens.
			let inner = 0;
			const outer = requestAnimationFrame(() => {
				inner = requestAnimationFrame(() => setShown(true));
			});
			return () => {
				cancelAnimationFrame(outer);
				cancelAnimationFrame(inner);
			};
		}
		if (shown) {
			setShown(false);
			return;
		}
		if (!mounted) return;
		if (prefersReducedMotion() || ms <= 0) {
			setMounted(false);
			return;
		}
		const timer = setTimeout(() => setMounted(false), ms);
		return () => clearTimeout(timer);
	}, [open, mounted, shown, ms]);
	return { mounted: open || mounted, state: open && shown ? "open" : "closed" };
}
