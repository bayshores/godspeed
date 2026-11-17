import { useCallback, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import type { GetTargetScrollTop, StickToBottomContext } from "use-stick-to-bottom";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/frontend/components/ai-elements/conversation";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { SessionMessageNavigation } from "@/frontend/components/session-navigation";
import { Pane } from "@/frontend/components/ui/pane";
import { restingTop } from "./lesson-scroll-model";

/** The column's width and its sides, shared by the step line and the page so their edges meet. */
const COLUMN = "mx-auto w-full max-w-[872px]";
const GUTTERS = "px-8 @max-[899px]/lesson:px-6";

/**
 * THE LESSON PAGE: the step line pinned on top, then one centered column that scrolls as a
 * whole, the lesson text's sheet and, while something waits, "Your turn" under it, each as tall
 * as what it holds. The page rests where restingTop says: on open, when the teacher asks
 * (`restKey` changes) and while the teacher writes. Scrolled up, the key in the corner brings
 * the learner back.
 */
export function LessonScroll({
	steps,
	restKey,
	busy,
	contextRef,
	children,
}: {
	/** The step line; nothing when the lesson has none. */
	steps: ReactNode;
	/** Changes when the teacher asks something new (a question, a problem, a part, a stop). */
	restKey: string;
	busy: boolean;
	contextRef: RefObject<StickToBottomContext | null>;
	children: ReactNode;
}) {
	// The teacher writing back while "Your turn" stays open makes its reply the newest thing.
	const replyRef = useRef(false);
	const target = useCallback<GetTargetScrollTop>((end, { scrollElement, contentElement }) => {
		const origin = contentElement.getBoundingClientRect().top;
		const top = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().top - origin : null);
		const reply = replyRef.current ? [...contentElement.querySelectorAll("[data-testid=user-message]")].at(-1) : null;
		return restingTop(end, {
			view: scrollElement.clientHeight,
			sheet: top(contentElement.querySelector("[data-testid=turn-sheet]")),
			part: top(contentElement.querySelector("[data-part-current]")),
			reply: top(reply),
		});
	}, []);

	const wasBusy = useRef(busy);
	useLayoutEffect(() => {
		const started = busy && !wasBusy.current;
		wasBusy.current = busy;
		if (!started) return;
		replyRef.current = true;
		// The reply starts above where the page rests, and following the page only moves it down.
		const frame = requestAnimationFrame(() => {
			const context = contextRef.current;
			if (!context || context.state.escapedFromLock) return;
			const rest = context.state.calculatedTargetScrollTop;
			if (rest < context.state.scrollTop) context.state.scrollTop = rest;
		});
		return () => cancelAnimationFrame(frame);
	}, [busy, contextRef]);
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
		if (restKey !== firstKey.current) void contextRef.current?.scrollToBottom(prefersReducedMotion() ? "instant" : "smooth");
		firstKey.current = restKey;
	}, [restKey, contextRef]);

	return (
		<div className="flex min-h-0 min-w-0 flex-col [grid-area:main]">
			{/* A sheet of its own, so the page scrolls under its edge; shown only when the step line draws something. */}
			<div className={`shrink-0 pt-5 [&:not(:has(>section>div>*))]:hidden ${GUTTERS}`}>
				<Pane className={`@container/strip ${COLUMN}`}>
					<div className="px-14 py-4 @max-[640px]/strip:px-7">{steps}</div>
				</Pane>
			</div>
			<Conversation className="@container/page min-h-0 min-w-0 flex-1" initial="instant" contextRef={contextRef} targetScrollTop={target}>
				<SessionMessageNavigation />
				<ConversationContent className="gap-0 p-0" scrollClassName="[overflow-anchor:none]">
					<div className={`pt-6 pb-7 ${GUTTERS}`}>
						<div data-testid="lesson-column" className={`@container/column flex flex-col gap-7 ${COLUMN}`}>
							{children}
						</div>
					</div>
				</ConversationContent>
				{/* Beside the column where the window leaves room, else in the sheet's side padding, never on words. */}
				<ConversationScrollButton className="@min-[688px]/page:right-[max(34px,calc((100%-872px)/2-48px))]" />
			</Conversation>
		</div>
	);
}
