/**
 * THE TOPIC MAP LAYOUT (redesign plan, Phase 5) — pure, computed once per
 * data change and cached by `layoutKey` (never a live simulation).
 *
 * - x: the topic's `column` from progress (longest path from the
 *   foundations), left → right. A column with more than MAX_PER_COLUMN
 *   topics wraps into extra sub-columns, so a class with no arrows yet is
 *   a grid, not one tall line.
 * - y: centered per sub-column. The first column keeps the topics' given
 *   order; later columns sort by the average height of the topics that
 *   lead into them (fewer crossing arrows), ties in the given order.
 * - Rings grow with the topic's fact count.
 * - Arrows: a horizontal cubic curve from the right of A's ring to just
 *   before B's ring, plus a small arrowhead triangle.
 */

export const COLUMN_GAP = 160;
export const ROW_GAP = 116;
export const MAX_PER_COLUMN = 6;
/** Label block width under a ring (design: 160px). */
export const LABEL_WIDTH = 160;
/** Space under a ring for the name + score lines. */
const LABEL_HEIGHT = 48;
const ARROW_LENGTH = 6;
const ARROW_HALF = 3.5;
const LINK_GAP_START = 4;
const LINK_GAP_END = 3;

export interface LayoutTopic {
	id: string;
	column: number;
	/** Fact count (ring size). */
	size: number;
}

export interface LayoutLink {
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
}

export interface TopicLayout {
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

export function layoutTopics(topics: readonly LayoutTopic[], links: readonly LayoutLink[]): TopicLayout {
	const order = new Map(topics.map((t, i) => [t.id, i]));
	const incoming = new Map<string, string[]>();
	for (const l of links) {
		if (!order.has(l.from) || !order.has(l.to)) continue;
		const list = incoming.get(l.to);
		if (list) list.push(l.from);
		else incoming.set(l.to, [l.from]);
	}

	const depths = new Map<number, LayoutTopic[]>();
	for (const t of topics) {
		const col = Math.max(0, Math.floor(t.column));
		const list = depths.get(col);
		if (list) list.push(t);
		else depths.set(col, [t]);
	}

	const placed = new Map<string, PlacedTopic>();
	let subColumn = 0;
	for (const depth of [...depths.keys()].sort((a, b) => a - b)) {
		const members = depths.get(depth)!;
		const height = (t: LayoutTopic): number | null => {
			const ys = (incoming.get(t.id) ?? []).map((id) => placed.get(id)?.y).filter((y): y is number => y !== undefined);
			return ys.length === 0 ? null : ys.reduce((a, b) => a + b, 0) / ys.length;
		};
		const ranked = members
			.map((t) => ({ t, h: height(t) }))
			.sort((a, b) => {
				if (a.h !== null && b.h !== null && a.h !== b.h) return a.h - b.h;
				return order.get(a.t.id)! - order.get(b.t.id)!;
			})
			.map((e) => e.t);
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

	const placedLinks: PlacedLink[] = [];
	for (const l of links) {
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
