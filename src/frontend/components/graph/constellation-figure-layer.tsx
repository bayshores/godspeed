/**
 * The near Graph picture: each topic drawn as its figure
 * (constellation-figure.ts). Every line shows as a faint ghost; a line is
 * half lit when one of its facts is lit and lit when both are, drawing in from
 * the basics up once a flight lands on the topic. Facts are small squares, then
 * moons (constellation-moon.ts) from MOON_PITCH, where arrows show which way
 * each line runs. A pointed or open fact shows its path: what it needs in
 * ink, what it leads to dashed, the rest dimmed; a pointed one shows its name
 * on a tag.
 */
import { useEffect, useState } from "react";
import { PANEL_ANSWER_COLOR } from "./derive.ts";
import { factPath, isLit, lineLight, type Figures, type FigureLine } from "./constellation-figure.ts";
import { MOON_HALF, moonPaths, unaskedColor } from "./constellation-moon.ts";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { factMark, type FactProgress } from "@/shared/core";
import type { Cluster } from "./constellation-layout.ts";
import { DIM, FAINT } from "./styles.ts";

/** Half a square star's drawn size before facts turn into moons. */
const SQUARE_HALF = 5;
/** The draw-in waits for the flight, then runs DRAW_MS from the basics up, each line taking LINE_MS. */
const WAIT_MS = 300;
const DRAW_MS = 600;
const LINE_MS = 200;
/** How long after a landing new lines still draw in: the flight, the wait and the draw, with room for a late frame. */
const DRAW_WINDOW = 300 + WAIT_MS + DRAW_MS + 200;
/** How far what a pointed fact leads to fades back: lighter than its path, brighter than the rest. */
const LEADS = 0.55;
/** A pointed star's name tag: its line height and its longest name, in letters. */
export const TAG_H = 22;
const TAG_CHARS = 44;
/** The name tag's text size (text-xs). */
export const TAG_PX = 12;

/** Half a fact's drawn size near: a square, or a moon from MOON_PITCH. */
export const starHalf = (moons: boolean) => (moons ? MOON_HALF : SQUARE_HALF);

/** A name tag's text, cut to TAG_CHARS, and its width with its padding. */
export function tagLabel(name: string, measure: (s: string) => number): { text: string; w: number } {
	const text = name.length > TAG_CHARS ? `${name.slice(0, TAG_CHARS - 1).trimEnd()}…` : name;
	return { text, w: Math.ceil(measure(text)) + 16 };
}

/** A line from star to star, stopped `trim` short of both centres so it ends at the stars' edges. */
function linePath(a: readonly [number, number], z: readonly [number, number], trim: number): string | null {
	const len = Math.hypot(z[0] - a[0], z[1] - a[1]);
	if (len <= 2 * trim) return null;
	const [ux, uy] = [(z[0] - a[0]) / len, (z[1] - a[1]) / len];
	return `M${(a[0] + ux * trim).toFixed(1)} ${(a[1] + uy * trim).toFixed(1)}L${(z[0] - ux * trim).toFixed(1)} ${(z[1] - uy * trim).toFixed(1)}`;
}

/** A small open arrow in the middle of a line from `a` to `z`, pointing at `z`. */
function arrow(a: readonly [number, number], z: readonly [number, number]): string {
	const len = Math.hypot(z[0] - a[0], z[1] - a[1]);
	if (len < 4 * MOON_HALF) return "";
	const [ux, uy] = [(z[0] - a[0]) / len, (z[1] - a[1]) / len];
	const p = (s: number, n: number) => `${((a[0] + z[0]) / 2 + ux * s - uy * n).toFixed(1)} ${((a[1] + z[1]) / 2 + uy * s + ux * n).toFixed(1)}`;
	return `M${p(-2.5, -3.5)}L${p(2, 0)}L${p(-2.5, 3.5)}`;
}

/** A square outline `w` thick around (cx, cy), half-side `h`, as one even-odd path. */
function squareFrame(cx: number, cy: number, h: number, w: number): string {
	const [x, y, s] = [Math.round(cx - h), Math.round(cy - h), Math.round(2 * h)];
	return `M${x} ${y}h${s}v${s}h-${s}zM${x + w} ${y + w}v${s - 2 * w}h${s - 2 * w}v-${s - 2 * w}z`;
}

/** A fact's square: lit ones solid ink, asked ones in their latest answer's colour, never asked ones hollow. */
function squarePath(f: FactProgress, x: number, y: number): { fill: string; d: string } {
	const latest = factMark(f);
	if (!latest) return { fill: unaskedColor(f), d: squareFrame(x, y, SQUARE_HALF, 2) };
	const d = `M${Math.round(x - SQUARE_HALF)} ${Math.round(y - SQUARE_HALF)}h${2 * SQUARE_HALF}v${2 * SQUARE_HALF}h-${2 * SQUARE_HALF}z`;
	return { fill: isLit(f) ? "var(--foreground)" : PANEL_ANSWER_COLOR[latest], d };
}

/** What a part of the figure is to the pointed fact: on its path back to the basics, ahead of it, neither, or there is no pointed fact. */
type Role = "all" | "needs" | "leads" | "rest";

/** Faint and marked lines, gathered into a few paths; they never animate, so how they are grouped can change freely. */
interface Marks {
	ghost: string;
	needs: string;
	leads: string;
	arrows: [string, string, string];
}
const noMarks = (): Marks => ({ ghost: "", needs: "", leads: "", arrows: ["", "", ""] });

/** A lit or half lit line, drawn on its own so it keeps its element while the pointer moves or the view pans. */
interface Lit {
	key: string;
	d: string;
	full: boolean;
	/** Its place in the draw-in, 0 (from a basic fact) to 1. */
	at: number;
	role: Role;
}

/** The topic a flight just landed on, while its lines draw in; null otherwise. */
export function useDrawIn(landed: { topic: string; seq: number } | null): { topic: string; seq: number } | null {
	const [done, setDone] = useState<number | null>(null);
	useEffect(() => {
		if (!landed) return;
		const t = window.setTimeout(() => setDone(landed.seq), DRAW_WINDOW);
		return () => window.clearTimeout(t);
	}, [landed]);
	return landed && landed.seq !== done ? landed : null;
}

/** Paths gathered by colour, so a topic is a handful of elements however many facts it has. */
class Inks {
	readonly paths = new Map<string, string>();
	add = (p: { fill: string; d: string }) => this.paths.set(p.fill, (this.paths.get(p.fill) ?? "") + p.d);
	draw(key: string, opacity?: number) {
		return [...this.paths].map(([fill, d]) => <path key={key + fill} d={d} fill={fill} fillRule="evenodd" opacity={opacity} />);
	}
}

export function FigureLayer({
	clusters,
	figures,
	factById,
	at,
	shown,
	moons,
	lit,
	keep,
	drawIn,
	pointId,
}: {
	/** The clusters near the view, their stars where they are drawn now. */
	clusters: readonly Cluster[];
	figures: Figures;
	factById: ReadonlyMap<string, FactProgress>;
	/** A layout point on screen. */
	at: (x: number, y: number) => [number, number];
	/** Whether a layout point is near the view. */
	shown: (x: number, y: number) => boolean;
	moons: boolean;
	/** Topics drawn full; the rest dim. Null: all full. */
	lit: ReadonlySet<string> | null;
	/** The facts Find keeps full ink; null with nothing typed. */
	keep: ReadonlySet<string> | null;
	/** The topic whose lit lines draw in now (useDrawIn). */
	drawIn: { topic: string; seq: number } | null;
	/** The pointed fact, else the open one. */
	pointId: string | null;
}) {
	const half = starHalf(moons);
	const animate = !prefersReducedMotion();
	return (
		<g data-testid="graph-figures" className="lh-fade">
			{clusters.map((k) => {
				const mine: readonly FigureLine[] = figures.lines.get(k.topic.id) ?? [];
				const pointed = pointId && k.stars.some((s) => s.id === pointId) ? pointId : null;
				const path = pointed ? factPath(mine, pointed) : null;
				const onPath = (id: string) => id === pointed || !!path?.needs.has(id);
				const lineRole = (l: FigureLine): Role => (!path ? "all" : onPath(l.to) && path.needs.has(l.from) ? "needs" : (l.from === pointed || path.leadsTo.has(l.from)) && path.leadsTo.has(l.to) ? "leads" : "rest");
				const top = Math.max(1, ...mine.map((l) => figures.steps.get(l.to) ?? 0));
				const groups = { near: noMarks(), rest: noMarks() };
				const litLines: Lit[] = [];
				const place = new Map(k.stars.map((s) => [s.id, s]));
				for (const l of mine) {
					const a = place.get(l.from);
					const z = place.get(l.to);
					if (!a || !z || (!shown(a.cx, a.cy) && !shown(z.cx, z.cy))) continue;
					const [pa, pz] = [at(a.cx, a.cy), at(z.cx, z.cy)];
					const d = linePath(pa, pz, half + 2);
					if (!d) continue;
					const role = lineRole(l);
					const g = role === "rest" ? groups.rest : groups.near;
					const light = lineLight(l, factById);
					if (role === "leads") g.leads += d;
					else g.ghost += d;
					if (role === "needs") g.needs += d;
					if (light > 0) litLines.push({ key: `${l.from}>${l.to}`, d, full: light === 2, at: (figures.steps.get(l.from) ?? 0) / top, role });
					if (moons) g.arrows[role === "leads" ? 0 : light] += arrow(pa, pz);
				}
				const full = new Inks();
				const ahead = new Inks();
				const dim = new Inks();
				const faint = new Inks();
				let frame = "";
				for (const st of k.stars) {
					const f = factById.get(st.id);
					if (!f || !shown(st.cx, st.cy)) continue;
					const [x, y] = at(st.cx, st.cy);
					const into = keep && !keep.has(st.id) ? faint : !path || onPath(st.id) ? full : path.leadsTo.has(st.id) ? ahead : dim;
					if (moons) for (const p of moonPaths(f, x, y)) into.add(p);
					else into.add(squarePath(f, x, y));
					if (st.id === pointId) frame = squareFrame(x, y, half + 4, 2);
				}
				const marks = (g: Marks) => (
					<>
						{g.ghost && <path d={g.ghost} fill="none" stroke="var(--foreground)" strokeOpacity={0.16} strokeWidth={1} />}
						{g.needs && <path d={g.needs} fill="none" stroke="var(--foreground)" strokeOpacity={0.8} strokeWidth={1.5} />}
						{g.leads && <path d={g.leads} fill="none" stroke="var(--foreground)" strokeOpacity={0.5} strokeWidth={1.25} strokeDasharray="3 3" />}
					</>
				);
				const arrows = (g: Marks) => (
					<g fill="none" strokeLinecap="square">
						{g.arrows[0] && <path d={g.arrows[0]} stroke="var(--foreground)" strokeOpacity={0.45} strokeWidth={1.25} />}
						{g.arrows[1] && <path d={g.arrows[1]} stroke="var(--lh-ink-3)" strokeWidth={1.5} />}
						{g.arrows[2] && <path d={g.arrows[2]} stroke="var(--foreground)" strokeWidth={2} />}
					</g>
				);
				const drawing = animate && drawIn?.topic === k.topic.id;
				return (
					<g key={k.topic.id} data-figure={k.topic.id} opacity={lit && !lit.has(k.topic.id) ? DIM : 1}>
						<g opacity={DIM}>{marks(groups.rest)}</g>
						{marks(groups.near)}
						{/* Keyed by the landing, so each flight into the topic draws its lines in once. */}
						<g key={drawing ? drawIn.seq : "lit"} fill="none">
							{litLines.map((l) => {
								const after = l.at * (DRAW_MS - LINE_MS);
								return (
									<path
										key={l.key}
										d={l.d}
										pathLength={1}
										className={drawing ? "lh-reveal-line" : undefined}
										stroke={l.full ? "var(--foreground)" : "var(--lh-ink-3)"}
										strokeWidth={l.full ? 2 : 1.25}
										// What the pointed fact leads to shows dashed instead.
										opacity={l.role === "leads" ? 0 : l.role === "rest" ? DIM : 1}
										style={drawing ? { ["--lh-at" as string]: `${WAIT_MS + after}ms`, animationDuration: `${LINE_MS}ms` } : undefined}
									/>
								);
							})}
						</g>
						<g opacity={DIM}>{arrows(groups.rest)}</g>
						{arrows(groups.near)}
						{/* Keyed by the stage, so squares turning into moons fade in once. */}
						<g key={moons ? "moons" : "squares"} shapeRendering="crispEdges" className="lh-fade">
							{full.draw("")}
							{ahead.draw("a", LEADS)}
							{dim.draw("d", DIM)}
							{faint.draw("f", FAINT)}
							{frame && <path d={frame} fill="var(--foreground)" fillRule="evenodd" />}
						</g>
					</g>
				);
			})}
		</g>
	);
}

/** The pointed star's name on one line, with a dotted leader when it sits above the topic. */
export function NameTag({ text, left, top, w, leader }: { text: string; left: number; top: number; w: number; leader: { x: number; y0: number; y1: number } | null }) {
	return (
		<>
			{leader && (
				<svg aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-visible">
					<path
						shapeRendering="crispEdges"
						fill="var(--foreground)"
						opacity={0.6}
						d={Array.from({ length: Math.max(0, Math.floor((leader.y1 - leader.y0) / 4)) }, (_, i) => `M${leader.x - 1} ${leader.y0 + i * 4}h2v2h-2z`).join("")}
					/>
				</svg>
			)}
			<div aria-hidden data-testid="graph-name-tag" className="lh-fade lh-sheet pointer-events-none absolute z-20 whitespace-nowrap px-2 text-xs text-foreground" style={{ left, top, width: w, lineHeight: `${TAG_H}px` }}>
				{text}
			</div>
		</>
	);
}
