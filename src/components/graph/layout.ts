/**
 * THE TOPIC MAP LAYOUT (redesign plan, Phase 5) — pure, computed once per
 * data change and cached by `layoutKey` (never a live simulation).
 *
 * - Arrows: only the direct ones. A→C is dropped when A already leads to C
 *   through other topics, so long arrows don't sweep across the map.
 * - x: the topic's `column` from progress (longest path from the
 *   foundations), left → right. A column with more than MAX_PER_COLUMN
 *   topics wraps into extra sub-columns, so a class with no arrows yet is
 *   a grid, not one tall line.
 * - y: each column is ordered by the average height of the topics it
 *   connects to, swept left→right and back a few times (fewer crossing
 *   arrows); ties keep the given order. Columns are centered.
 * - Topics with no arrows at all, in a map that has arrows, sit in their
 *   own row under it instead of posing as foundations.
 * - Rings grow with the topic's fact count.
 * - Arrows: a horizontal cubic curve from the right of A's ring to just
 *   before B's ring, plus a small arrowhead triangle.
 */

export const COLUMN_GAP = 160;
export const ROW_GAP = 116;
export const MAX_PER_COLUMN = 6;
/** Label block width under a ring (design: 160px). */
const LABEL_WIDTH = 160;
/** Space under a ring for the name + score lines. */
const LABEL_HEIGHT = 48;
const ARROW_LENGTH = 6;
const ARROW_HALF = 3.5;
const LINK_GAP_START = 4;
const LINK_GAP_END = 3;

interface LayoutTopic {
	id: string;
	column: number;
	/** Fact count (ring size). */
	size: number;
}

interface LayoutLink {
	from: string;
	to: string;
}

export interface PlacedTopic {
	id: string;
	x: number;
	y: number;
	/** Ring diameter. */
	d: number;
}

export interface PlacedLink {
	from: string;
	to: string;
	/** SVG path data for the curve. */
	path: string;
	/** SVG polygon points for the arrowhead. */
	arrow: string;
	/** The curve's midpoint, where a hover label sits. */
	mid: [number, number];
}

interface TopicLayout {
	topics: PlacedTopic[];
	byId: Map<string, PlacedTopic>;
	links: PlacedLink[];
	/** World-space box around every ring, halo and label. */
	bounds: { x: number; y: number; w: number; h: number };
}

/** Ring diameter for a fact count (design: 6 facts → 33px, 18 → 51px). */
export function ringDiameter(facts: number): number {
	return Math.min(64, Math.max(28, 24 + 1.5 * facts));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The cache key: the layout only changes when a topic's column or size,
 *  the topic list, or the arrows change. */
export function layoutKey(topics: readonly LayoutTopic[], links: readonly LayoutLink[]): string {
	return `${topics.map((t) => `${t.id}:${t.column}:${t.size}`).join("|")}#${links.map((l) => `${l.from}>${l.to}`).join("|")}`;
}

/** The arrows left after dropping every A→C that a longer path A→…→C
 *  already implies. */
function directLinks<L extends LayoutLink>(links: readonly L[]): L[] {
	const out = new Map<string, string[]>();
	for (const l of links) {
		const list = out.get(l.from);
		if (list) list.push(l.to);
		else out.set(l.from, [l.to]);
	}
	const reachesWithout = (from: string, to: string): boolean => {
		const seen = new Set<string>();
		const stack = (out.get(from) ?? []).filter((n) => n !== to);
		while (stack.length) {
			const n = stack.pop()!;
			if (n === to) return true;
			if (seen.has(n)) continue;
			seen.add(n);
			stack.push(...(out.get(n) ?? []));
		}
		return false;
	};
	return links.filter((l) => !reachesWithout(l.from, l.to));
}

const SWEEPS = 4;

export function layoutTopics(topics: readonly LayoutTopic[], links: readonly LayoutLink[]): TopicLayout {
	const order = new Map(topics.map((t, i) => [t.id, i]));
	const known = links.filter((l) => order.has(l.from) && order.has(l.to) && l.from !== l.to);
	const direct = directLinks(known);
	const linked = new Set(direct.flatMap((l) => [l.from, l.to]));
	const loose = direct.length > 0 ? topics.filter((t) => !linked.has(t.id)) : [];
	const looseIds = new Set(loose.map((t) => t.id));

	const columns = new Map<number, LayoutTopic[]>();
	for (const t of topics) {
		if (looseIds.has(t.id)) continue;
		const col = Math.max(0, Math.floor(t.column));
		const list = columns.get(col);
		if (list) list.push(t);
		else columns.set(col, [t]);
	}
	const depths = [...columns.keys()].sort((a, b) => a - b);

	// Crossing reduction: each topic's height is its index in its column,
	// centered; sort a column by its neighbors' average height on one side.
	const height = new Map<string, number>();
	const index = (col: LayoutTopic[]) => col.forEach((t, i) => height.set(t.id, i - (col.length - 1) / 2));
	for (const d of depths) index(columns.get(d)!);
	const sortBy = (col: LayoutTopic[], side: (id: string) => string[]) => {
		const key = new Map(col.map((t) => {
			const hs = side(t.id).map((id) => height.get(id)).filter((h): h is number => h !== undefined);
			return [t.id, hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : height.get(t.id)!] as const;
		}));
		col.sort((a, b) => key.get(a.id)! - key.get(b.id)! || order.get(a.id)! - order.get(b.id)!);
		index(col);
	};
	const into = (id: string) => direct.filter((l) => l.to === id).map((l) => l.from);
	const outOf = (id: string) => direct.filter((l) => l.from === id).map((l) => l.to);
	for (let sweep = 0; sweep < SWEEPS; sweep++) {
		for (const d of depths.slice(1)) sortBy(columns.get(d)!, into);
		for (const d of depths.slice(0, -1).reverse()) sortBy(columns.get(d)!, outOf);
	}

	const placed = new Map<string, PlacedTopic>();
	let subColumn = 0;
	for (const depth of depths) {
		const ranked = columns.get(depth)!;
		for (let start = 0; start < ranked.length; start += MAX_PER_COLUMN) {
			const chunk = ranked.slice(start, start + MAX_PER_COLUMN);
			chunk.forEach((t, i) => {
				placed.set(t.id, {
					id: t.id,
					x: subColumn * COLUMN_GAP,
					y: r2((i - (chunk.length - 1) / 2) * ROW_GAP),
					d: ringDiameter(t.size),
				});
			});
			subColumn++;
		}
	}

	// The loose row, under the deepest column.
	const lowest = Math.max(0, ...[...placed.values()].map((p) => p.y));
	const perRow = Math.max(4, subColumn);
	loose.forEach((t, i) => {
		placed.set(t.id, {
			id: t.id,
			x: (i % perRow) * COLUMN_GAP,
			y: r2(lowest + ROW_GAP * (1.5 + Math.floor(i / perRow))),
			d: ringDiameter(t.size),
		});
	});

	const placedLinks: PlacedLink[] = [];
	for (const l of direct) {
		const a = placed.get(l.from);
		const b = placed.get(l.to);
		if (!a || !b || b.x <= a.x) continue;
		const sx = r2(a.x + a.d / 2 + LINK_GAP_START);
		const tip = r2(b.x - b.d / 2 - LINK_GAP_END);
		const tx = r2(tip - ARROW_LENGTH);
		const mx = r2((sx + tx) / 2);
		placedLinks.push({
			from: l.from,
			to: l.to,
			path: `M${sx} ${a.y}C${mx} ${a.y} ${mx} ${b.y} ${tx} ${b.y}`,
			arrow: `${tx},${r2(b.y - ARROW_HALF)} ${tip},${b.y} ${tx},${r2(b.y + ARROW_HALF)}`,
			mid: [mx, r2((a.y + b.y) / 2)],
		});
	}

	const list = topics.map((t) => placed.get(t.id)!).filter(Boolean);
	let minX = 0;
	let maxX = 0;
	let minY = 0;
	let maxY = 0;
	list.forEach((p, i) => {
		const left = p.x - Math.max(LABEL_WIDTH / 2, p.d * 1.3);
		const right = p.x + Math.max(LABEL_WIDTH / 2, p.d * 1.3);
		const top = p.y - p.d * 1.3;
		const bottom = p.y + p.d / 2 + LABEL_HEIGHT;
		if (i === 0 || left < minX) minX = left;
		if (i === 0 || right > maxX) maxX = right;
		if (i === 0 || top < minY) minY = top;
		if (i === 0 || bottom > maxY) maxY = bottom;
	});
	return {
		topics: list,
		byId: placed,
		links: placedLinks,
		bounds: { x: r2(minX), y: r2(minY), w: r2(maxX - minX), h: r2(maxY - minY) },
	};
}

/** The camera that fits the map into a viewport: never zooms in past 1×
 *  and never out past FIT_MIN_SCALE (labels stay readable). A map still
 *  too big at that scale starts at its left/top edge — the foundations
 *  first — and the learner pans to the rest. */
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.5;
export const FIT_MIN_SCALE = 0.6;
export function fitTransform(
	bounds: TopicLayout["bounds"],
	viewport: { w: number; h: number },
	pad: { x: number; top: number; bottom: number } = { x: 32, top: 56, bottom: 56 },
): { k: number; x: number; y: number } {
	const w = Math.max(1, viewport.w - pad.x * 2);
	const h = Math.max(1, viewport.h - pad.top - pad.bottom);
	const k = Math.max(FIT_MIN_SCALE, Math.min(1, w / Math.max(1, bounds.w), h / Math.max(1, bounds.h)));
	const x = bounds.w * k > w ? pad.x - bounds.x * k : pad.x + w / 2 - (bounds.x + bounds.w / 2) * k;
	const y = bounds.h * k > h ? pad.top - bounds.y * k : pad.top + h / 2 - (bounds.y + bounds.h / 2) * k;
	return { k, x: r2(x), y: r2(y) };
}
