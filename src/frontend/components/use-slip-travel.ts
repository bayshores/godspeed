/**
 * A slip that arrives from past its room's foot by `away` (a CSS length, and in points for its
 * time) each time it is drawn anew, and leaves the same way, kept there by presence until it is
 * gone. One that `arrives` false (it came with the page) is simply there. `onArrived` follows an
 * arrival. With reduced motion nothing moves.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { EASE_IN, EASE_OUT, prefersReducedMotion } from "./presence";
import { travelMs } from "./slip-travel-model";

export function useSlipTravel(arrives: boolean, leaving: boolean, away: (el: HTMLElement) => { by: string; points: number }, onArrived: () => void = () => {}) {
	const [el, setEl] = useState<HTMLElement | null>(null);
	const now = useRef({ arrives, away, onArrived });
	now.current = { arrives, away, onArrived };
	useLayoutEffect(() => {
		if (!el?.animate || !now.current.arrives || prefersReducedMotion()) return;
		const { by, points } = now.current.away(el);
		el.animate([{ transform: `translateY(${by})` }, { transform: "none" }], { duration: travelMs(points, "in"), easing: EASE_OUT }).finished.then(
			() => now.current.onArrived(),
			() => {},
		);
	}, [el]);
	useLayoutEffect(() => {
		if (!leaving || !el?.animate || prefersReducedMotion()) return;
		const { by, points } = now.current.away(el);
		const out = el.animate([{ transform: "none" }, { transform: `translateY(${by})` }], { duration: travelMs(points, "out"), easing: EASE_IN, fill: "forwards" });
		// Opened again before it has left, it is back at once.
		return () => out.cancel();
	}, [leaving, el]);
	return { ref: setEl, el };
}
