import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { GetTargetScrollTop, StickToBottomContext } from "use-stick-to-bottom";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/frontend/components/ai-elements/conversation";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { SessionMessageNavigation } from "@/frontend/components/session-navigation";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { holdPageHeight } from "./lesson-scroll-hold";
import { type Pads, restingTop, wholeLineTop } from "./lesson-scroll-model";
import { TurnPinned } from "./turn-pinned";

/**
 * The lesson text's reading measure: the page's one width of its own. Everything else takes
 * the shared page width and sides (`.lh-page`). With room for both (1280 = the text's 632, the
 * gap, "Your turn"'s 560 and two page sides; a container query cannot read the tokens), the lesson text and "Your turn" sit side by side
 * across the page's width, sized by `.lh-lesson-room`; with less, the text is one column and
 * "Your turn" is pinned under its window.
 */
const READING_MEASURE = "mx-auto w-full max-w-[872px]";
const PAIR = "@min-[1280px]/room:max-w-none";
const PAIR_GRID = "@min-[1280px]/room:grid @min-[1280px]/room:grid-cols-[minmax(0,1fr)_var(--lh-turn)] @min-[1280px]/room:items-start";
/** "Your turn" with no lesson text yet: in the middle, at the width it keeps in the pair. */
const ALONE = "@min-[1280px]/room:max-w-(--lh-turn)";
/** "Your turn" moving over as the lesson text's sheet arrives beside it. */
const MAKE_ROOM = { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };

/** The jump key: in the gutter beside one column where the window leaves room, else in the sheet's side padding; in a pair, in the lesson text's. */
const KEY = "@min-[688px]/room:right-[max(34px,calc((100%-872px)/2-48px))]";
const PAIR_KEY = "@min-[1280px]/room:right-[calc((100%-var(--lh-pair))/2+var(--lh-turn)+38px)]";

/** What the learner last sent, or the mark of his go-ahead: the start of the teacher's reply to it. */
const LEARNER = "[data-testid=user-message], [data-testid=go-ahead-mark]";

/** How long after a turn ends the page keeps its height: the desk's exit and the reply's arrival. */
const LANDING_MS = 400;
/** How long after its sheets last changed size the page holds still, before it glides to where it
 *  now rests: longer than the fade (110 ms) after which "Your turn" swaps what it holds, so a
 *  reply's sheets come to rest before the page moves, once. */
const HOLD_MS = 140;
/** The glide to a new resting place: firm enough to arrive in about a third of a second, with no
 *  long creep at its end, which reads as the page shaking. */
const SETTLE = { damping: 0.6, stiffness: 0.12, mass: 1 };

/** Text blocks whose lines the window's top edge may cut. */
const LINES = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th";
const BLOCKS = "pre, img, figure, table, .katex-display";

/** Whether the column lays its sheets side by side (its container query decides). */
function sideBySide(column: HTMLElement | null): boolean {
	return column !== null && getComputedStyle(column).display === "grid";
}

/** The room under the step line at which "Your turn" is pinned under the text's window: lower, a question
 *  with its box and keys would leave the text a sliver, so there it stays in the page, under the text. */
const PIN_ROOM = 640;

/** Subscribes to what never changes. */
const NO_CHANGE = () => () => {};

/** Whether the column lays its sheets under each other (its container query decides). */
function oneColumn(column: HTMLElement | null): boolean {
	return column !== null && getComputedStyle(column).display === "flex";
}

/** Moves "Your turn" to its other place in the page; the box the learner types in keeps the keyboard. */
function moveTurn(box: HTMLElement, slot: HTMLElement): void {
	const typing = box.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
	slot.append(box);
	typing?.focus({ preventScroll: true });
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
 * THE LESSON PAGE: the step line pinned on top, then the page that scrolls as a whole: the
 * lesson text's sheet and, once the lesson has started, "Your turn". With room for both they sit
 * side by side for the whole lesson and "Your turn" holds still while the text scrolls, always
 * inside the window, where only its question or problem scrolls (.lh-turn-fit); with less it is
 * pinned at the window's foot, under the window the text scrolls in, only as tall as what the
 * learner can do now (TurnPinned), so the text keeps the window, or, in a room too low for that
 * (PIN_ROOM), it sits in the page under the text. While the lesson text draws nothing (a
 * lesson that opens with a problem), its sheet is left out and "Your turn" sits alone in the
 * middle; when the text's sheet arrives, "Your turn" slides over to its side. The page rests where restingTop says: on open, when the
 * teacher asks (`restKey` changes) and while the teacher writes. When a reply lands it
 * holds still while the desk leaves and the sheets glide to their new sizes, then glides to its rest once. "Your turn"
 * fades out when it closes (a lesson reset) and, arriving with a reply, steps in after the
 * reply's text. Scrolled up, the key in the corner brings the learner back.
 */
export function LessonScroll({
	steps,
	restKey,
	busy,
	contextRef,
	reading,
	turn,
}: {
	/** The step line; nothing when the lesson has none. */
	steps: ReactNode;
	/** Changes when the teacher asks something new (a question, a problem, a part, a stop). */
	restKey: string;
	busy: boolean;
	contextRef: RefObject<StickToBottomContext | null>;
	/** The lesson text's sheet; null while "Your turn" is up and the text draws nothing. */
	reading: ReactNode | null;
	/** "Your turn", once the lesson has started. */
	turn: ReactNode | null;
}) {
	const held = useLastWhileClosing(turn);
	const closing = held.mounted && held.state === "closed" && !prefersReducedMotion();
	const shownTurn = closing ? held.shown : turn;
	const hasTurn = shownTurn !== null;
	// Shown when the page opened, "Your turn" is just there; arriving later, it steps in.
	const [stepIn, setStepIn] = useState<boolean | null>(hasTurn ? false : null);
	if (hasTurn !== (stepIn !== null)) setStepIn(hasTurn ? true : null);

	const pair = hasTurn && reading !== null;
	const alone = hasTurn && reading === null;

	const columnRef = useRef<HTMLDivElement>(null);
	const turnRef = useRef<HTMLDivElement>(null);
	// "Your turn" is drawn into a box of its own, which stands in the page's column or at the window's
	// foot. Moving the box keeps what the learner typed and picked, where drawing it anew would not.
	const roomRef = useRef<HTMLDivElement>(null);
	const underRef = useRef<HTMLDivElement>(null);
	const pageSlot = useRef<HTMLDivElement>(null);
	const footRef = useRef<HTMLDivElement>(null);
	const footSlot = useRef<HTMLDivElement>(null);
	// A page drawn to text has no window to move it in: there it is drawn in the column.
	const inWindow = useSyncExternalStore(NO_CHANGE, () => true, () => false);
	const [turnBox] = useState(() => (inWindow ? Object.assign(document.createElement("div"), { className: "contents" }) : null));
	const [pinned, setPinned] = useState(false);
	useLayoutEffect(() => {
		const room = roomRef.current;
		const under = underRef.current;
		if (!room || !under || !hasTurn || !turnBox) return;
		const place = () => {
			const pin = pair && oneColumn(columnRef.current) && under.clientHeight >= PIN_ROOM;
			const slot = (pin ? footSlot : pageSlot).current;
			if (slot && turnBox.parentElement !== slot) moveTurn(turnBox, slot);
			// Shown and hidden here, with the move, so no frame draws the foot's room without its sheet.
			if (footRef.current) footRef.current.hidden = !pin;
			setPinned(pin);
		};
		place();
		const ro = new ResizeObserver(place);
		ro.observe(room);
		ro.observe(under);
		return () => ro.disconnect();
	}, [hasTurn, pair, turnBox]);
	// Where "Your turn" stood alone, to slide it from there when the text's sheet takes its side.
	const aloneLeft = useRef<number | null>(null);
	useLayoutEffect(() => {
		const el = turnRef.current;
		if (alone) {
			aloneLeft.current = el?.getBoundingClientRect().left ?? null;
			return;
		}
		const from = aloneLeft.current;
		aloneLeft.current = null;
		if (!el || from === null || !pair || prefersReducedMotion()) return;
		const left = el.getBoundingClientRect().left;
		if (left !== from) el.animate([{ transform: `translateX(${from - left}px)` }, { transform: "none" }], MAKE_ROOM);
	});

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
		return busyRef.current || !text ? rest : wholeLineTop(rest, linesAt(text, rest, origin));
	}, []);
	/** The page holds still from now, and glides to its rest once nothing has changed size for a moment. */
	const holdThenGlide = useCallback(() => {
		hold.current.until = performance.now() + HOLD_MS;
		clearTimeout(hold.current.timer);
		hold.current.timer = window.setTimeout(() => {
			const context = contextRef.current;
			if (!context || context.state.escapedFromLock) return;
			void context.scrollToBottom("smooth");
			requestAnimationFrame(settleUp);
		}, HOLD_MS);
	}, [contextRef, settleUp]);
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
	// at its new size (`seen`), so the page is put back from where it last stood (`top`), which also tells its follower
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
		let top = scroller.scrollTop;
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
				context.state.scrollTop = sameWidth ? Math.max(top, Math.min(top + lower, rest)) : rest;
				if (sameRoom && !prefersReducedMotion()) holdThenGlide();
				// A glide on its way reaches the new rest by itself.
				else if (!context.state.animation && performance.now() >= hold.current.until) void context.scrollToBottom("instant");
			}
			top = scroller.scrollTop;
		});
		ro.observe(scroller);
		// The pull can reach the follower first, when the page was laid out before its frame: a scroll under a window
		// whose new size is not handled yet is told to it as a size change under way, as it tells itself for the page's own.
		const scrolled = () => {
			const state = contextRef.current?.state;
			if (scroller.offsetHeight === height && scroller.offsetWidth === width) top = scroller.scrollTop;
			else if (state && !state.resizeDifference) {
				state.resizeDifference = 1;
				setTimeout(() => {
					if (state.resizeDifference === 1) state.resizeDifference = 0;
				}, 2);
			}
		};
		scroller.addEventListener("scroll", scrolled, { passive: true });
		return () => {
			ro.disconnect();
			scroller.removeEventListener("scroll", scrolled);
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
			const timer = setTimeout(() => (column.style.minHeight = ""), Math.max(0, landing.current - performance.now()));
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

	const turnSheet = (
		<TurnPinned.Provider value={pinned}>
			<div
				ref={turnRef}
				data-state={closing ? "closed" : "open"}
				inert={closing}
				className={cn("lh-turn-fit min-w-0", closing ? "lh-fade" : stepIn && "lh-block-in")}
				style={{ "--lh-block-delay": "240ms" } as CSSProperties}
			>
				{shownTurn}
			</div>
		</TurnPinned.Provider>
	);
	return (
		<div ref={roomRef} className="lh-lesson-room @container/room flex min-h-0 min-w-0 flex-col [grid-area:main]">
			{/* A sheet of its own. The page scrolls in the window a gap under it, where every sheet's top edge stops, so the
			    lesson text and "Your turn" begin at one height. Shown only when the step line draws something, and
			    then it steps in with the reply's text (the step replays when :has() shows it). */}
			<div className="lh-page shrink-0 pt-(--lh-gap) [&:not(:has(>section>div>*))]:hidden">
				<Pane className={cn("@container/strip lh-block-in [--lh-block-delay:var(--lh-dur-fast)]", READING_MEASURE, hasTurn && PAIR)}>
					<div className="px-(--lh-reading-inset) py-4 @max-[640px]/strip:px-(--lh-reading-inset-narrow)">{steps}</div>
				</Pane>
			</div>
			<div ref={underRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
				<Conversation className="my-(--lh-gap) min-h-0 min-w-0 flex-1" initial="instant" resize="instant" {...SETTLE} contextRef={contextRef} targetScrollTop={target}>
					<SessionMessageNavigation />
					<ConversationContent className="gap-0 p-0" scrollClassName={cn("lh-lesson-window [overflow-anchor:none] [container-type:size]", pair && "lh-lesson-pair", alone && "lh-lesson-alone", pinned && "lh-lesson-pinned")}>
						{/* With "Your turn" beside it or pinned under its window, the text's sheet ends at the window's foot. */}
						<div className={cn("lh-page", pinned ? "pb-0" : "pb-(--lh-page-end)", hasTurn && "@min-[1280px]/room:pb-0")}>
							<div ref={columnRef} data-testid="lesson-column" className={cn("lh-lesson-column @container/column flex flex-col gap-(--lh-gap)", READING_MEASURE, pair && [PAIR, PAIR_GRID], alone && ALONE)}>
								{reading}
								{hasTurn && (
									<div ref={pageSlot} className="contents">
										{!turnBox && turnSheet}
									</div>
								)}
							</div>
						</div>
					</ConversationContent>
					<ConversationScrollButton className={cn(KEY, hasTurn && PAIR_KEY)} />
				</Conversation>
				{/* "Your turn" pinned (its height: .lh-turn-foot). */}
				<div ref={footRef} hidden className="lh-turn-foot lh-page flex min-h-0 shrink-0 flex-col pb-(--lh-gap)">
					<div ref={footSlot} className={cn("flex min-h-0 flex-col", READING_MEASURE)} />
				</div>
			</div>
			{hasTurn && turnBox && createPortal(turnSheet, turnBox)}
		</div>
	);
}
