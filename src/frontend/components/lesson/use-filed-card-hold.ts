import { useCallback, useMemo, useRef, type RefObject } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";

/** How far the card has pushed what is under it: its height and the room over it. */
function pushOf(card: HTMLElement): number {
	return card.getBoundingClientRect().height + (parseFloat(getComputedStyle(card).marginTop) || 0);
}

/**
 * A task's card opening in the lesson text (FiledCard) makes the page taller above what the
 * learner reads. The page is moved by as much as the card has grown, each frame, so the lines
 * under the card hold still and the older text above it makes the room. `onFile` is what
 * FiledCard calls when a card begins to open; `opened` measures the page as it will stand once
 * every such card is open.
 */
export function useFiledCardHold(contextRef: RefObject<StickToBottomContext | null>): {
	onFile: (card: HTMLElement, open: Animation) => void;
	opened: <T>(measure: () => T) => T;
} {
	const opening = useRef(new Set<Animation>());
	const onFile = useCallback(
		(card: HTMLElement, open: Animation) => {
			if (typeof ResizeObserver === "undefined") return;
			let pushed = pushOf(card);
			// A scroll position is a whole number: the parts of a point are kept for the next frame.
			let owed = 0;
			const ro = new ResizeObserver(() => {
				const context = contextRef.current;
				const scroller = context?.scrollRef.current;
				const push = pushOf(card);
				owed += push - pushed;
				pushed = push;
				const whole = Math.round(owed);
				// A card under the window moves nothing the learner sees.
				if (!context || !scroller || whole === 0 || card.getBoundingClientRect().top >= scroller.getBoundingClientRect().bottom) return;
				context.state.scrollTop += whole;
				owed -= whole;
			});
			ro.observe(card);
			opening.current.add(open);
			const done = () => {
				opening.current.delete(open);
				ro.disconnect();
			};
			open.finished.then(done, done);
		},
		[contextRef],
	);
	const opened = useCallback(<T>(measure: () => T): T => {
		const at = [...opening.current].map((open) => [open, open.currentTime] as const);
		// Just short of its end a card has its whole height and is not yet done.
		for (const [open] of at) open.currentTime = Number(open.effect?.getComputedTiming().endTime ?? 0) - 0.01;
		const out = measure();
		for (const [open, time] of at) open.currentTime = time;
		return out;
	}, []);
	return useMemo(() => ({ onFile, opened }), [onFile, opened]);
}
