import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/frontend/components/ai-elements/conversation";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { SessionMessageNavigation } from "@/frontend/components/session-navigation";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { TurnPlaceContext, type TurnPlace } from "./turn-place";
import { FilingContext } from "@/frontend/components/filed-card";
import { usePageRest } from "./use-page-rest";

/**
 * The lesson text's reading measure: the page's one width of its own. Everything else takes
 * the shared page width and sides (`.lh-page`). With room for both (1280 = the text's 632, the
 * gap, "Your turn"'s 560 and two page sides; a container query cannot read the tokens), the lesson
 * is a book: open, the lesson text and "Your turn" sit side by side across the page's width, sized
 * by `.lh-lesson-room`; shut, the text is one page in the middle, as wide as the open book's left
 * page (`.lh-lesson-closed`), with "Your turn" pinned under its window. With less room the text is
 * one column and "Your turn" is pinned under its window.
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
const SHUT_KEY = "@min-[1280px]/room:right-[calc((100%-var(--lh-text))/2-48px)]";
/** The pinned "Your turn" under the shut book's one page: as wide as that page. */
const SHUT_FOOT = "@min-[1280px]/room:max-w-(--lh-text)";

/** The glide to a new resting place: firm enough to arrive in about a third of a second, with no
 *  long creep at its end, which reads as the page shaking. */
const SETTLE = { damping: 0.6, stiffness: 0.12, mass: 1 };


/** The room under the step line at which "Your turn" is pinned under the text's window: lower, a question
 *  with its box and keys would leave the text a sliver, so there it stays in the page, under the text.
 *  Under the shut book's page it is pinned in any room while it is only its box and keys (`slim`). */
const PIN_ROOM = 640;

/** The room at which the right page keeps the task the learner last finished: lower, its box and keys
 *  leave that task a sliver, so it is drawn in the text as in a narrow window. */
const KEEP_ROOM = 520;

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


/**
 * THE LESSON PAGE: the step line pinned on top, then the page that scrolls as a whole: the
 * lesson text's sheet and, once the lesson has started, "Your turn". With room for both the
 * lesson is a book. While the learner has something to work on (`open`: a question, a problem, or
 * the task he last finished) it lies open: the two sit side by side and "Your turn" holds still
 * while the text scrolls, always inside the window, where only its question or problem scrolls
 * (.lh-turn-fit). With nothing to work on it is shut: one page in the middle with "Your turn" a
 * strip pinned under it. With less room it is
 * pinned at the window's foot, under the window the text scrolls in, only as tall as what the
 * learner can do now (TurnPlaceContext), so the text keeps the window, or, in a room too low for that
 * (PIN_ROOM), it sits in the page under the text. While the lesson text draws nothing (a
 * lesson that opens with a problem), its sheet is left out and "Your turn" sits alone in the
 * middle; when the text's sheet arrives, "Your turn" slides over to its side. Where the page
 * stands in its window is usePageRest's. "Your turn" fades out when it closes (a lesson reset)
 * and, arriving with a reply, steps in after the reply's text. Scrolled up, the key in the corner
 * brings the learner back.
 */
export function LessonScroll({
	steps,
	restKey,
	busy,
	contextRef,
	reading,
	turn,
	open,
	shutting,
	onShut,
	onRest,
	slim,
	place,
	onPlace,
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
	/** The book lies open: the learner has a question, a problem or the task he last finished to work on. */
	open: boolean;
	/** The book is about to shut: the kept task leaves the right page, then `onShut` is called (useBook). */
	shutting: boolean;
	onShut: () => void;
	/** The pages stand where the book now lies (useBook's `rest`). */
	onRest: () => void;
	/** "Your turn" holds only its box and keys. */
	slim: boolean;
	/** Where "Your turn" stands, as this page last laid it out, and the way to say so. */
	place: TurnPlace;
	onPlace: (place: TurnPlace) => void;
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
	const beside = pair && open;
	const shut = reading !== null && !beside;
	const pinned = place === "pinned";

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
	useLayoutEffect(() => {
		const room = roomRef.current;
		const under = underRef.current;
		if (!room || !under || !hasTurn || !turnBox) return;
		const place = () => {
			const column = columnRef.current;
			const stacked = pair && oneColumn(column);
			// The room is wide enough for the book (the column's container query lifts its reading measure).
			const wide = column !== null && getComputedStyle(column).maxWidth === "none";
			const pin = stacked && (under.clientHeight >= PIN_ROOM || (wide && slim));
			const slot = (pin ? footSlot : pageSlot).current;
			const foot = footRef.current;
			// Shown and hidden here, with the move, so no frame draws the foot's room without its sheet. Shown before
			// the sheet moves in: a box in a hidden place cannot take the keyboard back.
			if (foot && pin) foot.hidden = false;
			if (slot && turnBox.parentElement !== slot) moveTurn(turnBox, slot);
			if (foot && !pin) foot.hidden = true;
			onPlace(alone ? "alone" : pin ? "pinned" : stacked ? "under" : under.clientHeight < KEEP_ROOM ? "tight" : "beside");
		};
		place();
		const ro = new ResizeObserver(place);
		ro.observe(room);
		ro.observe(under);
		return () => ro.disconnect();
	}, [hasTurn, pair, alone, beside, slim, turnBox, onPlace]);
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

	const rest = usePageRest({ contextRef, roomRef, columnRef, turnRef, footRef, busy, pinned, restKey, beside, open, shutting, onShut, onRest });
	// A step line the lesson opened with is just there; one that arrives later steps in.
	const stepsRef = useRef<HTMLDivElement>(null);
	const [stepsLate, setStepsLate] = useState(false);
	useLayoutEffect(() => setStepsLate(stepsRef.current?.getClientRects().length === 0), []);


	const turnSheet = (
		<TurnPlaceContext.Provider value={place}>
			<div
				ref={turnRef}
				data-state={closing ? "closed" : "open"}
				inert={closing}
				className={cn("lh-turn-fit min-w-0", closing ? "lh-fade" : stepIn && "lh-block-in")}
				style={{ "--lh-block-delay": "240ms" } as CSSProperties}
			>
				{shownTurn}
			</div>
		</TurnPlaceContext.Provider>
	);
	return (
		<div ref={roomRef} className="lh-lesson-room @container/room flex min-h-0 min-w-0 flex-col [grid-area:main]">
			{/* A sheet of its own. The page scrolls in the window a gap under it, where every sheet's top edge stops, so the
			    lesson text and "Your turn" begin at one height. Shown only when the step line draws something; one that
			    arrives after the lesson opened steps in with the reply's text (the step plays when :has() shows it). */}
			<div ref={stepsRef} className="lh-page shrink-0 pt-(--lh-gap) [&:not(:has(>section>div>*))]:hidden">
				<Pane className={cn("@container/strip", stepsLate && "lh-block-in [--lh-block-delay:var(--lh-dur-fast)]", READING_MEASURE, PAIR)}>
					<div className="px-(--lh-reading-inset) py-4 @max-[640px]/strip:px-(--lh-reading-inset-narrow)">{steps}</div>
				</Pane>
			</div>
			<div ref={underRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				<Conversation className="my-(--lh-gap) min-h-0 min-w-0 flex-1" initial="instant" resize="instant" {...SETTLE} contextRef={contextRef} targetScrollTop={rest.target}>
					<SessionMessageNavigation />
					<ConversationContent className="gap-0 p-0" scrollClassName={cn("lh-lesson-window [overflow-anchor:none] [container-type:size]", beside && "lh-lesson-pair", alone && "lh-lesson-alone", shut && "lh-lesson-closed", pinned && "lh-lesson-pinned")}>
						{/* With "Your turn" beside it or pinned under its window, the text's sheet ends at the window's foot. */}
						<div className={cn("lh-page", pinned ? "pb-0" : "pb-(--lh-page-end)", (beside || alone) && "@min-[1280px]/room:pb-0")}>
							<div ref={columnRef} data-testid="lesson-column" className={cn("lh-lesson-column @container/column flex flex-col gap-(--lh-gap)", READING_MEASURE, reading !== null && PAIR, beside && PAIR_GRID, alone && ALONE)}>
								<FilingContext.Provider value={rest.onFile}>{reading}</FilingContext.Provider>
								{hasTurn && (
									<div ref={pageSlot} className="contents">
										{!turnBox && turnSheet}
									</div>
								)}
							</div>
						</div>
					</ConversationContent>
					<ConversationScrollButton className={cn(KEY, shut && SHUT_KEY, (beside || alone) && PAIR_KEY)} />
				</Conversation>
				{/* "Your turn" pinned (its height: .lh-turn-foot). */}
				<div ref={footRef} hidden className="lh-turn-foot lh-page flex min-h-0 shrink-0 flex-col pb-(--lh-gap)">
					<div ref={footSlot} className={cn("@container/foot flex min-h-0 flex-col", READING_MEASURE, SHUT_FOOT)} />
				</div>
			</div>
			{hasTurn && turnBox && createPortal(turnSheet, turnBox)}
		</div>
	);
}
