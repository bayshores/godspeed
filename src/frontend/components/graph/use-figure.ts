/**
 * The Graph picture's figures (constellation-figure.ts), worked out once per
 * picture and chains, and the sky as drawn now: facts glide into their
 * figure places once the picture is near and back once it is not, and
 * travel from their loose squares when the first topics arrive; a jump with
 * reduced motion.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphChain } from "@/shared/core";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { figuresOf, movedSky, type Figures, type Place } from "./constellation-figure.ts";
import type { Sky } from "./constellation-layout.ts";

const GLIDE_MS = 360;
const easeOut = (u: number) => 1 - (1 - u) ** 3;

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
			setT(from + (to - from) * easeOut(u));
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

/** The sky as the first topics arrive: each fact starts at `from` (where its
 *  loose square was, in layout points) and travels to its place; `from` is
 *  null when nothing arrives. */
export function useArrival(sky: Sky, from: ReadonlyMap<string, Place> | null): Sky {
	// Kept with the `from` it belongs to, so a new arrival starts at 0 on its first render.
	const [run, setRun] = useState<{ from: ReadonlyMap<string, Place> | null; t: number }>({ from, t: 1 });
	const t = run.from === from ? run.t : 0;
	useEffect(() => {
		if (!from) return;
		if (prefersReducedMotion()) return setRun({ from, t: 1 });
		const start = performance.now();
		let raf = 0;
		const tick = (ms: number) => {
			const u = Math.min(1, Math.max(0, (ms - start) / GLIDE_MS));
			setRun({ from, t: easeOut(u) });
			if (u < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [from]);
	return useMemo(() => (from && t < 1 ? movedSky(sky, from, 1 - t) : sky), [sky, from, t]);
}
