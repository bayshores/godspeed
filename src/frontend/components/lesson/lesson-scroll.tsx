import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/frontend/components/ai-elements/conversation";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { SessionMessageNavigation } from "@/frontend/components/session-navigation";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { cn } from "@/frontend/lib/utils";
import { TurnPlaceContext, TurnSlotsContext, type TurnPlace } from "./turn-place";
import { FilingContext } from "@/frontend/components/filed-card";
import { usePageRest } from "./use-page-rest";

/**
 * The lesson text's reading measure: the page's one width of its own. Everything else takes
 * the shared page width and sides (`.lh-page`). With room for both (1280 = the text's 632, the
 * gap, the task's 560 and two page sides; a container query cannot read the tokens), the lesson
 * is a book: open, the lesson text and the task sit side by side across the page's width, sized
 * by `.lh-lesson-room`; shut, the text is one page in the middle, as wide as the open book's left
 * page (`.lh-lesson-closed`). With less room the text is one column.
 */
const READING_MEASURE = "mx-auto w-full max-w-[760px]";
const PAIR = "@min-[1280px]/room:max-w-none";
const PAIR_GRID = "@min-[1280px]/room:grid @min-[1280px]/room:grid-cols-[minmax(0,1fr)_var(--lh-turn)] @min-[1280px]/room:items-start";
/** The task with no lesson text yet: in the middle, at the width it keeps in the pair. */
const ALONE = "@min-[1280px]/room:max-w-(--lh-turn)";
/** The task moving over as the lesson text arrives beside it. */
const MAKE_ROOM = { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };

/** The jump key: in the gutter beside one column where the window leaves room, else at the text's side; in a pair, at the lesson text's. */
const KEY = "@min-[688px]/room:right-[max(34px,calc((100%-760px)/2-48px))]";
const PAIR_KEY = "@min-[1280px]/room:right-[calc((100%-var(--lh-pair))/2+var(--lh-turn)+38px)]";
const SHUT_KEY = "@min-[1280px]/room:right-[calc((100%-var(--lh-text))/2-48px)]";
/** The writing row under the shut book's one page: as wide as that page. */
const SHUT_FOOT = "@min-[1280px]/room:max-w-(--lh-text)";
/** Marks the room as wide enough for the book, for the layout to read. */
const WIDE_MARK = "@min-[1280px]/room:[--lh-wide:1]";

/** The glide to a new resting place: firm enough to arrive in about a third of a second, with no
 *  long creep at its end, which reads as the page shaking. */
const SETTLE = { damping: 0.6, stiffness: 0.12, mass: 1 };


/** The room at which the right page keeps the task the learner last finished: lower, its box and keys
 *  leave that task a sliver, so it is drawn in the text as in a narrow window. */
const KEEP_ROOM = 520;

/** Subscribes to what never changes. */
const NO_CHANGE = () => () => {};

/** Whether the room is wide enough for the book (the column's container query marks it). */
function wideRoom(column: HTMLElement | null): boolean {
	return column !== null && getComputedStyle(column).getPropertyValue("--lh-wide").trim() === "1";
}

/** Puts the turn's parts in `slot`, in order; the box the learner types in keeps the keyboard. */
function moveTo(slot: HTMLElement, ...parts: HTMLElement[]): void {
	if (parts.every((part, i) => slot.children[i] === part)) return;
	const typing = parts.some((part) => part.contains(document.activeElement)) ? (document.activeElement as HTMLElement) : null;
	slot.append(...parts);
	typing?.focus({ preventScroll: true });
}

function turnBox(): HTMLElement {
	return Object.assign(document.createElement("div"), { className: "contents" });
}

/**
 * THE LESSON PAGE: the step line on top, then the lesson text, which scrolls, and the learner's
 * turn, which has two parts (YourTurn): the task (a question, a problem, what is next) and the
 * writing row. In one column the writing row is pinned at the window's foot for the whole lesson,
 * a question stands in the page under the text, and an open problem is pinned over the text
 * (`pin`), where it folds to leave the text its room. With room for both (the book) and something
 * to work on (`open`), the text and the turn sit side by side: the turn holds still while the text
 * scrolls, the task over the writing row. While the lesson text draws nothing (a lesson that opens
 * with a problem), the turn sits alone in the middle; when the text arrives, it slides over to its
 * side. The parts are drawn into boxes of their own, which this page moves between those places:
 * moving a box keeps what the learner typed and picked, where drawing it anew would not. Where the
 * page stands in its window is usePageRest's. The turn fades out when it closes (a lesson reset)
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
	pin,
	place,
	onPlace,
}: {
	/** The step line; nothing when the lesson has none. */
	steps: ReactNode;
	/** Changes when the teacher asks something new (a question, a problem, a part, a stop). */
	restKey: string;
	busy: boolean;
	contextRef: RefObject<StickToBottomContext | null>;
	/** The lesson text; null while the turn is up and the text draws nothing. */
	reading: ReactNode | null;
	/** The learner's turn (YourTurn), once the lesson has started. */
	turn: ReactNode | null;
	/** The book lies open: the learner has a question, a problem or the task he last finished to work on. */
	open: boolean;
	/** The book is about to shut: the kept task leaves the right page, then `onShut` is called (useBook). */
	shutting: boolean;
	onShut: () => void;
	/** The pages stand where the book now lies (useBook's `rest`). */
	onRest: () => void;
	/** The task is an open problem: in one column it is pinned over the text. */
	pin: boolean;
	/** Where the task stands, as this page last laid it out, and the way to say so. */
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
	const roomRef = useRef<HTMLDivElement>(null);
	const underRef = useRef<HTMLDivElement>(null);
	const topRef = useRef<HTMLDivElement>(null);
	const topSlot = useRef<HTMLDivElement>(null);
	const footRef = useRef<HTMLDivElement>(null);
	const footSlot = useRef<HTMLDivElement>(null);
	// A page drawn to text has no window to move its parts in: there the turn is drawn in the column.
	const inWindow = useSyncExternalStore(NO_CHANGE, () => true, () => false);
	const [boxes] = useState(() => (inWindow ? { task: turnBox(), row: turnBox() } : null));
	useLayoutEffect(() => {
		const room = roomRef.current;
		const under = underRef.current;
		const page = turnRef.current;
		if (!room || !under || !page || !hasTurn || !boxes) return;
		const lay = () => {
			// Side by side, or alone in a wide room, the right page holds the task over the writing row.
			const together = wideRoom(columnRef.current) && (beside || alone);
			const pinned = !together && pin;
			const top = topRef.current;
			const foot = footRef.current;
			// Shown before a part moves in: a box in a hidden place cannot take the keyboard back.
			if (top && pinned) top.hidden = false;
			if (foot && !together) foot.hidden = false;
			if (together) moveTo(page, boxes.task, boxes.row);
			else {
				if (topSlot.current && footSlot.current) moveTo(pinned ? topSlot.current : page, boxes.task);
				if (footSlot.current) moveTo(footSlot.current, boxes.row);
			}
			if (top && !pinned) top.hidden = true;
			if (foot && together) foot.hidden = true;
			onPlace(together ? (alone ? "alone" : under.clientHeight < KEEP_ROOM ? "tight" : "beside") : pinned ? "pinned" : "under");
		};
		lay();
		const ro = new ResizeObserver(lay);
		ro.observe(room);
		ro.observe(under);
		return () => ro.disconnect();
	}, [hasTurn, alone, beside, pin, boxes, onPlace]);
	// Where the turn stood alone, to slide it from there when the text takes its side.
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


	const slots = useMemo(() => ({ ...boxes, closing, stepIn: stepIn === true }), [boxes, closing, stepIn]);
	return (
		<div ref={roomRef} className="lh-lesson-room @container/room flex min-h-0 min-w-0 flex-col [grid-area:main]">
			{/* Shown only when the step line draws something; one that arrives after the lesson opened steps in with the
			    reply's text (the step plays when :has() shows it). */}
			<div ref={stepsRef} className="lh-page shrink-0 pt-5 [&:not(:has(>div>*))]:hidden">
				<div className={cn(stepsLate && "lh-block-in [--lh-block-delay:var(--lh-dur-fast)]", READING_MEASURE, PAIR)}>{steps}</div>
			</div>
			<div ref={underRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				{/* An open problem, pinned over the text in one column (its height: .lh-turn-top). */}
				<div ref={topRef} hidden className="lh-turn-top lh-page flex min-h-0 shrink-0 flex-col pt-5">
					<div ref={topSlot} className={cn("flex min-h-0 flex-col", READING_MEASURE)} />
				</div>
				<Conversation className="min-h-0 min-w-0 flex-1" initial="instant" resize="instant" {...SETTLE} contextRef={contextRef} targetScrollTop={rest.target}>
					<SessionMessageNavigation />
					<ConversationContent className="gap-0 p-0" scrollClassName={cn("lh-lesson-window [overflow-anchor:none] [container-type:size]", beside && "lh-lesson-pair", alone && "lh-lesson-alone", shut && "lh-lesson-closed", pinned && "lh-lesson-pinned")}>
						<div className="lh-page py-6">
							<div ref={columnRef} data-testid="lesson-column" className={cn("lh-lesson-column @container/column flex flex-col gap-8", READING_MEASURE, WIDE_MARK, reading !== null && PAIR, beside && PAIR_GRID, alone && ALONE)}>
								<FilingContext.Provider value={rest.onFile}>{reading}</FilingContext.Provider>
								{hasTurn && (
									<TurnPlaceContext.Provider value={place}>
										<div ref={turnRef} className="lh-turn-fit min-w-0 [&:not(:has(>*>*))]:hidden">
											<TurnSlotsContext.Provider value={slots}>{shownTurn}</TurnSlotsContext.Provider>
										</div>
									</TurnPlaceContext.Provider>
								)}
							</div>
						</div>
					</ConversationContent>
					<ConversationScrollButton className={cn(KEY, shut && SHUT_KEY, (beside || alone) && PAIR_KEY)} />
				</Conversation>
				{/* The writing row, pinned for the whole lesson. */}
				<div ref={footRef} hidden className="lh-turn-foot lh-page shrink-0 pt-1 pb-5">
					<div ref={footSlot} className={cn("@container/foot", READING_MEASURE, SHUT_FOOT)} />
				</div>
			</div>
		</div>
	);
}
