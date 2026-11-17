/**
 * What the near Graph picture adds under each star: its answers as a row of
 * small squares in their outcome colors, and its name, placed by
 * constellation-near.ts. Both ink in together and fade out together, and
 * a fact Find passed over is faint like its star. Also the in-view counts
 * a zoomed-in picture reports to the foot line.
 */
import { useEffect, useMemo, useRef } from "react";
import type { AnswerOutcome, FactProgress } from "@/shared/core";
import { PANEL_ANSWER_COLOR } from "./derive.ts";
import { HIST_BELOW, HIST_SQ, LABEL_LINE, countInView, historyRow, type InView, type Placed } from "./constellation-near.ts";
import type { Cluster, Rect, Sky } from "./constellation-layout.ts";
import { DIM, FADE, FAINT } from "./styles.ts";

/** Fact names are set a size under topic names. */
export const LABEL_PX = 12;

const fade = (on: boolean) => ({ opacity: on ? 1 : 0, transition: `opacity ${FADE}` });

/** Each star's answer row, one path per outcome per topic (two for a found topic). `at` puts a layout point on screen; `shown` says which stars are near the view. */
export function FactAnswers({
	clusters,
	factById,
	at,
	shown,
	d,
	lit,
	keep,
	on,
}: {
	clusters: readonly Cluster[];
	factById: ReadonlyMap<string, FactProgress>;
	at: (x: number, y: number) => [number, number];
	shown: (x: number, y: number) => boolean;
	/** A star's drawn size. */
	d: number;
	lit: ReadonlySet<string> | null;
	/** The facts Find keeps full ink; null with nothing typed. */
	keep: ReadonlySet<string> | null;
	on: boolean;
}) {
	return (
		<g data-testid="fact-answers" shapeRendering="crispEdges" className={on ? "lh-fade" : undefined} style={fade(on)}>
			{clusters.map((k) => {
				const paths = new Map<string, { o: AnswerOutcome; faint: boolean; d: string }>();
				for (const st of k.stars) {
					const f = factById.get(st.id);
					if (!f?.answers.length || !shown(st.cx, st.cy)) continue;
					const [x, y] = at(st.cx, st.cy);
					const faint = !!keep && !keep.has(st.id);
					for (const q of historyRow(f.answers, x, y + d / 2 + HIST_BELOW)) {
						const key = `${faint}${q.outcome}`;
						const p = paths.get(key) ?? paths.set(key, { o: q.outcome, faint, d: "" }).get(key)!;
						p.d += `M${q.x} ${q.y}h${HIST_SQ}v${HIST_SQ}h-${HIST_SQ}z`;
					}
				}
				return (
					<g key={k.topic.id} opacity={lit && !lit.has(k.topic.id) ? DIM : 1} style={{ transition: `opacity ${FADE}` }}>
						{[...paths].map(([key, p]) => (
							<path key={key} d={p.d} fill={PANEL_ANSWER_COLOR[p.o]} opacity={p.faint ? FAINT : undefined} />
						))}
					</g>
				);
			})}
		</g>
	);
}

export function FactNames({ placed, sky, lit, keep, on }: { placed: readonly Placed[]; sky: Sky; lit: ReadonlySet<string> | null; keep: ReadonlySet<string> | null; on: boolean }) {
	return (
		<div aria-hidden className={`pointer-events-none absolute inset-0 ${on ? "lh-fade" : ""}`} style={fade(on)}>
			{placed.map((p) => {
				const opacity = keep && !keep.has(p.id) ? FAINT : lit && !lit.has(sky.starById.get(p.id)?.topicId ?? "") ? DIM : 1;
				return (
					<div
						key={p.id}
						data-testid="fact-name"
						data-fact-id={p.id}
						className="absolute text-center text-ink-2"
						style={{ left: p.left, top: p.top, width: p.w, fontSize: LABEL_PX, lineHeight: `${LABEL_LINE}px`, opacity, transition: `opacity ${FADE}` }}
					>
						{p.lines.map((ln, i) => (
							<span key={i} className="block whitespace-nowrap">
								{ln}
							</span>
						))}
					</div>
				);
			})}
		</div>
	);
}

/** Reports what is in `view` (null at the whole space) each time the counts change, and null once the picture goes. */
export function useInViewReport(sky: Sky, view: Rect | null, onInView: (v: InView | null) => void) {
	const inView = useMemo(() => (view ? countInView(sky, view) : null), [sky, view?.x0, view?.x1, view?.y0, view?.y1]);
	const report = useRef(onInView);
	report.current = onInView;
	const key = inView ? `${inView.topics}:${inView.facts}:${inView.name}` : "";
	useEffect(() => report.current(inView), [key]);
	useEffect(() => () => report.current(null), []);
}
