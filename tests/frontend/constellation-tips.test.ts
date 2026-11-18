/**
 * Where the Graph picture's hover boxes go
 * (src/frontend/components/graph/constellation-tips.ts): never over what is
 * hovered nor over a topic or line it lights, and inside the picture; and where
 * a name tag goes (tagSpot) when a fact is pointed at near.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutSky, nameBox, type Cluster, type Rect, type Seg } from "../../src/frontend/components/graph/constellation-layout.ts";
import { makeRouter } from "../../src/frontend/components/graph/constellation-routes.ts";
import { tagSpot, tipSpot } from "../../src/frontend/components/graph/constellation-tips.ts";
import { boxesMeet, course, discMeetsBox, measure, rng } from "../constellation-fixture.ts";

const whole = (s: { width: number; height: number }): Rect => ({ x0: 0, y0: 0, x1: s.width, y1: s.height });
const covers = (b: Rect, k: Cluster) => boxesMeet(b, nameBox(k)) || discMeetsBox(k, b);
const onLine = (b: Rect, g: Seg) => {
	for (let i = 0; i < g.pts.length; i += 2) if (g.pts[i]! > b.x0 && g.pts[i]! < b.x1 && g.pts[i + 1]! > b.y0 && g.pts[i + 1]! < b.y1) return true;
	return false;
};

describe("the constellation's hover boxes", () => {
	it("sit off the hovered thing and off every topic and line it lights", () => {
		for (const w of [1440, 1100, 800, 836, 696, 644]) {
			const sp = course();
			const s = layoutSky(sp.topics, sp.links, sp.facts, w, measure);
			const router = makeRouter(s);
			for (const k of s.clusters) {
				const lit = new Set([k.topic.id, ...sp.links.flatMap((l) => (l.from === k.topic.id ? [l.to] : l.to === k.topic.id ? [l.from] : []))]);
				const lines = sp.links.filter((l) => l.from === k.topic.id || l.to === k.topic.id).flatMap((l) => router.link(l.from, l.to, k.topic.id, true) ?? []);
				const score = tipSpot(s, nameBox(k), k.tipW, 16, 2, lit, lines, whole(s));
				const box = { x0: score.left, x1: score.left + k.tipW, y0: score.top, y1: score.top + 16 };
				assert.ok(box.x0 >= 0 && box.x1 <= s.width, `${k.topic.name}'s score leaves the picture at ${w}`);
				for (const id of lit) assert.ok(!covers(box, s.byTopic.get(id)!), `${k.topic.name}'s score covers ${id} at ${w}`);
				for (const g of lines) assert.ok(!onLine(box, g), `${k.topic.name}'s score covers its line ${g.from} to ${g.to} at ${w}`);
				const star = k.stars[0]!;
				const at = { x0: star.x, x1: star.x + s.s, y0: star.y, y1: star.y + s.s };
				const chains = sp.chains.flatMap((c) => c.premises.flatMap((p) => (p === star.id || c.conclusion === star.id ? [[p, c.conclusion] as const] : [])));
				const starLines = chains.flatMap(([a, z]) => router.chain(a, z) ?? []);
				const starLit = new Set([k.topic.id, ...chains.flat().map((id) => s.starById.get(id)!.topicId)]);
				const tip = tipSpot(s, at, 220, 70, 8, starLit, starLines, whole(s));
				const tipBox = { x0: tip.left, x1: tip.left + 220, y0: tip.top, y1: tip.top + 70 };
				assert.ok(!boxesMeet(tipBox, at), `the box covers its star in ${k.topic.name} at ${w}`);
				for (const id of starLit) assert.ok(!covers(tipBox, s.byTopic.get(id)!), `the box covers ${id} at ${w}`);
				for (const g of starLines) assert.ok(!onLine(tipBox, g), `the box covers the chain ${g.from} to ${g.to} at ${w}`);
			}
		}
	});
});

describe("the name tag", () => {
	const room = { x0: 0, y0: 0, x1: 1192, y1: 600 };
	const [w, h, half, ext] = [180, 22, 13, 12];
	const base = { half, w, h, room, topicTop: 200, own: new Set<string>(), ext };
	const star = (id: string, x: number, y: number) => ({ id, x, y });
	const at = star("at", 600, 300);
	const under = (p: { left: number; top: number }, s: { x: number; y: number }) => s.x > p.left - ext && s.x < p.left + w + ext && s.y > p.top - ext && s.y < p.top + h + ext;
	const inside = (p: { left: number; top: number }) => p.left >= 0 && p.top >= 0 && p.left + w <= room.x1 && p.top + h <= room.y1;
	/** A star on each side of the pointed one, where its tag would go. */
	const rightOf = star("r", 600 + half + 6 + 20, 300);
	const leftOf = star("l", 600 - half - 6 - 20, 300);
	const over = star("u", 600, 300 - half - 6 - 10);
	const below = star("d", 600, 300 + half + 6 + 10);

	it("goes right of the fact when nothing is there", () => {
		const spot = tagSpot({ ...base, at, stars: [at] });
		assert.equal(spot.left, 600 + half + 6);
		assert.equal(spot.leader, null);
	});

	it("takes the next side when a star is in the way", () => {
		const spot = tagSpot({ ...base, at, stars: [at, rightOf] });
		assert.ok(!under(spot, rightOf) && spot.leader === null);
		assert.equal(spot.left, 600 - half - 6 - w, "left of the fact");
	});

	it("covers no star when any side is clear", () => {
		const spot = tagSpot({ ...base, at, stars: [at, rightOf, leftOf, over] });
		assert.ok(!under(spot, rightOf) && !under(spot, leftOf) && !under(spot, over));
		assert.equal(spot.top, 300 + half + 6, "below the fact");
	});

	it("when every side is crowded, goes above the topic with a leader down to the fact", () => {
		const spot = tagSpot({ ...base, at, stars: [at, rightOf, leftOf, over, below], topicTop: 250 });
		assert.ok(spot.top + h <= 250, "above the topic");
		assert.ok(spot.leader !== null && spot.leader.x === 600);
		assert.ok(spot.leader.y0 >= spot.top + h && spot.leader.y1 <= 300 - half, "the leader runs from the tag down to the fact");
		assert.ok(inside(spot));
	});

	it("with every side crowded and no room above the topic, never covers a star on the fact's own lines", () => {
		const own = new Set(["at", "r", "l", "u"]);
		const spot = tagSpot({ ...base, at, stars: [at, rightOf, leftOf, over, below], topicTop: 10, own });
		assert.ok(!under(spot, rightOf) && !under(spot, leftOf) && !under(spot, over), "only the star on no line is covered");
		assert.ok(under(spot, below));
		assert.equal(spot.leader, null);
	});

	it("is the same every time", () => {
		const args = { ...base, at, stars: [at, rightOf, leftOf, over, below], topicTop: 250 };
		assert.equal(JSON.stringify(tagSpot(args)), JSON.stringify(tagSpot(args)));
	});

	it("stays inside the picture and off every star wherever the fact is and however many stars there are", () => {
		const r = rng(7);
		for (let run = 0; run < 400; run++) {
			const stars = Array.from({ length: 4 + Math.floor(r() * 10) }, (_, i) => star(`s${i}`, r() * room.x1, r() * room.y1));
			const pointed = stars[0]!;
			// A fact too near the edge to have a side clear is left to the edge test.
			if (pointed.x < w + 40 || pointed.x > room.x1 - w - 40 || pointed.y < 60 || pointed.y > room.y1 - 60) continue;
			const spot = tagSpot({ ...base, at: pointed, stars, topicTop: pointed.y - 40 });
			assert.ok(inside(spot), `run ${run}: the tag leaves the picture`);
			const hit = stars.filter((o) => o !== pointed && under(spot, o));
			if (spot.leader === null && hit.length > 0) {
				// Only when every side was crowded does a tag cover a star.
				const sides = [
					{ left: pointed.x + half + 6, top: pointed.y - h / 2 },
					{ left: pointed.x - half - 6 - w, top: pointed.y - h / 2 },
					{ left: pointed.x - w / 2, top: pointed.y - half - 6 - h },
					{ left: pointed.x - w / 2, top: pointed.y + half + 6 },
				].filter(inside);
				assert.ok(sides.every((p) => stars.some((o) => o !== pointed && under(p, o))), `run ${run}: covers a star with a clear side`);
			}
		}
	});

	it("stays inside the picture for a fact at its edge", () => {
		const off: string[] = [];
		for (const [x, y] of [[6, 6], [room.x1 - 6, 6], [6, room.y1 - 6], [room.x1 - 6, room.y1 - 6], [300, 5], [5, 300], [room.x1 - 5, 300], [300, room.y1 - 5]] as const) {
			const pointed = star("p", x, y);
			const spot = tagSpot({ ...base, at: pointed, stars: [pointed], topicTop: y });
			if (!inside(spot)) off.push(`fact at ${x}, ${y}: tag at ${spot.left}, ${spot.top}`);
		}
		assert.deepEqual(off, []);
	});

	/** A star in each of the four places a tag could go for a fact at (x, y), so every side is blocked. */
	const surrounded = (x: number, y: number) => [
		star("p", x, y),
		star("e", x + half + 6 + 20, y),
		star("w", x - half - 6 - 20, y),
		star("n", x, y - half - 6 - 10),
		star("s", x, y + half + 6 + 10),
	];

	it("with every side blocked and no room above, still gives a tag inside the picture and no leader", () => {
		const stars = surrounded(600, 300);
		const spot = tagSpot({ ...base, at: stars[0]!, stars, topicTop: 5 });
		assert.ok(inside(spot));
		assert.equal(spot.leader, null);
	});

	it("with every side blocked, a fact at each corner of the picture gets a tag inside the picture", () => {
		for (const [x, y] of [[6, 6], [room.x1 - 6, 6], [6, room.y1 - 6], [room.x1 - 6, room.y1 - 6]] as const) {
			const stars = surrounded(x, y);
			// Its topic reaches the picture's top, so there is no room above it either.
			const spot = tagSpot({ ...base, at: stars[0]!, stars, topicTop: 0 });
			assert.ok(inside(spot), `fact at ${x}, ${y}: tag at ${spot.left}, ${spot.top}`);
			assert.equal(spot.leader, null);
		}
	});

	it("in a picture only a little wider than the tag, a fact at either side still gets a tag inside it", () => {
		const small = { x0: 0, y0: 0, x1: w + 40, y1: 90 };
		for (const [x, y] of [[5, 5], [small.x1 - 5, 5], [5, small.y1 - 5], [small.x1 - 5, small.y1 - 5], [small.x1 / 2, small.y1 / 2]] as const) {
			const stars = surrounded(x, y);
			const spot = tagSpot({ ...base, room: small, at: stars[0]!, stars, topicTop: 0 });
			assert.ok(spot.left >= 0 && spot.left + w <= small.x1 && spot.top >= 0 && spot.top + h <= small.y1, `fact at ${x}, ${y}: tag at ${spot.left}, ${spot.top}`);
		}
	});

	it("a fact drawn past the room's side gets its tag at that side's edge, level with it, and no leader", () => {
		for (const x of [-40, room.x1 + 40]) {
			const stars = surrounded(x, 300);
			const spot = tagSpot({ ...base, at: stars[0]!, stars, topicTop: 200 });
			assert.ok(inside(spot), `fact at ${x}: tag at ${spot.left}`);
			assert.equal(spot.left, x < 0 ? room.x0 : room.x1 - w);
			assert.equal(spot.top, 300 - h / 2);
			assert.equal(spot.leader, null);
		}
	});

	it("keeps out of a room's dissolving top and bottom, for a fact right at either", () => {
		const band = { ...room, y0: 24, y1: room.y1 - 24 };
		for (const [x, y] of [[300, 10], [300, room.y1 - 10], [600, 30], [600, room.y1 - 30]] as const) {
			const stars = surrounded(x, y);
			const spot = tagSpot({ ...base, room: band, at: stars[0]!, stars, topicTop: y });
			assert.ok(spot.top >= band.y0 && spot.top + h <= band.y1, `fact at ${x}, ${y}: tag at ${spot.top}`);
		}
	});
});
