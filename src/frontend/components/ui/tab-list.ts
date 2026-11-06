import type { KeyboardEvent } from "react";

/** The tab a key moves to in a row of `count` tabs: the arrows step and
 *  wrap, Home and End jump to the ends. Null for any other key. */
export function tabKeyTarget(index: number, count: number, key: string): number | null {
	if (count <= 0) return null;
	if (key === "Home") return 0;
	if (key === "End") return count - 1;
	if (key === "ArrowRight") return (index + 1) % count;
	if (key === "ArrowLeft") return (index - 1 + count) % count;
	return null;
}

/** onKeyDown for a role="tablist": the arrow keys pick a tab and move
 *  focus to it (the WAI-ARIA tabs pattern; only the picked tab is in the
 *  Tab order). */
export function tabListKeys(index: number, count: number, select: (index: number) => void) {
	return (e: KeyboardEvent<HTMLElement>) => {
		const next = tabKeyTarget(index, count, e.key);
		if (next === null) return;
		e.preventDefault();
		e.stopPropagation();
		select(next);
		e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
	};
}
