/**
 * Where the Graph picture's hover boxes and name tags go: beside what is
 * hovered, never over it or over what it lights. Pure.
 */
import { nameBox, type Rect, type Seg, type Sky } from "./constellation-layout.ts";

/**
 * Where a hover box `w` by `h` goes beside `at`: inside `bounds` (the view), off `at`
 * itself, off the clusters and names of the `keep` topics and off the `lines`
 * they light; covering another name or cluster costs a little; then nearest.
 */
export function tipSpot(
	sky: Sky,
	at: Rect,
	w: number,
	h: number,
	gap: number,
	keep: ReadonlySet<string>,
	lines: readonly Seg[],
	bounds: Rect,
): { left: number; top: number } {
	const mx = (at.x0 + at.x1) / 2;
	const my = (at.y0 + at.y1) / 2;
	// Each side at three distances, so a box can clear a whole cluster around a star.
	const far = [0, 24, 48];
	const lefts = [mx - w / 2, at.x0, at.x1 - w, ...far.flatMap((d) => [at.x1 + gap + d, at.x0 - gap - w - d])];
	const tops = [my - h / 2, ...far.flatMap((d) => [at.y1 + gap + d, at.y0 - gap - h - d])];
	const covers = (left: number, top: number, b: Rect, m = 3) => left < b.x1 + m && left + w > b.x0 - m && top < b.y1 + m && top + h > b.y0 - m;
	let best = { left: lefts[0]!, top: tops[0]! };
	let least = Infinity;
	for (const top of tops)
		for (const left of lefts) {
			let cost = Math.hypot(left + w / 2 - mx, top + h / 2 - my) / 100;
			// The page does not scroll: a box stays inside the picture, or the part of it in view.
			if (left < bounds.x0 || top < bounds.y0 || left + w > bounds.x1 || top + h > bounds.y1) cost += 1000;
			if (covers(left, top, at, 0)) cost += 500;
			for (const k of sky.clusters) {
				const near = Math.hypot(k.cx - Math.max(left, Math.min(k.cx, left + w)), k.cy - Math.max(top, Math.min(k.cy, top + h)));
				const hit = near < k.r + 3 || covers(left, top, nameBox(k), Math.min(3, gap));
				if (hit) cost += keep.has(k.topic.id) ? 300 : 20;
			}
			for (const g of lines)
				for (let i = 0; i < g.pts.length; i += 2)
					if (covers(left, top, { x0: g.pts[i]!, x1: g.pts[i]!, y0: g.pts[i + 1]!, y1: g.pts[i + 1]! })) {
						cost += 100;
						break;
					}
			if (cost < least) [least, best] = [cost, { left, top }];
		}
	return best;
}

/** A star on screen, for placing a name tag. */
interface TagStar {
	id: string;
	x: number;
	y: number;
}

/**
 * Where a pointed star's one-line name tag goes, in screen points: the first
 * side of right, left, above, below that stays inside `room` and covers no
 * star (each `ext` across); when every side is crowded, above the star's
 * topic with a dotted leader down to it; failing that, the side that covers
 * none of the `own` stars (the ends of its lines) and the fewest others.
 */
export function tagSpot({
	at,
	half,
	w,
	h,
	room,
	stars,
	topicTop,
	own,
	ext,
}: {
	at: TagStar;
	/** Half the pointed star's drawn size, with its frame. */
	half: number;
	w: number;
	h: number;
	/** Where the tag may go. */
	room: Rect;
	stars: readonly TagStar[];
	/** The top of the star's topic on screen. */
	topicTop: number;
	own: ReadonlySet<string>;
	ext: number;
}): { left: number; top: number; leader: { x: number; y0: number; y1: number } | null } {
	const { x, y } = at;
	const inside = (p: { left: number; top: number }) => p.left >= room.x0 && p.left + w <= room.x1 && p.top >= room.y0 && p.top + h <= room.y1;
	const under = (p: { left: number; top: number }) => stars.filter((o) => o.id !== at.id && o.x > p.left - ext && o.x < p.left + w + ext && o.y > p.top - ext && o.y < p.top + h + ext);
	const all = [
		{ left: x + half + 6, top: y - h / 2 },
		{ left: x - half - 6 - w, top: y - h / 2 },
		{ left: x - w / 2, top: y - half - 6 - h },
		{ left: x - w / 2, top: y + half + 6 },
	];
	const sides = all.filter(inside);
	const round = (p: { left: number; top: number }) => ({ left: Math.round(p.left), top: Math.round(p.top) });
	const clear = sides.find((p) => under(p).length === 0);
	if (clear) return { ...round(clear), leader: null };
	const above = { left: Math.max(room.x0, Math.min(room.x1 - w, x - w / 2)), top: topicTop - ext - 8 - h };
	// The leader has to meet the tag, so a star past the room's side gets none.
	if (inside(above) && x >= above.left && x <= above.left + w) return { ...round(above), leader: { x: Math.round(x), y0: Math.round(above.top + h + 3), y1: Math.round(y - half - 4) } };
	const best = sides.filter((p) => !under(p).some((o) => own.has(o.id))).sort((a, b) => under(a).length - under(b).length)[0] ?? sides[0] ?? (x < room.x0 ? all[0]! : x > room.x1 ? all[1]! : above);
	// No side fits (a long name in a small view, or a star past the room's side): kept inside the room all the same, a star outside it at the near edge beside it.
	return { ...round({ left: Math.max(room.x0, Math.min(room.x1 - w, best.left)), top: Math.max(room.y0, Math.min(room.y1 - h, best.top)) }), leader: null };
}
