/**
 * The Graph picture's figures (constellation-figure.ts), worked out once per
 * picture and chains, and the sky as drawn now: facts glide into their
 * figure places once the picture is near and back once it is not, a jump
 * with reduced motion.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphChain } from "@/shared/core";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { figuresOf, movedSky, type Figures } from "./constellation-figure.ts";
import type { Sky } from "./constellation-layout.ts";

const GLIDE_MS = 360;

/** 0 (laid out) to 1 (figure places), easing to `on`'s end each time it changes. */
function useGlide(on: boolean): number {
	const [t, setT] = useState(on ? 1 : 0);
	const now = useRef(t);
	now.current = t;
	useEffect(() => {
		const from = now.current;
		const to = on ? 1 : 0;
		if (from === to) return;
		if (prefersReducedMotion()) return setT(to);
		const start = performance.now();
		let raf = 0;
		const tick = (ms: number) => {
			const u = Math.min(1, (ms - start) / GLIDE_MS);
			setT(from + (to - from) * (1 - (1 - u) ** 3));
			if (u < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [on]);
	return t;
}

/** Every topic's figure, and the sky with each fact at its figure place. */
export function useFigures(sky: Sky, chains: readonly Pick<GraphChain, "premises" | "conclusion">[] | null, nn: number) {
	const figures = useMemo(() => figuresOf(sky, chains, nn), [sky, chains, nn]);
	const placed = useMemo(() => movedSky(sky, figures.places, 1), [sky, figures]);
	return { figures, placed };
}

/** The sky as drawn now, and how far (`t`, 0 to 1) its facts have glided to their figure places. */
export function useDrawnSky(sky: Sky, figures: Figures, near: boolean) {
	const t = useGlide(near);
	const drawn = useMemo(() => (t > 0 ? movedSky(sky, figures.places, t) : sky), [sky, figures, t]);
	return { drawn, t };
}
