/**
 * What a zoomed-in Graph picture holds, for the foot line: the topics in
 * view, their facts and how many of those are lit, and the topic's name when
 * it is the only one.
 */
import { useEffect, useMemo, useRef } from "react";
import type { FactProgress } from "@/shared/core";
import { isLit } from "./constellation-figure.ts";
import type { Rect, Sky } from "./constellation-layout.ts";

export interface InView {
	topics: number;
	facts: number;
	lit: number;
	name: string | null;
}

/**
 * A topic is in view when at least half its facts are, and then all its
 * facts count; when none reaches half, the topic with the most facts in view
 * counts. Ungrouped never counts. `sky` holds the stars where they are drawn.
 */
export function countInView(sky: Pick<Sky, "clusters">, view: Rect, factById: ReadonlyMap<string, Pick<FactProgress, "answers">>): InView {
	const seen = sky.clusters
		.filter((k) => !k.muted && k.stars.length > 0)
		.map((k) => ({ k, n: k.stars.filter((st) => st.cx >= view.x0 && st.cx <= view.x1 && st.cy >= view.y0 && st.cy <= view.y1).length }))
		.filter((s) => s.n > 0);
	const half = seen.filter((s) => 2 * s.n >= s.k.stars.length);
	const most = seen.reduce<(typeof seen)[number] | null>((a, s) => (!a || s.n > a.n ? s : a), null);
	const counted = (half.length ? half : most ? [most] : []).map((s) => s.k);
	const stars = counted.flatMap((k) => k.stars);
	return { topics: counted.length, facts: stars.length, lit: stars.filter((st) => isLit(factById.get(st.id))).length, name: counted.length === 1 ? counted[0]!.topic.name : null };
}

/** Reports what is in `view` (null at the whole space) each time the counts change, and null once the picture goes. */
export function useInViewReport(sky: Pick<Sky, "clusters">, view: Rect | null, factById: ReadonlyMap<string, Pick<FactProgress, "answers">>, onInView: (v: InView | null) => void) {
	const inView = useMemo(() => (view ? countInView(sky, view, factById) : null), [sky, view?.x0, view?.x1, view?.y0, view?.y1, factById]);
	const report = useRef(onInView);
	report.current = onInView;
	const key = inView ? `${inView.topics}:${inView.facts}:${inView.lit}:${inView.name}` : "";
	useEffect(() => {
		report.current(inView);
	}, [key]);
	useEffect(
		() => () => {
			report.current(null);
		},
		[],
	);
}
