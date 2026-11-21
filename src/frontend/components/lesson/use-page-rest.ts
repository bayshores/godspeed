import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { GetTargetScrollTop, StickToBottomContext } from "use-stick-to-bottom";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { holdPageHeight } from "./lesson-scroll-hold";
import { type Pads, restingTop, wholeLineTop } from "./lesson-scroll-model";
import { useBookMove } from "./use-book-move";
import { useFiledCardHold } from "./use-filed-card-hold";

/** What the learner last sent, or the mark of his go-ahead: the start of the teacher's reply to it. */
const LEARNER = "[data-testid=user-message], [data-testid=go-ahead-mark]";

/** How long after a turn ends the page keeps its height: the desk's exit and the reply's arrival. */
const LANDING_MS = 400;
/** How long past its planned end the book's move may still be on its way. */
const MOVE_SLACK_MS = 250;
/** How long after its sheets last changed size the page holds still, before it glides to where it
 *  now rests: longer than the fade (110 ms) after which "Your turn" swaps what it holds, so a
 *  reply's sheets come to rest before the page moves, once. */
const HOLD_MS = 140;

/** Text blocks whose lines the window's top edge may cut. */
const LINES = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th";
const BLOCKS = "pre, img, figure, table, .katex-display";

/** Whether the column lays its sheets side by side (its container query decides). */
function sideBySide(column: HTMLElement | null): boolean {
	return column !== null && getComputedStyle(column).display === "grid";
}

/** The page's padding above and under its sheets, as its CSS sets them. */
function padsOf(column: HTMLElement | null): Pads {
	const style = column?.parentElement ? getComputedStyle(column.parentElement) : null;
	return { top: parseFloat(style?.paddingTop ?? "0"), end: parseFloat(style?.paddingBottom ?? "0") };
}

/** The line boxes in `root` that cross `y`, measured from `origin`. */
function linesAt(root: Element, y: number, origin: number): { top: number; bottom: number }[] {
	const crosses = (r: DOMRect) => r.top - origin < y && r.bottom - origin > y;
	const out: { top: number; bottom: number }[] = [];
	for (const el of root.querySelectorAll(`${LINES}, ${BLOCKS}`)) {
		const box = el.getBoundingClientRect();
		if (!crosses(box)) continue;
		let rects: Iterable<DOMRect> = [box];
		if (el.matches(LINES)) {
			const range = document.createRange();
			range.selectNodeContents(el);
			rects = range.getClientRects();
		}
		for (const r of rects) if (crosses(r)) out.push({ top: r.top - origin, bottom: r.bottom - origin });
	}
	return out;
}

/**
 * Where the lesson's page stands in its window, and how it gets there. The page rests where
 * restingTop says: on open, when the teacher asks (`restKey` changes) and while the teacher
 * writes. When a reply lands it holds still while the desk leaves and the sheets glide to their
 * new sizes, then glides to its rest once. When the book opens or shuts (useBookMove) the page
 * takes its rest in the new layout at once and the pages are moved to it. Gives the follower its
 * target and the text's cards the way to say they open (FilingContext).
 */
export function usePageRest({
	contextRef,
	roomRef,
	columnRef,
	turnRef,
	footRef,
	busy,
	restKey,
	beside,
	open,
	shutting,
	onShut,
	onRest,
}: {
	contextRef: RefObject<StickToBottomContext | null>;
	roomRef: RefObject<HTMLElement | null>;
	columnRef: RefObject<HTMLElement | null>;
	turnRef: RefObject<HTMLElement | null>;
	footRef: RefObject<HTMLElement | null>;
	busy: boolean;
	restKey: string;
	/** The book lies open in a room wide enough for both pages. */
	beside: boolean;
	open: boolean;
	shutting: boolean;
	onShut: () => void;
	onRest: () => void;
}): { target: GetTargetScrollTop; onFile: ReturnType<typeof useFiledCardHold>["onFile"] } {
	/** Following the page only moves it down; this brings it up to where it now rests. */
	const settleUp = useCallback(() => {
		const context = contextRef.current;
		if (!context || context.state.escapedFromLock) return;
		const rest = context.state.calculatedTargetScrollTop;
		if (rest < context.state.scrollTop) context.state.scrollTop = rest;
	}, [contextRef]);

	// The teacher writing back while "Your turn" stays open makes its reply the newest thing.
	const replyRef = useRef(false);
	// Lines keep their place while the teacher writes; the page only settles on a whole line at rest.
	const busyRef = useRef(busy);
	busyRef.current = busy;
	// The sheets' height as the page last saw it, in the window it saw it in, and until when it holds still for a change.
	const sized = useRef<{ view: string; height: number } | null>(null);
	const hold = useRef({ until: 0, timer: 0 });
	/** Where the page rests, among its sheets as they stand now. */
	const restOf = useCallback<GetTargetScrollTop>((end, { scrollElement, contentElement }) => {
		const origin = contentElement.getBoundingClientRect().top;
		const sheetEl = contentElement.querySelector("[data-testid=turn-sheet]");
		const sheetBox = sheetEl?.getBoundingClientRect();
		const partBox = contentElement.querySelector("[data-part-current]")?.getBoundingClientRect();
		// With nothing waiting, a reply is read from its start once it has landed; while it is worked on, the desk shows.
		const reply =
			replyRef.current && (sheetEl || !busyRef.current)
				? ([...contentElement.querySelectorAll(LEARNER)].at(-1) ?? contentElement.querySelector("[data-testid=lesson-reading]"))
				: null;
		const rest = restingTop(end, {
			view: scrollElement.clientHeight,
			pads: padsOf(columnRef.current),
			sheet: sheetBox ? { top: sheetBox.top - origin, height: sheetBox.height, beside: sideBySide(columnRef.current) } : null,
			part: sheetBox && partBox ? partBox.top - sheetBox.top : null,
			reply: reply ? reply.getBoundingClientRect().top - origin : null,
		});
		const text = contentElement.querySelector("[data-testid=lesson-reading]");
		// A scroll position is a whole number: a rest with parts of a point would be reached, then left again.
		return Math.round(busyRef.current || !text ? rest : wholeLineTop(rest, linesAt(text, rest, origin)));
	}, []);
	// Until when the book's pages move (useBookMove), and where the page last stood by its own or the learner's doing.
	const moveEnd = useRef(0);
	const stood = useRef(0);
	/** The page holds still from now, and glides to its rest once nothing has changed size for a moment and the book's pages have stopped. */
	const holdThenGlide = useCallback(() => {
		const wait = Math.max(HOLD_MS, moveEnd.current - performance.now());
		hold.current.until = performance.now() + wait;
		clearTimeout(hold.current.timer);
		hold.current.timer = window.setTimeout(() => {
			const context = contextRef.current;
			if (!context || context.state.escapedFromLock) return;
			void context.scrollToBottom("smooth");
			requestAnimationFrame(settleUp);
		}, wait);
	}, [contextRef, settleUp]);
	const onMove = useCallback(
		(ms: number) => {
			// The pages say when they rest (rested); the time is the latest that can be, should they never say.
			moveEnd.current = performance.now() + ms + MOVE_SLACK_MS;
			holdThenGlide();
		},
		[holdThenGlide],
	);
	const filing = useFiledCardHold(contextRef);
	// The column keeps room for the book's move (`spare`), given up when the pages stand.
	const spared = useRef(false);
	/** The page takes its rest in the layout the book now has, at once: the pages are moved to it from where they stood. */
	const placePage = useCallback(
		(spare: number) => {
			const column = columnRef.current;
			const context = contextRef.current;
			const scroller = context?.scrollRef.current;
			const content = context?.contentRef.current;
			if (!column || !context || !scroller || !content) return;
			// The height kept while the teacher worked was the other layout's.
			column.style.minHeight = "";
			// A card that opens in the text with the move (FiledCard) brings the page there as it grows.
			const end = filing.opened(() => ({ rest: restOf(context.state.targetScrollTop, { scrollElement: scroller, contentElement: content }), height: column.offsetHeight }));
			const toCome = end.height - column.offsetHeight;
			// While the page's window is still as high as it was, that rest is past the page's end.
			if (spare > 0) column.style.minHeight = `${end.height + spare}px`;
			spared.current = spare > 0;
			if (!context.state.escapedFromLock) context.state.scrollTop = stood.current = end.rest - toCome;
		},
		[contextRef, restOf, filing],
	);
	const rested = useCallback(() => {
		const still = prefersReducedMotion();
		// With reduced motion the pages are laid out and that is all: the height kept for the landing would place the page too low.
		if ((spared.current || still) && columnRef.current) columnRef.current.style.minHeight = "";
		spared.current = false;
		moveEnd.current = performance.now();
		const context = contextRef.current;
		const scroller = context?.scrollRef.current;
		const content = context?.contentRef.current;
		if (context && scroller && content && !context.state.escapedFromLock) {
			// The parts of a point the move left over are taken up now, not by a glide a moment later.
			const rest = restOf(context.state.targetScrollTop, { scrollElement: scroller, contentElement: content });
			if (still || Math.abs(rest - scroller.scrollTop) <= 2) context.state.scrollTop = stood.current = rest;
		}
		// Any more is glided to, from the page as it now stands.
		if (!still) holdThenGlide();
		onRest();
	}, [onRest, contextRef, restOf, holdThenGlide]);
	useBookMove({ roomRef, columnRef, turnRef, footRef, beside, open, shutting, onShut, onMove, onPlace: placePage, onRest: rested });
	const target = useCallback<GetTargetScrollTop>((end, { scrollElement, contentElement }) => {
		// The desk is leaving: the page holds still until the reply takes its place.
		if (contentElement.querySelector("[data-desk-closing]")) return scrollElement.scrollTop;
		// The sheets are changing size (useSheetGlide): the page holds still, then glides to its rest once.
		const now = { view: `${roomRef.current?.clientWidth} ${roomRef.current?.clientHeight}`, height: columnRef.current?.offsetHeight ?? 0 };
		const was = sized.current;
		sized.current = now;
		if (was && was.view === now.view && was.height !== now.height && !prefersReducedMotion()) holdThenGlide();
		return performance.now() < hold.current.until ? scrollElement.scrollTop : restOf(end, { scrollElement, contentElement });
	}, [holdThenGlide, restOf]);
	useLayoutEffect(() => () => clearTimeout(hold.current.timer), []);
	// The page opens at its rest: its follower would place it one frame after the first is drawn.
	useLayoutEffect(() => {
		const state = contextRef.current?.state;
		if (state) state.scrollTop = state.calculatedTargetScrollTop;
	}, [contextRef]);
	const wasBusy = useRef(busy);
	const landing = useRef(0);
	useLayoutEffect(() => {
		const was = wasBusy.current;
		wasBusy.current = busy;
		if (was && !busy) landing.current = performance.now() + LANDING_MS;
		if (!busy || was) return;
		replyRef.current = true;
		const frame = requestAnimationFrame(settleUp);
		return () => cancelAnimationFrame(frame);
	}, [busy, settleUp]);
	// The window, the step line above or "Your turn" pinned under it changing the height of the page's window keeps a
	// page that rests where it should there. Under a window that gets lower the text keeps its place over the window's
	// end, as far as the page's rest; under one that grows it stays where it was, and what is under it comes into view.
	// The browser pulls a page at its end along a window that grows, also in the one layout a sheet about to glide gets
	// at its new size (`seen`), so the page is put back from where it last stood (`stood`), which also tells its follower
	// the move was no scroll of the learner's. A sheet gliding (the room's own size has not changed) holds the page
	// still like the sheets in the page do.
	useLayoutEffect(() => {
		const scroller = contextRef.current?.scrollRef.current;
		const room = roomRef.current;
		if (!scroller || !room) return;
		const roomSize = () => `${room.clientWidth} ${room.clientHeight}`;
		let width = scroller.offsetWidth;
		let height = scroller.offsetHeight;
		let view = roomSize();
		stood.current = scroller.scrollTop;
		const ro = new ResizeObserver(([entry]) => {
			const context = contextRef.current;
			const content = context?.contentRef.current;
			const seen = Math.round(entry?.borderBoxSize[0]?.blockSize ?? height);
			const now = scroller.offsetHeight;
			const sameWidth = scroller.offsetWidth === width;
			if ((seen === height && now === height && sameWidth) || !context || !content) return;
			const lower = Math.max(0, height - now);
			const sameRoom = roomSize() === view;
			height = now;
			width = scroller.offsetWidth;
			view = roomSize();
			if (!context.state.escapedFromLock) {
				const rest = restOf(context.state.targetScrollTop, { scrollElement: scroller, contentElement: content });
				// A window of another width lays the page out anew: it is placed at its rest at once.
				// The book's pages on their way were placed for the window they end in (placePage): the page stays there.
				const pagesMove = performance.now() < moveEnd.current;
				const top = stood.current;
				context.state.scrollTop = pagesMove ? top : sameWidth ? Math.max(top, Math.min(top + lower, rest)) : rest;
				if (sameRoom && !prefersReducedMotion()) holdThenGlide();
				// A glide on its way reaches the new rest by itself.
				else if (!context.state.animation && performance.now() >= hold.current.until) void context.scrollToBottom("instant");
			}
			// A page the browser could not leave in its place under the book's pages goes back there when it can.
			if (performance.now() >= moveEnd.current) stood.current = scroller.scrollTop;
		});
		ro.observe(scroller);
		// The pull can reach the follower first, when the page was laid out before its frame: a scroll under a window
		// whose new size is not handled yet is marked as the page's own, as every scroll the page sets is. Under the
		// book's pages on their way a scroll that is not the page's own is the browser's too (what the page holds was
		// lower for a moment), and the page goes back where it stood. The room hears a scroll before the follower does.
		const scrolled = (event: Event) => {
			if (event.target !== scroller) return;
			const state = contextRef.current?.state;
			const now = scroller.scrollTop;
			if (state?.ignoreScrollToTop === now) stood.current = now;
			else if (state && performance.now() < moveEnd.current) state.scrollTop = stood.current;
			else if (scroller.offsetHeight === height && scroller.offsetWidth === width) stood.current = now;
			else if (state) state.scrollTop = now;
		};
		room.addEventListener("scroll", scrolled, { capture: true, passive: true });
		return () => {
			ro.disconnect();
			room.removeEventListener("scroll", scrolled, { capture: true });
		};
	}, [contextRef, restOf, holdThenGlide]);
	// With reduced motion a landing reply's sheets change size at once: the page is placed before it is drawn, so it appears in place.
	useLayoutEffect(() => {
		const column = columnRef.current;
		if (!column) return;
		const ro = new ResizeObserver(() => {
			const context = contextRef.current;
			if (!context || context.state.escapedFromLock || performance.now() > landing.current || !prefersReducedMotion()) return;
			context.state.scrollTop = context.state.calculatedTargetScrollTop;
		});
		ro.observe(column);
		return () => ro.disconnect();
	}, [contextRef]);
	// The sheets keep their height together while the teacher works, and until its reply has landed.
	useLayoutEffect(() => {
		const column = columnRef.current;
		if (!column) return;
		if (!busy) {
			// The book's pages on their way keep the column's height themselves (placePage).
			const free = () => performance.now() >= moveEnd.current && (column.style.minHeight = "");
			const timer = setTimeout(free, Math.max(0, landing.current - performance.now()));
			return () => clearTimeout(timer);
		}
		const room = roomRef.current;
		if (!room) return;
		return holdPageHeight(column, room);
	}, [busy]);
	const firstKey = useRef(restKey);
	useLayoutEffect(() => {
		replyRef.current = false;
		if (restKey === firstKey.current) return;
		firstKey.current = restKey;
		// What arrives with a landing reply is placed with it, not glided to.
		const landed = performance.now() < landing.current;
		void contextRef.current?.scrollToBottom(landed || prefersReducedMotion() ? "instant" : "smooth");
		const frame = requestAnimationFrame(settleUp);
		return () => cancelAnimationFrame(frame);
	}, [restKey, contextRef, settleUp]);

	return { target, onFile: filing.onFile };
}
