import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";

/** About as long as the glide to a line just sent: what opens under that line waits for it. */
export const AFTER_GLIDE_MS = 320;

/**
 * The thread's scrolling: at rest at its end when shown; when the learner sends a line, it glides
 * once so that line sits at the top, and then holds still while the reply grows under it. The room
 * under the newest exchange is the scroller's height (--lh-thread-room).
 */
export function useThreadScroll(scroller: React.RefObject<HTMLDivElement | null>, exchange: React.RefObject<HTMLElement | null>, sent: number) {
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const measure = () => {
			const pad = parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom);
			el.style.setProperty("--lh-thread-room", `${Math.max(0, el.clientHeight - pad)}px`);
		};
		measure();
		el.scrollTop = el.scrollHeight;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [scroller]);
	const seen = useRef(sent);
	useLayoutEffect(() => {
		if (sent <= seen.current) {
			seen.current = sent;
			return;
		}
		seen.current = sent;
		const el = scroller.current;
		const newest = exchange.current;
		if (!el || !newest) return;
		el.scrollTo({ top: newest.offsetTop - parseFloat(getComputedStyle(el).paddingTop), behavior: prefersReducedMotion() ? "instant" : "smooth" });
	}, [sent, scroller, exchange]);
}

/** The first card waiting to be allowed while it is out of the thread's view, else null. */
export function useCardAway(scroller: React.RefObject<HTMLDivElement | null>, approvals: readonly { id: string; text: string }[]): { text: string; card: HTMLElement } | null {
	const [away, setAway] = useState<{ text: string; card: HTMLElement } | null>(null);
	const first = approvals[0] ?? null;
	useEffect(() => {
		const el = scroller.current;
		if (!el || !first) {
			setAway(null);
			return;
		}
		const look = () => {
			const card = el.querySelector<HTMLElement>("[data-testid=approval-card]");
			if (!card) return setAway(null);
			const box = el.getBoundingClientRect();
			const at = card.getBoundingClientRect();
			const seen = at.bottom > box.top + 24 && at.top < box.bottom - 24;
			setAway(seen ? null : { text: first.text, card });
		};
		// The card folds open after it mounts, so the first look waits a frame.
		const frame = requestAnimationFrame(look);
		el.addEventListener("scroll", look, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			el.removeEventListener("scroll", look);
		};
	}, [scroller, first]);
	return away;
}
