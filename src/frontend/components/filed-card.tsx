import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { EASE_OUT, prefersReducedMotion } from "@/frontend/components/presence";

/** Told of a card that begins to open in the lesson text, so the page keeps what is under it still (useFiledCardHold). */
export const FilingContext = createContext<((card: HTMLElement, open: Animation) => void) | null>(null);

/**
 * A task's card in the lesson text. While "Your turn" shows the task (`away`) the text leaves it
 * out; when "Your turn" lets it go, the card opens to its height in its place, so the lines
 * around it are moved and never jump. A card that was never away is just there.
 */
export function FiledCard({ away, children }: { away: boolean; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const wasAway = useRef(away);
	if (away) wasAway.current = true;
	const onFile = useContext(FilingContext);
	useLayoutEffect(() => {
		const card = ref.current;
		if (away || !wasAway.current || !card) return;
		wasAway.current = false;
		if (prefersReducedMotion() || typeof card.animate !== "function") return;
		// The room between two rows comes with the card, not before it.
		const gap = parseFloat(getComputedStyle(card.parentElement!).rowGap) || 0;
		card.style.overflow = "clip";
		const open = card.animate([{ height: "0px", marginTop: `${-gap}px`, opacity: 0 }, { height: `${card.offsetHeight}px`, marginTop: "0px", opacity: 1 }], { duration: 220, easing: EASE_OUT });
		const whole = () => (card.style.overflow = "");
		open.finished.then(whole, whole);
		onFile?.(card, open);
	}, [away, onFile]);
	if (away) return null;
	return (
		<div ref={ref} data-testid="filed-card">
			{children}
		</div>
	);
}
