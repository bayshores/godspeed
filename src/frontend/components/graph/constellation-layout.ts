/**
 * Where the Graph picture puts things: every fact a small square star, every
 * topic a sunflower cluster of its stars with its name under it, clusters by
 * level from left to right. Pure and deterministic: the same data and width
 * always give the same picture. Name widths come in through `measure`.
 */
import { UNTESTED_COLOR, rampColor, type FactProgress, type TopicLink, type TopicProgress } from "@/shared/core";
import { factRate } from "@/frontend/components/fact-cells";
import { topicCountLine } from "./derive.ts";

export interface Star {
	id: string;
	topicId: string;
	/** Top-left corner, whole points. */
	x: number;
	y: number;
	/** Centre. */
	cx: number;
	cy: number;
	color: string;
}

export interface Cluster {
	topic: TopicProgress;
	cx: number;
	cy: number;
	r: number;
	stars: Star[];
	/** The top of the name, which sits centred under the cluster. */
	nameTop: number;
	/** The widest name line as drawn, status mark included: the name's button is exactly this wide. */
	textW: number;
	/** The name as drawn, one entry per line (one or two). */
	text: string[];
	/** Width of the score line that shows under the name on hover. */
	tipW: number;
	/** Ungrouped facts: drawn quieter, never linked. */
	muted: boolean;
}

export interface Sky {
	width: number;
	height: number;
	/** Star size in points. */
	s: number;
	clusters: Cluster[];
	byTopic: Map<string, Cluster>;
	stars: Star[];
	starById: Map<string, Star>;
}

/** A drawn line as x, y pairs a few points apart, so any bend draws as one path. */
export interface Seg {
	from: string;
	to: string;
	pts: number[];
	/** The direction the line arrives in, for its arrowhead. */
	ux: number;
	uy: number;
}

export interface Rect {
	x0: number;
	x1: number;
	y0: number;
	y1: number;
}

type Measure = (text: string) => number;

/** The box a name's button takes: its ink, centred under the cluster. */
export function nameBox(k: Pick<Cluster, "cx" | "nameTop" | "textW" | "text">): Rect {
	return { x0: k.cx - k.textW / 2, x1: k.cx + k.textW / 2, y0: k.nameTop, y1: k.nameTop + k.text.length * NAME_LINE };
}

const GOLD = Math.PI * (3 - Math.sqrt(5));
export const NAME_LINE = 17;
const NAME_GAP = 7;
const PAD_TOP = 14;
const PAD_BOTTOM = 10;
/** The height a sky aims for before its levels wrap into more columns. */
const TARGET_H = 540;
/** A sky shorter than this spreads its columns out to it, so lines have room to pass. */
const ROOMY_H = 590;
/** Room for the status square before a tested topic's name (9 points and its gap). */
export const MARK_W = 14;
const GAP_Y = 16;
/** Clusters closer than this get pushed apart; tests hold the layout to it. */
export const CLEAR = 14;

/** A stable 0 to 1 number per id, for the small fixed offsets that make the picture read as a sky, not a table. */
function hash(s: string, salt = 0): number {
	let h = 2166136261 ^ salt;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	h ^= h >>> 13;
	h = Math.imul(h, 0x5bd1e995);
	h ^= h >>> 15;
	return (h >>> 0) / 4294967296;
}

function factColor(f: FactProgress): string {
	if (f.answers.length > 0) return rampColor(factRate(f));
	// Not studied: a step brighter than the page's dot grid, so it never reads as part of it.
	return f.inLessons ? UNTESTED_COLOR : "color-mix(in srgb, var(--foreground) 30%, var(--background))";
}

/** Best known first, so a cluster lights up from its core as it is learned. */
function factOrder(f: FactProgress): number {
	if (f.answers.length > 0) return -(factRate(f) ?? 0);
	return f.inLessons ? 1 : 2;
}

function starSize(n: number, width: number): number {
	// A small space gets bigger stars, so a lone cluster still reads as the picture.
	let s = n <= 40 ? 10 : n <= 120 ? 8 : n <= 450 ? 7 : n <= 650 ? 6 : n <= 850 ? 5 : 4;
	if (width < 1150) s = Math.min(s, 6);
	if (width < 760) s = Math.min(s, 5);
	return s;
}

/**
 * Two lines at most, broken only between words, as even as they fit; an
 * ellipsis only ends the second line. `mark` is the room the status square
 * takes before the first line. `w` is the widest line as drawn.
 */
function wrap(name: string, maxW: number, measure: Measure, mark: number): { w: number; text: string[] } {
	const words = name.split(/\s+/).filter(Boolean);
	const full = words.join(" ");
	const fw = measure(full) + mark;
	if (fw <= maxW || words.length === 1) return { w: Math.ceil(fw), text: [full] };
	let best: string[] | null = null;
	let bw = Infinity;
	for (let i = 1; i < words.length; i++) {
		const a = words.slice(0, i).join(" ");
		const z = words.slice(i).join(" ");
		const wide = Math.max(measure(a) + mark, measure(z));
		if (wide <= maxW && wide < bw) {
			bw = wide;
			best = [a, z];
		}
	}
	if (best) return { w: Math.ceil(bw), text: best };
	let i = 1;
	while (i < words.length - 1 && measure(words.slice(0, i + 1).join(" ")) + mark <= maxW) i++;
	const first = words.slice(0, i).join(" ");
	const rest = words.slice(i);
	let j = Math.max(1, rest.length - 1);
	let second = `${rest.slice(0, j).join(" ")}…`;
	while (j > 1 && measure(second) > maxW) second = `${rest.slice(0, --j).join(" ")}…`;
	return { w: Math.ceil(Math.max(measure(first) + mark, measure(second))), text: [first, second] };
}

interface Box {
	t: TopicProgress;
	r: number;
	w: number;
	h: number;
	text: string[];
	textW: number;
	/** Disc centre x and box top, once placed. */
	cx: number;
	top: number;
}

/** Each topic's strongest "needs" link (heaviest, then the nearest level): what its vertical place follows. */
function parents(links: readonly TopicLink[], level: ReadonlyMap<string, number>): Map<string, string> {
	const best = new Map<string, TopicLink>();
	const gap = (l: TopicLink) => (level.get(l.to) ?? 0) - (level.get(l.from) ?? 0);
	for (const l of links) {
		const cur = best.get(l.to);
		if (!cur || l.weight > cur.weight || (l.weight === cur.weight && gap(l) < gap(cur))) best.set(l.to, l);
	}
	return new Map([...best].map(([to, l]) => [to, l.from]));
}

export function layoutSky(topics: readonly TopicProgress[], links: readonly TopicLink[], facts: readonly FactProgress[], width: number, measure: Measure): Sky {
	const factById = new Map(facts.map((f) => [f.id, f]));
	const total = topics.reduce((n, t) => n + t.members.length, 0);
	const s = starSize(total, width);
	const c = s * 1.1;
	const radius = (n: number) => c * Math.sqrt(Math.max(1, n)) + s / 2;

	const grouped = topics.filter((t) => !t.ungrouped);
	const loose = topics.filter((t) => t.ungrouped);
	const ids = new Set(grouped.map((t) => t.id));
	const live = links.filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to);
	const levels = Math.max(0, ...grouped.map((t) => t.column)) + 1;

	const maxR = Math.max(...topics.map((t) => radius(t.members.length)), 8);
	const wmin = Math.max(2 * maxR + 10, width < 1000 ? 78 : width < 1200 ? 90 : 100);

	const makeBox = (t: TopicProgress, nameMax: number): Box => {
		const r = radius(t.members.length);
		// A single long word may run past the column rather than be cut mid-word.
		const longest = Math.max(...t.name.split(/\s+/).map((x) => measure(x)));
		nameMax = Math.max(nameMax, Math.min(132, Math.ceil(longest) + 4));
		const mark = t.status !== "untested" && !t.ungrouped ? MARK_W : 0;
		let { w, text } = wrap(t.name, nameMax, measure, mark);
		// Rather than cut a name, let it run a little wider than its column; the overlap pass makes room.
		for (let m = nameMax + 8; text[1]?.endsWith("…") && m <= 136; m += 8) ({ w, text } = wrap(t.name, m, measure, mark));
		return { t, r, w: Math.max(2 * r, w), h: 2 * r + NAME_GAP + text.length * NAME_LINE, text, textW: w, cx: 0, top: 0 };
	};

	const boxes: Box[] = [];
	let height: number;

	if (live.length === 0 || levels < 2) {
		// No links to show: a calm grid, by level then name, Ungrouped last.
		const all = [...grouped].sort((a, b) => a.column - b.column || a.name.localeCompare(b.name)).concat(loose);
		const cell0 = Math.max(2 * maxR + 28, 136);
		const fits = Math.max(1, Math.floor(width / cell0));
		const cols = Math.min(all.length + (loose.length ? 1 : 0), fits);
		const cell = all.length < fits ? cell0 : width / cols;
		const gap = 30;
		const rows: Box[][] = [];
		let slot = 0;
		for (const t of all) {
			// Ungrouped stands apart: skip a cell when the row has one free.
			if (t.ungrouped && slot % cols !== 0 && slot % cols < cols - 1) slot++;
			const b = makeBox(t, cell - 16);
			b.cx = (slot % cols) * cell + cell / 2;
			(rows[Math.floor(slot / cols)] ??= []).push(b);
			boxes.push(b);
			slot++;
		}
		let y = PAD_TOP;
		for (const row of rows) {
			if (!row) continue;
			const rr = Math.max(...row.map((b) => b.r));
			for (const b of row) {
				const slack = Math.max(0, (cell - b.w) / 2 - 6);
				b.cx += (hash(b.t.id, 1) - 0.5) * 2 * Math.min(slack, cell * 0.1);
				b.top = y + rr - b.r + Math.round((hash(b.t.id, 2) - 0.5) * 6);
			}
			y += Math.max(...row.map((b) => rr - b.r + b.h)) + gap;
		}
		height = y - gap + PAD_BOTTOM + 3;
		// The grid starts flush with the left edge, under the search box.
		const left = Math.min(...boxes.map((b) => b.cx - b.w / 2));
		for (const b of boxes) b.cx -= left;
	} else {
		// Levels left to right; the order inside a level follows the levels around it (barycentre sweeps).
		const byLevel: TopicProgress[][] = Array.from({ length: levels }, () => []);
		for (const t of grouped) byLevel[t.column]!.push(t);
		for (const lv of byLevel) lv.sort((a, b) => a.name.localeCompare(b.name));
		const pos = new Map<string, number>();
		const setPos = () => byLevel.forEach((lv) => lv.forEach((t, i) => pos.set(t.id, (i + 0.5) / lv.length)));
		setPos();
		const ins = (id: string) => live.filter((l) => l.to === id).map((l) => l.from);
		const outs = (id: string) => live.filter((l) => l.from === id).map((l) => l.to);
		const bary = (ns: string[], self: string) => (ns.length ? ns.reduce((a, n) => a + pos.get(n)!, 0) / ns.length : pos.get(self)!);
		for (let it = 0; it < 4; it++) {
			for (let l = 1; l < levels; l++) {
				byLevel[l]!.sort((a, b) => bary(ins(a.id), a.id) - bary(ins(b.id), b.id) || a.name.localeCompare(b.name));
				setPos();
			}
			for (let l = levels - 2; l >= 0; l--) {
				byLevel[l]!.sort((a, b) => bary(outs(a.id), a.id) - bary(outs(b.id), b.id) || a.name.localeCompare(b.name));
				setPos();
			}
		}

		const parent = parents(live, new Map(grouped.map((t) => [t.id, t.column])));
		const est = byLevel.map((lv) => lv.map((t) => makeBox(t, Math.max(wmin - 8, 84))));
		const colH = (col: Box[]) => col.reduce((a, b) => a + b.h, 0) + GAP_Y * (col.length - 1);
		// How many sub-columns a level needs to stay under H.
		const colsFor = (lv: Box[], H: number) => {
			for (let k = 1; k <= lv.length; k++) if (Array.from({ length: k }, (_, j) => lv.filter((_, i) => i % k === j)).every((col) => colH(col) <= H)) return k;
			return lv.length;
		};
		const looseCols = loose.length ? 1.6 : 0;
		const allowed = Math.floor(width / wmin);
		const tallest = Math.max(...est.map(colH));
		let H = Math.min(tallest, TARGET_H);
		let ks = est.map((lv) => colsFor(lv, H));
		while (ks.reduce((a, b) => a + b, 0) + looseCols > allowed && H < tallest) {
			H += 12;
			ks = est.map((lv) => colsFor(lv, H));
		}
		const w = Math.min(width / (ks.reduce((a, b) => a + b, 0) + looseCols), 230);
		H = Math.max(H, ROOMY_H, ...est.flat().map((b) => b.h));
		const nameMax = Math.min(Math.max(w - 8, 84), 170);

		let x0 = 0;
		byLevel.forEach((lv, l) => {
			const k = ks[l]!;
			const lb = lv.map((t) => makeBox(t, nameMax));
			for (let j = 0; j < k; j++) {
				const col = lb.filter((_, i) => i % k === j);
				const sum = col.reduce((a, b) => a + b.h, 0);
				// A short column breathes: wider gaps, up to a limit.
				const g = Math.max(GAP_Y, Math.min(40, (H - sum) / (col.length + 1)));
				let acc = (H - sum - g * (col.length - 1)) / 2;
				// Ideal centres: evenly packed, blended with where the topics they need sit.
				const mine = col.map((b) => {
					const even = acc + b.h / 2;
					acc += b.h + g;
					const pid = parent.get(b.t.id);
					const from = (pid ? [pid] : ins(b.t.id)).map((id) => boxes.find((x) => x.t.id === id)).filter((x): x is Box => !!x);
					const by = from.length ? from.reduce((a, x) => a + x.top + x.h / 2 - PAD_TOP, 0) / from.length : even;
					return { b, y: 0.5 * even + 0.5 * by + (hash(b.t.id, 3) - 0.5) * 16 - b.h / 2 };
				});
				mine.sort((a, b) => a.y - b.y);
				for (let i = 1; i < mine.length; i++) mine[i]!.y = Math.max(mine[i]!.y, mine[i - 1]!.y + mine[i - 1]!.b.h + g);
				mine[0]!.y = Math.max(0, mine[0]!.y);
				for (let i = mine.length - 1; i >= 0; i--) {
					const next = mine[i + 1];
					mine[i]!.y = Math.min(mine[i]!.y, next ? next.y - g - mine[i]!.b.h : H - mine[i]!.b.h);
				}
				// The whole column sits around the picture's middle, give or take a little.
				const top = Math.min(...mine.map((m) => m.y));
				const bot = Math.max(...mine.map((m) => m.y + m.b.h));
				let shift = (H - (bot - top)) / 2 - top + (hash(`${l}:${j}`, 5) - 0.5) * 24;
				shift = Math.max(-top, Math.min(H - bot, shift));
				const colX = x0 + (j + 0.5) * w;
				for (const { b, y } of mine) {
					const slack = Math.max(0, (w - b.w) / 2 - 5);
					b.cx = colX + (hash(b.t.id, 1) - 0.5) * 2 * Math.min(slack, w * 0.22);
					b.top = PAD_TOP + Math.max(0, y + shift);
					boxes.push(b);
				}
			}
			x0 += k * w;
		});
		// Ungrouped sits apart after the last level.
		x0 += 0.6 * w;
		loose.forEach((t, i) => {
			const b = makeBox(t, nameMax);
			b.cx = x0 + w / 2;
			b.top = PAD_TOP + (H * (i + 0.5)) / loose.length - b.h / 2;
			boxes.push(b);
		});
		// Names may run wider than their column: push down anything that still touches.
		const ext = (b: Box) => Math.max(b.r, b.textW / 2) + 3;
		boxes.sort((a, z) => a.top - z.top);
		for (let i = 0; i < boxes.length; i++) {
			const b = boxes[i]!;
			for (let pass = 0; pass < 8; pass++) {
				let moved = false;
				for (let j = 0; j < i; j++) {
					const a = boxes[j]!;
					if (Math.abs(a.cx - b.cx) >= ext(a) + ext(b)) continue;
					if (b.top >= a.top + a.h + CLEAR || a.top >= b.top + b.h + CLEAR) continue;
					b.top = a.top + a.h + CLEAR;
					moved = true;
				}
				if (!moved) break;
			}
		}
		// The picture is as tall as what is in it: no empty band above or below.
		const top0 = Math.min(...boxes.map((b) => b.top));
		for (const b of boxes) b.top += PAD_TOP - top0;
		height = Math.max(...boxes.map((b) => b.top + b.h)) + PAD_BOTTOM;
	}

	const clusters: Cluster[] = [];
	const stars: Star[] = [];
	for (const b of boxes) {
		// Every cluster and name button stays wholly inside the picture.
		const half = Math.max(b.r, b.textW / 2);
		const cx = Math.max(Math.ceil(half), Math.min(Math.floor(width - half), Math.round(b.cx)));
		const cy = Math.round(b.top + b.r);
		const fs = b.t.members.map((id) => factById.get(id)).filter((f): f is FactProgress => !!f);
		fs.sort((a, z) => factOrder(a) - factOrder(z) || a.name.localeCompare(z.name));
		const turn = hash(b.t.id, 4) * Math.PI * 2;
		const mine: Star[] = fs.map((f, i) => {
			const rr = c * Math.sqrt(i + 0.5);
			const a = i * GOLD + turn;
			const x = Math.round(cx + rr * Math.cos(a) - s / 2);
			const y = Math.round(cy + rr * Math.sin(a) - s / 2);
			return { id: f.id, topicId: b.t.id, x, y, cx: x + s / 2, cy: y + s / 2, color: factColor(f) };
		});
		stars.push(...mine);
		clusters.push({
			topic: b.t,
			cx,
			cy,
			r: b.r,
			stars: mine,
			nameTop: Math.round(b.top + 2 * b.r + NAME_GAP),
			textW: b.textW,
			text: b.text,
			// The score line is set a size smaller than the name.
			tipW: Math.ceil((measure(topicCountLine(b.t.members.length, b.t)) * 12) / 13),
			muted: !!b.t.ungrouped,
		});
	}
	return {
		width,
		height: Math.ceil(height),
		s,
		clusters,
		byTopic: new Map(clusters.map((k) => [k.topic.id, k])),
		stars,
		starById: new Map(stars.map((x) => [x.id, x])),
	};
}

/**
 * The lines drawn at rest: for each topic its strongest "needs" link, else its
 * nearest link either way, but only one that is short (at most a third of the
 * picture's width) and that `route` can draw clean. A topic with neither shows
 * no line until it is pointed at.
 */
export function restLines(sky: Sky, links: readonly TopicLink[], route: (from: string, to: string) => Seg | null): Seg[] {
	const live = links.filter((l) => l.from !== l.to && sky.byTopic.get(l.from)?.muted === false && sky.byTopic.get(l.to)?.muted === false);
	const level = (id: string) => sky.byTopic.get(id)!.topic.column;
	const span = (l: TopicLink) => Math.abs(level(l.to) - level(l.from));
	const gapLen = (l: TopicLink) => {
		const a = sky.byTopic.get(l.from)!;
		const z = sky.byTopic.get(l.to)!;
		return Math.hypot(z.cx - a.cx, z.cy - a.cy) - a.r - z.r;
	};
	const rest = new Map<TopicLink, Seg>();
	const shown = new Set<string>();
	// Two topics linked both ways get one line, not two drawn on top of each other.
	const pairs = new Set<string>();
	const pair = (l: TopicLink) => [l.from, l.to].sort().join(">");
	const tryShow = (ls: TopicLink[]) => {
		for (const l of ls) {
			if (gapLen(l) > sky.width / 3 || pairs.has(pair(l))) continue;
			const g = route(l.from, l.to);
			if (!g) continue;
			rest.set(l, g);
			pairs.add(pair(l));
			shown.add(l.from);
			shown.add(l.to);
			return;
		}
	};
	const grouped = sky.clusters.filter((k) => !k.muted).map((k) => k.topic.id);
	for (const id of grouped) tryShow(live.filter((l) => l.to === id).sort((a, z) => z.weight - a.weight || span(a) - span(z) || gapLen(a) - gapLen(z)));
	for (const id of grouped) if (!shown.has(id)) tryShow(live.filter((l) => l.to === id || l.from === id).sort((a, z) => gapLen(a) - gapLen(z)));
	return [...rest.values()];
}
