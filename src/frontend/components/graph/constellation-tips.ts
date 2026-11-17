/**
 * Where the Graph picture's hover boxes go: beside what is hovered, never over
 * it or over what it lights. Pure.
 */
import { nameBox, type Rect, type Seg, type Sky } from "./constellation-layout.ts";

/**
 * Where a hover box `w` by `h` goes beside `at`: inside the picture, off `at`
 * itself, off the clusters and names of the `keep` topics and off the `lines`
 * they light; covering another name or cluster costs a little; then nearest.
 */
export function tipSpot(sky: Sky, at: Rect, w: number, h: number, gap: number, keep: ReadonlySet<string>, lines: readonly Seg[]): { left: number; top: number } {
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
			if (left < 0 || top < 0 || left + w > sky.width) cost += 1000;
			// Below the picture is only page, so running past its foot costs little.
			if (top + h > sky.height) cost += 50;
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
