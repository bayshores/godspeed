/**
 * A topic's figure, once the Graph picture is near: its facts laid out by
 * what comes first, basics at the bottom and each fact above the facts it
 * needs, joined by the chains inside the topic. Facts no chain inside the
 * topic reaches (loose) sit in rows under the figure. Ungrouped has no
 * figure. Layout points. Pure.
 */
import { factMark, type FactProgress, type GraphChain } from "@/shared/core";
import type { Cluster, Sky } from "./constellation-layout.ts";

/** A chain inside one topic: `from` is needed before `to`. */
export interface FigureLine {
	from: string;
	to: string;
}

type Chains = readonly Pick<GraphChain, "premises" | "conclusion">[];
export type Place = { cx: number; cy: number };

/** A fact is lit when its latest answer was right. */
export const isLit = (f: Pick<FactProgress, "answers"> | undefined) => !!f && factMark(f) === "right";

/** How many of a line's two facts are lit. */
export function lineLight(l: FigureLine, factById: ReadonlyMap<string, Pick<FactProgress, "answers">>): 0 | 1 | 2 {
	return (+isLit(factById.get(l.from)) + +isLit(factById.get(l.to))) as 0 | 1 | 2;
}

/**
 * Every chain whose two facts sit in the same topic, once each, by topic.
 * Links to other topics are left out. A fact is in one topic only
 * (crates/core/src/graph/topics.rs places each fact once), so its star's
 * topic is the topic.
 */
function figureLines(chains: Chains | null, sky: Pick<Sky, "starById" | "byTopic">): Map<string, FigureLine[]> {
	const out = new Map<string, FigureLine[]>();
	const seen = new Set<string>();
	for (const c of chains ?? [])
		for (const p of c.premises) {
			const a = sky.starById.get(p);
			const z = sky.starById.get(c.conclusion);
			const key = `${p}>${c.conclusion}`;
			if (!a || !z || a === z || a.topicId !== z.topicId || sky.byTopic.get(a.topicId)?.muted || seen.has(key)) continue;
			seen.add(key);
			(out.get(a.topicId) ?? out.set(a.topicId, []).get(a.topicId)!).push({ from: p, to: c.conclusion });
		}
	return out;
}

/**
 * Each linked fact's step: 0 when it needs nothing in its topic, else one
 * more than the deepest fact it needs. A loop has no first fact: the fact in
 * it with the fewest unmet needs (then the first id) goes next, so the order
 * always ends and is the same every time.
 */
export function stepsOf(lines: readonly FigureLine[]): Map<string, number> {
	const left = new Map<string, number>();
	const outs = new Map<string, string[]>();
	for (const l of lines) {
		left.set(l.from, left.get(l.from) ?? 0);
		left.set(l.to, (left.get(l.to) ?? 0) + 1);
		(outs.get(l.from) ?? outs.set(l.from, []).get(l.from)!).push(l.to);
	}
	const step = new Map<string, number>();
	const queued = new Set<string>();
	const queue: string[] = [];
	const enqueue = (id: string) => (queued.add(id), queue.push(id), step.set(id, step.get(id) ?? 0));
	for (const [id, n] of left) if (n === 0) enqueue(id);
	for (let done = 0; done < left.size; done++) {
		if (queue.length === 0) enqueue([...left].filter(([id]) => !queued.has(id)).sort(([a, x], [b, y]) => x - y || a.localeCompare(b))[0]![0]);
		const id = queue.shift()!;
		for (const n of outs.get(id) ?? []) {
			if (queued.has(n)) continue;
			step.set(n, Math.max(step.get(n) ?? 0, step.get(id)! + 1));
			left.set(n, left.get(n)! - 1);
			if (left.get(n) === 0) enqueue(n);
		}
	}
	return step;
}

/** Everything a fact needs, back to the basics, and everything it leads to, inside its figure. */
export function factPath(lines: readonly FigureLine[], id: string): { needs: Set<string>; leadsTo: Set<string> } {
	const walk = (back: boolean) => {
		const out = new Set<string>();
		const q = [id];
		while (q.length) {
			const at = q.shift()!;
			for (const l of lines) {
				const [a, z] = back ? [l.to, l.from] : [l.from, l.to];
				if (a === at && z !== id && !out.has(z)) (out.add(z), q.push(z));
			}
		}
		return out;
	};
	return { needs: walk(true), leadsTo: walk(false) };
}

/** A steady number from -0.5 to 0.5 for an id, so a figure is uneven the same way every time. */
function jitter(id: string, salt: number): number {
	let h = salt;
	for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 0x9e3779b1);
	h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
	return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32 - 0.5;
}

/** Row gaps as a share of the star gap: as laid out, and the least a tall figure is squeezed to. */
const ROW = 1.05;
const ROW_MIN = 0.6;
/** Gaps between neighbours in a row, and between loose facts. */
const COL = 1.15;
const LOOSE = 0.95;

/** One topic's places around (0, 0), rows in star gaps `g`. */
function placeTopic(k: Cluster, lines: readonly FigureLine[], step: ReadonlyMap<string, number>, g: number): Map<string, [number, number]> {
	const top = Math.max(0, ...step.values());
	const rows: string[][] = Array.from({ length: top + 1 }, () => []);
	for (const s of k.stars) if (step.has(s.id)) rows[step.get(s.id)!]!.push(s.id);
	const loose = k.stars.filter((s) => !step.has(s.id)).map((s) => s.id);
	const needs = new Map<string, string[]>();
	const leads = new Map<string, string[]>();
	for (const l of lines) {
		(needs.get(l.to) ?? needs.set(l.to, []).get(l.to)!).push(l.from);
		(leads.get(l.from) ?? leads.set(l.from, []).get(l.from)!).push(l.to);
	}
	// Each row in order, then a few sweeps setting each fact over the facts it needs and under the ones it leads to, which undoes most crossings.
	const x = new Map<string, number>();
	const lay = (row: string[], want: (id: string) => number) => {
		const w = new Map(row.map((id) => [id, want(id)]));
		row.sort((a, b) => w.get(a)! - w.get(b)! || a.localeCompare(b));
		let prev = -Infinity;
		const xs = row.map((id) => (prev = Math.max(w.get(id)!, prev + 1)));
		const shift = row.reduce((s, id, i) => s + w.get(id)! - xs[i]!, 0) / Math.max(1, row.length);
		row.forEach((id, i) => x.set(id, xs[i]! + shift));
	};
	const home = new Map(k.stars.map((s) => [s.id, s.cx]));
	for (const row of rows) lay(row, (id) => (home.get(id)! - k.cx) / g);
	const mean = (ids: string[] | undefined, id: string) => (ids?.length ? ids.reduce((s, n) => s + x.get(n)!, 0) / ids.length : x.get(id)!);
	for (let pass = 0; pass < 4; pass++)
		if (pass % 2 === 0) for (const row of rows.slice(1)) lay(row, (id) => mean(needs.get(id), id));
		else for (const row of rows.slice(0, -1).reverse()) lay(row, (id) => mean(leads.get(id), id));

	const linked = rows.flat();
	const xs = linked.map((id) => x.get(id)!);
	const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
	const width = xs.length ? (Math.max(...xs) - Math.min(...xs)) * COL : 0;
	// Loose rows as wide as the figure above them, so each topic's rows follow its own shape, and never a tall column.
	const per = Math.max(3, Math.round(width / LOOSE) + 1, Math.ceil(Math.sqrt(2 * loose.length)));
	const looseRows = Math.ceil(loose.length / per);
	const looseH = looseRows > 0 ? (looseRows - 1) * 0.8 * g : 0;
	// A tall figure squeezes its rows (never crossing more) to stay near the cluster's own height.
	const room = 2 * k.r - looseH - (looseRows > 0 ? 1.4 * g : 0);
	const dy = top > 0 ? Math.max(ROW_MIN * g, Math.min(ROW * g, room / top)) : ROW * g;
	const at = new Map<string, [number, number]>();
	for (const id of linked) at.set(id, [(x.get(id)! - mid) * COL * g + jitter(id, 1) * 0.5 * g, (top - step.get(id)!) * dy + jitter(id, 2) * 0.35 * dy]);
	const y0 = linked.length ? top * dy + 1.4 * g : 0;
	loose.forEach((id, i) => {
		const r = Math.floor(i / per);
		const n = Math.min(per, loose.length - r * per);
		at.set(id, [(i - r * per - (n - 1) / 2 + (r % 2) * 0.5) * LOOSE * g + jitter(id, 3) * 0.25 * g, y0 + r * 0.8 * g + jitter(id, 4) * 0.2 * g]);
	});
	return at;
}

export interface Figures {
	/** Each topic's lines. */
	lines: Map<string, FigureLine[]>;
	/** Each linked fact's step (stepsOf). */
	steps: Map<string, number>;
	/** Each fact's place in its figure. */
	places: Map<string, Place>;
}

/** Every topic's figure, its places centred on its cluster and shrunk (to three quarters at most) when it would spill far past it. `nn` is the usual star gap. */
export function figuresOf(sky: Pick<Sky, "clusters" | "starById" | "byTopic">, chains: Chains | null, nn: number): Figures {
	const lines = figureLines(chains, sky);
	const steps = new Map<string, number>();
	const places = new Map<string, Place>();
	for (const k of sky.clusters) {
		if (k.muted) continue;
		const mine = lines.get(k.topic.id) ?? [];
		const step = stepsOf(mine);
		for (const [id, n] of step) steps.set(id, n);
		const at = placeTopic(k, mine, step, nn);
		const xs = [...at.values()].map((p) => p[0]);
		const ys = [...at.values()].map((p) => p[1]);
		if (!xs.length) continue;
		const [mx, my] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
		const half = Math.max(Math.max(...xs) - mx, Math.max(...ys) - my, 1e-6);
		const fit = Math.max(0.75, Math.min(1, (k.r * 1.2) / half));
		for (const [id, [px, py]] of at) places.set(id, { cx: k.cx + (px - mx) * fit, cy: k.cy + (py - my) * fit });
	}
	return { lines, steps, places };
}

/** The sky with its stars `t` (0 to 1) of the way to their figure places. */
export function movedSky(sky: Sky, places: ReadonlyMap<string, Place>, t: number): Sky {
	const move = <S extends Sky["stars"][number]>(s: S): S => {
		const to = places.get(s.id);
		return to ? { ...s, cx: s.cx + (to.cx - s.cx) * t, cy: s.cy + (to.cy - s.cy) * t } : s;
	};
	const clusters = sky.clusters.map((k) => ({ ...k, stars: k.stars.map(move) }));
	const stars = clusters.flatMap((k) => k.stars);
	return { ...sky, clusters, byTopic: new Map(clusters.map((k) => [k.topic.id, k])), stars, starById: new Map(stars.map((s) => [s.id, s])) };
}
