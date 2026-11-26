import { useLayoutEffect, useRef, type RefObject } from "react";
import { EASE_OUT as OUT, prefersReducedMotion } from "@/frontend/components/presence";

/** The sheet and the talk moving sideways, as long as the book's pages slide (useBookMove). */
const SLIDE_MS = 240;
/** The right page showing once the sheet has gone (--lh-dur). */
const SHOW_MS = 160;

const TEXT = "[data-testid=lesson-reading]";

/** Where the pieces stood before the page was laid out anew. */
interface Shot {
	width: number;
	text: number | null;
	row: DOMRect | null;
	/** A still copy of the problem's sheet in the left part, to leave the page with. */
	sheet: HTMLElement | null;
}

const shown = (el: Element | null | undefined): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0;

/**
 * THE LEFT SHEET'S MOVE, in a room wide enough for an open problem beside the text (LessonScroll's
 * "left" place). When a problem opens, its sheet glides in from the room's left edge while the text
 * and the writing row slide to the right part; when it closes, a still copy of the sheet glides out
 * that way while they slide back and the book's right page shows. A page that opens with a problem
 * open is just there; with reduced motion, in one column, or when the room changed width, the page
 * is laid out and that is all.
 */
export function useLeftSlide({
	underRef,
	slotRef,
	columnRef,
	footRef,
	turnRef,
	split,
}: {
	/** The room under the step line, which the sheet travels in. */
	underRef: RefObject<HTMLElement | null>;
	/** The left part's place (.lh-turn-left). */
	slotRef: RefObject<HTMLElement | null>;
	columnRef: RefObject<HTMLElement | null>;
	/** The writing row's place under the text's window. */
	footRef: RefObject<HTMLElement | null>;
	/** The book's right page. */
	turnRef: RefObject<HTMLElement | null>;
	/** An open problem stands out of the page. */
	split: boolean;
}) {
	const moving = useRef<{ parts: Animation[]; done: () => void } | null>(null);
	const shoot = (): Shot | null => {
		const under = underRef.current;
		if (!under) return null;
		const text = columnRef.current?.querySelector(TEXT);
		const row = footRef.current?.firstElementChild;
		const slot = slotRef.current;
		return {
			width: under.clientWidth,
			text: shown(text) ? text.getBoundingClientRect().left : null,
			row: shown(row) ? row.getBoundingClientRect() : null,
			sheet: shown(slot) ? (slot.cloneNode(true) as HTMLElement) : null,
		};
	};

	// Where the pieces stand is read while the page is still laid out the old way.
	const laid = useRef(split);
	const before = useRef<Shot | null>(null);
	if (laid.current !== split) {
		laid.current = split;
		before.current = shoot();
	}
	useLayoutEffect(() => {
		const was = before.current;
		before.current = null;
		const now = was && !prefersReducedMotion() && typeof underRef.current?.animate === "function" ? shoot() : null;
		const under = underRef.current;
		if (!was || !now || !under || now.width !== was.width) return;
		// A move on its way ends where the page now is.
		moving.current?.done();
		const base = under.getBoundingClientRect();
		const parts: Animation[] = [];
		const slot = slotRef.current;
		// The sheet travels from or to just past the room's left edge.
		const away = (sheet: HTMLElement) => `translateX(${base.left - sheet.getBoundingClientRect().right}px)`;
		if (shown(slot) && !was.sheet) parts.push(slot.animate([{ transform: away(slot) }, { transform: "none" }], { duration: SLIDE_MS, easing: OUT }));
		let ghost: HTMLElement | null = null;
		if (was.sheet && !shown(slot)) {
			ghost = was.sheet;
			// A copy only to look at: nothing finds it as the sheet.
			for (const el of [ghost, ...ghost.querySelectorAll("[data-testid], [id]")]) {
				el.removeAttribute("data-testid");
				el.removeAttribute("id");
			}
			ghost.removeAttribute("hidden");
			ghost.setAttribute("aria-hidden", "true");
			ghost.inert = true;
			ghost.style.pointerEvents = "none";
			under.prepend(ghost);
			// On the text's easing, so the two travel as one strip and never cross.
			parts.push(ghost.animate([{ transform: "none" }, { transform: away(ghost) }], { duration: SLIDE_MS, easing: OUT, fill: "forwards" }));
			const turn = turnRef.current;
			if (shown(turn)) parts.push(turn.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SHOW_MS, delay: SLIDE_MS / 2, easing: OUT, fill: "backwards" }));
		}
		const text = columnRef.current?.querySelector(TEXT);
		if (was.text !== null && shown(text)) {
			const dx = was.text - text.getBoundingClientRect().left;
			if (dx !== 0) parts.push(text.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: OUT }));
		}
		const row = footRef.current?.firstElementChild;
		if (was.row && shown(row)) {
			const at = row.getBoundingClientRect();
			if (at.left !== was.row.left || at.width !== was.row.width)
				parts.push(row.animate([{ transform: `translateX(${was.row.left - at.left}px)`, width: `${was.row.width}px` }, { transform: "none", width: `${at.width}px` }], { duration: SLIDE_MS, easing: OUT }));
		}
		if (parts.length === 0) return;
		// What travels is drawn only inside the room.
		under.style.overflow = "clip";
		const move = {
			parts,
			done: () => {
				if (moving.current !== move) return;
				moving.current = null;
				for (const part of parts) part.cancel();
				ghost?.remove();
				under.style.overflow = "";
			},
		};
		moving.current = move;
		Promise.all(parts.map((part) => part.finished)).then(move.done, move.done);
		// The refs hold for the page's life; the move is read only when the page changes its layout.
	}, [split]);
	useLayoutEffect(() => () => moving.current?.done(), []);
}
