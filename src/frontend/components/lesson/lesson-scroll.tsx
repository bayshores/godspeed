import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { GetTargetScrollTop, StickToBottomContext } from "use-stick-to-bottom";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/frontend/components/ai-elements/conversation";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { SessionMessageNavigation } from "@/frontend/components/session-navigation";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { type Pads, restingTop, wholeLineTop } from "./lesson-scroll-model";

/**
 * The lesson text's reading measure: the page's one width of its own. Everything else takes
 * the shared page width and sides (`.lh-page`). With room for both (1280 = the text's 632, the
 * gap, "Your turn"'s 560 and two page sides; a container query cannot read the tokens), the lesson text and "Your turn" sit side by side
 * across the page's width, sized by `.lh-lesson-room`; with less, "Your turn" sits under the
 * text in one column.
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

/** How long after a turn ends a change in the page's height places it at once, not smoothly: the
 *  desk's exit and the reply's arrival. */
const LANDING_MS = 400;
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
 * inside the window, where only its question or problem scrolls (.lh-turn-fit); with less it sits
 * under the text, each sheet as tall as what it holds. While the lesson text draws nothing (a
 * lesson that opens with a problem), its sheet is left out and "Your turn" sits alone in the
 * middle; when the text's sheet arrives, "Your turn" slides over to its side. The page rests where restingTop says: on open, when the
 * teacher asks (`restKey` changes) and while the teacher writes. When a reply lands it
 * holds still while the desk leaves, then is placed at once as the reply draws in. "Your turn"
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
	const pageRef = useRef<HTMLDivElement>(null);
	const turnRef = useRef<HTMLDivElement>(null);
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

	// The teacher writing back while "Your turn" stays open makes its reply the newest thing.
	const replyRef = useRef(false);
	// Lines keep their place while the teacher writes; the page only settles on a whole line at rest.
	const busyRef = useRef(busy);
	busyRef.current = busy;
	const target = useCallback<GetTargetScrollTop>((end, { scrollElement, contentElement }) => {
		// The desk is leaving: the page holds still until the reply takes its place.
		if (contentElement.querySelector("[data-desk-closing]")) return scrollElement.scrollTop;
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

	/** Following the page only moves it down; this brings it up to where it now rests. */
	const settleUp = useCallback(() => {
		const context = contextRef.current;
		if (!context || context.state.escapedFromLock) return;
		const rest = context.state.calculatedTargetScrollTop;
		if (rest < context.state.scrollTop) context.state.scrollTop = rest;
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
	// The window, or the step line above, changing the page's height keeps a page that rests where it should there.
	useLayoutEffect(() => {
		const scroller = contextRef.current?.scrollRef.current;
		if (!scroller) return;
		let height = scroller.clientHeight;
		const ro = new ResizeObserver(() => {
			const context = contextRef.current;
			if (scroller.clientHeight === height || !context) return;
			height = scroller.clientHeight;
			if (!context.state.escapedFromLock) void context.scrollToBottom("instant");
		});
		ro.observe(scroller);
		return () => ro.disconnect();
	}, [contextRef]);
	// A landing reply changes the page's height: it is placed before it is drawn, so it appears in place.
	useLayoutEffect(() => {
		const column = columnRef.current;
		if (!column) return;
		const ro = new ResizeObserver(() => {
			const context = contextRef.current;
			if (!context || context.state.escapedFromLock || performance.now() > landing.current) return;
			context.state.scrollTop = context.state.calculatedTargetScrollTop;
		});
		ro.observe(column);
		return () => ro.disconnect();
	}, [contextRef]);
	// While the teacher works, and until its reply has landed, the page never gets shorter. WebKit lays
	// the page out between a row leaving and the row that replaces it arriving (the desk taking Stop,
	// the reply's steps, the desk leaving before the reply), and would pull the page up by the gap.
	useLayoutEffect(() => {
		const page = pageRef.current;
		if (!page) return;
		if (!busy) {
			const timer = setTimeout(() => (page.style.minHeight = ""), Math.max(0, landing.current - performance.now()));
			return () => clearTimeout(timer);
		}
		const ro = new ResizeObserver(() => {
			page.style.minHeight = `${page.offsetHeight}px`;
		});
		ro.observe(page);
		return () => ro.disconnect();
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

	return (
		<div className="lh-lesson-room @container/room flex min-h-0 min-w-0 flex-col [grid-area:main]">
			{/* A sheet of its own. The page scrolls in the window a gap under it, where every sheet's top edge stops, so the
			    lesson text and "Your turn" begin at one height. Shown only when the step line draws something, and
			    then it steps in with the reply's text (the step replays when :has() shows it). */}
			<div className="lh-page shrink-0 pt-(--lh-gap) [&:not(:has(>section>div>*))]:hidden">
				<Pane className={cn("@container/strip lh-block-in [--lh-block-delay:var(--lh-dur-fast)]", READING_MEASURE, hasTurn && PAIR)}>
					<div className="px-(--lh-reading-inset) py-4 @max-[640px]/strip:px-(--lh-reading-inset-narrow)">{steps}</div>
				</Pane>
			</div>
			<Conversation className="my-(--lh-gap) min-h-0 min-w-0 flex-1" initial="instant" resize="instant" {...SETTLE} contextRef={contextRef} targetScrollTop={target}>
				<SessionMessageNavigation />
				<ConversationContent className="gap-0 p-0" scrollClassName={cn("lh-lesson-window [overflow-anchor:none] [container-type:size]", pair && "lh-lesson-pair", alone && "lh-lesson-alone")}>
					{/* Side by side the sheets end at the window's foot, so "Your turn" has the window's height to fill. */}
					<div ref={pageRef} className={cn("lh-page pb-(--lh-page-end)", hasTurn && "@min-[1280px]/room:pb-0")}>
						<div ref={columnRef} data-testid="lesson-column" className={cn("@container/column flex flex-col gap-(--lh-gap)", READING_MEASURE, pair && [PAIR, PAIR_GRID], alone && ALONE)}>
							{reading}
							{hasTurn && (
								<div
									ref={turnRef}
									data-state={closing ? "closed" : "open"}
									inert={closing}
									className={cn("lh-turn-fit min-w-0", closing ? "lh-fade" : stepIn && "lh-block-in")}
									style={{ "--lh-block-delay": "240ms" } as CSSProperties}
								>
									{shownTurn}
								</div>
							)}
						</div>
					</div>
				</ConversationContent>
				<ConversationScrollButton className={cn(KEY, hasTurn && PAIR_KEY)} />
			</Conversation>
		</div>
	);
}
