/**
 * useFold: a folding section that stays
 * UNMOUNTED while closed (tests and SSR keep pinning hidden text as
 * absent) but still eases open and shut with `.lh-collapse`.
 *
 *   const fold = useFold(open);
 *   {fold.mounted && (
 *     <div className="lh-collapse" data-state={fold.state}><div>…</div></div>
 *   )}
 *
 * Opening mounts the section folded, has its folded look worked out at
 * once, then flips it open before the frame is drawn, so the grid-rows
 * transition has a start and the section begins to open in the very
 * frame it appears. Closing folds first, then unmounts after the --lh-dur
 * token (160 ms). First render returns `open` as-is, so server and static
 * renders match. Reduced motion: no waits.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";

/** Matches --lh-dur in src/frontend/globals.css (the .lh-collapse transition). */
const FOLD_MS = 160;

export function useFold(open: boolean): { mounted: boolean; state: "open" | "closed" } {
	const [mounted, setMounted] = useState(open);
	const [shown, setShown] = useState(open);
	useLayoutEffect(() => {
		if (!open) return;
		if (!mounted) {
			setMounted(true);
			return;
		}
		if (shown) return;
		// Reading a size makes the browser style the folded section now, before it is flipped open.
		if (!prefersReducedMotion()) void document.body.offsetHeight;
		setShown(true);
	}, [open, mounted, shown]);
	useEffect(() => {
		if (open) return;
		if (shown) {
			setShown(false);
			return;
		}
		if (!mounted) return;
		if (prefersReducedMotion()) {
			setMounted(false);
			return;
		}
		const timer = setTimeout(() => setMounted(false), FOLD_MS);
		return () => clearTimeout(timer);
	}, [open, mounted, shown]);
	return { mounted: open || mounted, state: open && shown ? "open" : "closed" };
}
