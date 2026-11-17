/**
 * Where the Graph picture's hover boxes go
 * (src/frontend/components/graph/constellation-tips.ts): never over what is
 * hovered nor over a topic or line it lights, and inside the picture.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutSky, nameBox, type Cluster, type Rect, type Seg } from "../../src/frontend/components/graph/constellation-layout.ts";
import { makeRouter } from "../../src/frontend/components/graph/constellation-routes.ts";
import { tipSpot } from "../../src/frontend/components/graph/constellation-tips.ts";
import { boxesMeet, course, discMeetsBox, measure } from "../constellation-fixture.ts";

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
				const score = tipSpot(s, nameBox(k), k.tipW, 16, 2, lit, lines);
				const box = { x0: score.left, x1: score.left + k.tipW, y0: score.top, y1: score.top + 16 };
				assert.ok(box.x0 >= 0 && box.x1 <= s.width, `${k.topic.name}'s score leaves the picture at ${w}`);
				for (const id of lit) assert.ok(!covers(box, s.byTopic.get(id)!), `${k.topic.name}'s score covers ${id} at ${w}`);
				for (const g of lines) assert.ok(!onLine(box, g), `${k.topic.name}'s score covers its line ${g.from} to ${g.to} at ${w}`);
				const star = k.stars[0]!;
				const at = { x0: star.x, x1: star.x + s.s, y0: star.y, y1: star.y + s.s };
				const chains = sp.chains.flatMap((c) => c.premises.flatMap((p) => (p === star.id || c.conclusion === star.id ? [[p, c.conclusion] as const] : [])));
				const starLines = chains.flatMap(([a, z]) => router.chain(a, z) ?? []);
				const starLit = new Set([k.topic.id, ...chains.flat().map((id) => s.starById.get(id)!.topicId)]);
				const tip = tipSpot(s, at, 220, 70, 8, starLit, starLines);
				const tipBox = { x0: tip.left, x1: tip.left + 220, y0: tip.top, y1: tip.top + 70 };
				assert.ok(!boxesMeet(tipBox, at), `the box covers its star in ${k.topic.name} at ${w}`);
				for (const id of starLit) assert.ok(!covers(tipBox, s.byTopic.get(id)!), `the box covers ${id} at ${w}`);
				for (const g of starLines) assert.ok(!onLine(tipBox, g), `the box covers the chain ${g.from} to ${g.to} at ${w}`);
			}
		}
	});
});
