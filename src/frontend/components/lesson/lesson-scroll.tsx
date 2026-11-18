import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { GetTargetScrollTop, StickToBottomContext } from "use-stick-to-bottom";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/frontend/components/ai-elements/conversation";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { SessionMessageNavigation } from "@/frontend/components/session-navigation";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { keepPair, restingTop, turnStick, wholeLineTop } from "./lesson-scroll-model";

/**
 * The column's width and its sides, shared by the step line and the page so their edges meet.
 * With room for both, a pair is the lesson text (688 to 872 wide, never narrower than its
 * partner) and "Your turn" (688, so its Stuck? keys and the way out share one line) side by
 * side; with less, "Your turn" sits under the text in one column.
 */
const COLUMN = "mx-auto w-full max-w-[872px]";
const PAIR = "@min-[1468px]/room:max-w-[1588px]";
const PAIR_GRID = "@min-[1468px]/room:grid @min-[1468px]/room:grid-cols-[minmax(0,1fr)_688px] @min-[1468px]/room:items-start";
const GUTTERS = "px-8 @max-[899px]/lesson:px-6";

/** The jump key: in the gutter beside one column where the window leaves room, else in the sheet's side padding; in a pair, in the lesson text's. */
const KEY = "@min-[688px]/room:right-[max(34px,calc((100%-872px)/2-48px))]";
const PAIR_KEY = "@min-[1468px]/room:right-[calc((100%-min(100%-64px,1588px))/2+726px)]";

/** Text blocks whose lines the window's top edge may cut. */
const LINES = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th";
const BLOCKS = "pre, img, figure, table, .katex-display";

/** Whether the column lays its sheets side by side (its container query decides). */
function sideBySide(column: HTMLElement | null): boolean {
	return column !== null && getComputedStyle(column).display === "grid";
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
 * lesson text's sheet and, while something waits, "Your turn", each as tall as what it holds.
 * With room for both they sit side by side and "Your turn" holds still while the text scrolls
 * (turnStick); with less it sits under the text. The page rests where restingTop says: on open,
 * when the teacher asks (`restKey` changes) and while the teacher writes. Scrolled up, the key
 * in the corner brings the learner back.
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
	/** The lesson text's sheet. */
	reading: ReactNode;
	/** "Your turn", while something waits. */
	turn: ReactNode | null;
}) {
	const [paired, setPaired] = useState(turn !== null);
	const pair = keepPair(paired, turn !== null, busy);
	if (pair !== paired) setPaired(pair);

	const columnRef = useRef<HTMLDivElement>(null);
	const turnRef = useRef<HTMLDivElement>(null);

	// The teacher writing back while "Your turn" stays open makes its reply the newest thing.
	const replyRef = useRef(false);
	// Lines keep their place while the teacher writes; the page only settles on a whole line at rest.
	const busyRef = useRef(busy);
	busyRef.current = busy;
	const target = useCallback<GetTargetScrollTop>((end, { scrollElement, contentElement }) => {
		const origin = contentElement.getBoundingClientRect().top;
		const sheetEl = contentElement.querySelector("[data-testid=turn-sheet]");
		const sheetBox = sheetEl?.getBoundingClientRect();
		const partBox = contentElement.querySelector("[data-part-current]")?.getBoundingClientRect();
		const reply = replyRef.current ? [...contentElement.querySelectorAll("[data-testid=user-message]")].at(-1) : null;
		const rest = restingTop(end, {
			view: scrollElement.clientHeight,
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
	useLayoutEffect(() => {
		const started = busy && !wasBusy.current;
		wasBusy.current = busy;
		if (!started) return;
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
	const firstKey = useRef(restKey);
	useLayoutEffect(() => {
		replyRef.current = false;
		if (restKey === firstKey.current) return;
		firstKey.current = restKey;
		void contextRef.current?.scrollToBottom(prefersReducedMotion() ? "instant" : "smooth");
		const frame = requestAnimationFrame(settleUp);
		return () => cancelAnimationFrame(frame);
	}, [restKey, contextRef, settleUp]);

	// Beside the text, "Your turn" holds still as the page scrolls, measured against the window.
	const [stick, setStick] = useState<CSSProperties | undefined>();
	const hasTurn = turn !== null;
	useLayoutEffect(() => {
		const el = turnRef.current;
		const scroller = contextRef.current?.scrollRef.current;
		const column = columnRef.current;
		if (!el || !scroller || !column) return;
		const place = () => setStick(sideBySide(column) ? { position: "sticky", ...turnStick(el.offsetHeight, scroller.clientHeight) } : undefined);
		const ro = new ResizeObserver(place);
		ro.observe(el);
		ro.observe(scroller);
		ro.observe(column);
		return () => ro.disconnect();
	}, [hasTurn, contextRef]);

	return (
		<div className="@container/room flex min-h-0 min-w-0 flex-col [grid-area:main]">
			{/* A sheet of its own, so the page scrolls under its edge; shown only when the step line draws something. */}
			<div className={`shrink-0 pt-5 [&:not(:has(>section>div>*))]:hidden ${GUTTERS}`}>
				<Pane className={cn("@container/strip", COLUMN, pair && PAIR)}>
					<div className="px-14 py-4 @max-[640px]/strip:px-7">{steps}</div>
				</Pane>
			</div>
			<Conversation className="min-h-0 min-w-0 flex-1" initial="instant" contextRef={contextRef} targetScrollTop={target}>
				<SessionMessageNavigation />
				<ConversationContent className="gap-0 p-0" scrollClassName="[overflow-anchor:none]">
					<div className={`pt-6 pb-7 ${GUTTERS}`}>
						<div ref={columnRef} data-testid="lesson-column" className={cn("@container/column flex flex-col gap-7", COLUMN, pair && [PAIR, PAIR_GRID])}>
							{reading}
							{turn && (
								<div ref={turnRef} className="min-w-0" style={stick}>
									{turn}
								</div>
							)}
						</div>
					</div>
				</ConversationContent>
				<ConversationScrollButton className={cn(KEY, pair && PAIR_KEY)} />
			</Conversation>
		</div>
	);
}
