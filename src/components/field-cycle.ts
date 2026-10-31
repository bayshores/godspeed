import { useEffect } from "react";

/**
 * TAB INSIDE THE LESSON'S TEXT FIELDS jumps to the next one, in the
 * surface's order; from the last field (and anywhere outside the fields)
 * Tab moves focus as usual, so buttons stay reachable. Shift+Tab is never
 * taken over.
 *
 * The fields are gathered at keypress time from live DOM: they mount and
 * unmount with the docks, so a query beats stale refs. The quiz dock's own
 * Tab claim (rows → thinking) stops propagation at the document level, and
 * a key another handler already took (the code editor indents) is left
 * alone.
 */
/** The field Tab moves to from `target`, or undefined to let Tab move
 *  focus as usual (outside the fields, or from the last one). Pure —
 *  exported for tests. */
export function nextField(fields: readonly HTMLElement[], target: EventTarget | null): HTMLElement | undefined {
	const idx = fields.findIndex((el) => el === target || el.contains(target as Node | null));
	return idx >= 0 ? fields[idx + 1] : undefined;
}

export function useFieldCycle(fields: () => readonly HTMLElement[]) {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
			const next = nextField(fields().filter((el) => el.isConnected), e.target);
			if (!next) return;
			e.preventDefault();
			next.focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [fields]);
}
