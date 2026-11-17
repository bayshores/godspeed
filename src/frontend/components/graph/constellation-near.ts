/**
 * What the near Graph picture adds under each star: its answers as a row of
 * small squares, and its name, placed so no name touches another star or
 * name. Screen points throughout. Also what a zoomed-in view holds, for the
 * foot line. Pure.
 */
import type { AnswerOutcome, AnswerRef, FactProgress } from "@/shared/core";
import { wrap, type Cluster, type Measure, type Rect, type Sky } from "./constellation-layout.ts";

/** A history square's side, the gap between two, and the gap under the star. */
export const HIST_SQ = 4;
const HIST_GAP = 1;
export const HIST_BELOW = 3;
/** The most answers a row shows: the latest ones. */
const HIST_MAX = 8;
/** A fact name's widest line, its line height, and the room kept clear around it. */
export const LABEL_W = 92;
export const LABEL_LINE = 15;
const LABEL_ROOM = 3;
/** How far a topic's name moves down once fact names show, so the lowest star's row and two-line name fit above it. */
export const NAME_DROP = HIST_BELOW + HIST_SQ + 3 + 2 * LABEL_LINE + 2;

/** Each square of a star's history row, oldest first, centred under (cx, top). */
export function historyRow(answers: readonly Pick<AnswerRef, "outcome">[], cx: number, top: number): { x: number; y: number; outcome: AnswerOutcome }[] {
	const shown = answers.slice(-HIST_MAX);
	const w = shown.length * (HIST_SQ + HIST_GAP) - HIST_GAP;
	const x0 = Math.round(cx - w / 2);
	return shown.map((a, i) => ({ x: x0 + i * (HIST_SQ + HIST_GAP), y: Math.round(top), outcome: a.outcome }));
}

export interface LabelAsk {
	id: string;
	/** The star's centre and drawn size. */
	cx: number;
	cy: number;
	d: number;
	/** Whether a history row sits between the star and its name. */
	row: boolean;
	lines: string[];
	/** The widest line. */
	w: number;
}

export interface Placed {
	id: string;
	left: number;
	top: number;
	w: number;
	lines: string[];
}

const meets = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** The box a star and its history row take. */
function starBox(a: Pick<LabelAsk, "cx" | "cy" | "d" | "row">): Rect {
	const h = a.d / 2;
	return { x0: a.cx - Math.max(h, a.row ? 20 : 0), x1: a.cx + Math.max(h, a.row ? 20 : 0), y0: a.cy - h, y1: a.cy + h + (a.row ? HIST_BELOW + HIST_SQ : 0) };
}

/**
 * Names under their stars, in the order asked, each kept only if it fits
 * inside `view` and touches no star, no fixed block (topic names) and no
 * name already placed. A name that does not fit waits for the pointer.
 */
export function placeLabels(asks: readonly LabelAsk[], blocks: readonly Rect[], view: Rect): Placed[] {
	const stars = asks.map(starBox);
	const taken: Rect[] = [];
	const out: Placed[] = [];
	asks.forEach((a, i) => {
		const top = stars[i]!.y1 + (a.row ? 3 : 4);
		const box: Rect = { x0: a.cx - a.w / 2, x1: a.cx + a.w / 2, y0: top, y1: top + a.lines.length * LABEL_LINE };
		const grown: Rect = { x0: box.x0 - LABEL_ROOM, x1: box.x1 + LABEL_ROOM, y0: box.y0 - 1, y1: box.y1 + LABEL_ROOM };
		if (box.x0 < view.x0 || box.x1 > view.x1 || box.y0 < view.y0 || box.y1 > view.y1) return;
		if (stars.some((s, j) => j !== i && meets(grown, s))) return;
		if (blocks.some((b) => meets(grown, b)) || taken.some((b) => meets(grown, b))) return;
		taken.push(box);
		out.push({ id: a.id, left: box.x0, top, w: a.w, lines: a.lines });
	});
	return out;
}

/** A fact name's lines and widest line, wrapped once per name for this measure. */
export function factNameText(measure: Measure): (name: string) => { lines: string[]; w: number } {
	const known = new Map<string, { lines: string[]; w: number }>();
	return (name) => {
		let t = known.get(name);
		if (!t) {
			const { w, text } = wrap(name, LABEL_W, measure, 0);
			t = { lines: text, w };
			known.set(name, t);
		}
		return t;
	};
}

/**
 * The fact names of `clusters` placed under their stars: `at` puts a layout
 * point on screen, `shown` says which stars are near the view, `blocks` are
 * the topic names drawn. The open fact (`first`) is placed first, so it
 * always shows; the rest keep each topic's star order.
 */
export function placeFactNames({
	clusters,
	factById,
	text,
	at,
	shown,
	d,
	blocks,
	view,
	first,
}: {
	clusters: readonly Cluster[];
	factById: ReadonlyMap<string, FactProgress>;
	text: (name: string) => { lines: string[]; w: number };
	at: (x: number, y: number) => [number, number];
	shown: (x: number, y: number) => boolean;
	/** A star's drawn size. */
	d: number;
	blocks: readonly Rect[];
	view: Rect;
	first: string | null;
}): Placed[] {
	const asks: (LabelAsk & { order: number })[] = [];
	for (const k of clusters)
		k.stars.forEach((st, i) => {
			const f = factById.get(st.id);
			if (!f || !shown(st.cx, st.cy)) return;
			const [cx, cy] = at(st.cx, st.cy);
			const t = text(f.name);
			asks.push({ id: st.id, cx, cy, d, row: f.answers.length > 0, lines: t.lines, w: t.w, order: st.id === first ? -1 : i });
		});
	asks.sort((a, b) => a.order - b.order);
	return placeLabels(asks, blocks, view);
}

/** What is in view while zoomed in: the foot line counts it, and names the topic when it is the only one. */
export interface InView {
	topics: number;
	facts: number;
	name: string | null;
}

/** The stars inside `view` (layout points), and the topics they belong to, Ungrouped left out. */
export function countInView(sky: Sky, view: Rect): InView {
	const seen = new Set<string>();
	let facts = 0;
	for (const st of sky.stars)
		if (st.cx >= view.x0 && st.cx <= view.x1 && st.cy >= view.y0 && st.cy <= view.y1) {
			facts++;
			if (sky.byTopic.get(st.topicId)?.muted === false) seen.add(st.topicId);
		}
	const only = seen.size === 1 ? sky.byTopic.get([...seen][0]!) : undefined;
	return { topics: seen.size, facts, name: only?.topic.name ?? null };
}
