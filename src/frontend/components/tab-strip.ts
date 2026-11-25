import { useCallback, useLayoutEffect, useRef, type WheelEvent } from "react";

/** How wide (px) a strip fades out where it cuts tabs off (`.lh-cut` in globals.css). */
const FADE = 24;

/** A row of tabs that scrolls sideways where its room is too narrow, fading at a cut end. */
export const STRIP = "lh-cut min-w-0 overflow-x-auto [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden";

/** A mouse wheel only scrolls up and down: over a strip it scrolls the tabs. */
export function wheelSideways(e: WheelEvent<HTMLElement>): void {
	if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
}

/** A tab strip's scroller: which of its ends cut tabs off (`data-cut`, which globals.css fades), and the lit
 *  tab (`lit`, a selector) kept in sight as the room narrows or another tab lights (`key` changes). */
export function useTabStrip<T extends HTMLElement = HTMLDivElement>(lit: string, key: string) {
	const ref = useRef<T>(null);
	// Marked on the strip itself, not kept in state: the mark narrows the lit tab's room, so it is
	// there in the same layout that brings the tab into sight, not a frame later.
	const measure = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const start = el.scrollLeft > 1;
		const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
		if (start || end) el.dataset.cut = start && end ? "both" : start ? "start" : "end";
		else delete el.dataset.cut;
	}, []);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		// The strip alone is scrolled: bringing the tab into view any other way would also scroll the page under a tab row.
		const show = () => {
			const tab = el.querySelector<HTMLElement>(lit);
			if (!tab) return;
			const room = el.getBoundingClientRect();
			const box = tab.getBoundingClientRect();
			// Too narrow to keep the lit tab clear of both fades: centered, they fall on its padding.
			if (box.width + 2 * FADE > room.width) el.scrollLeft += box.left + box.width / 2 - (room.left + room.width / 2);
			else if (box.left < room.left + FADE) el.scrollLeft += box.left - room.left - FADE;
			else if (box.right > room.right - FADE) el.scrollLeft += box.right - room.right + FADE;
		};
		const reveal = () => {
			show();
			measure();
			// Again, in the room the mark left the lit tab.
			show();
		};
		reveal();
		const observer = new ResizeObserver(reveal);
		observer.observe(el);
		for (const tab of el.children) observer.observe(tab);
		return () => observer.disconnect();
	}, [lit, key, measure]);
	return { ref, measure };
}
