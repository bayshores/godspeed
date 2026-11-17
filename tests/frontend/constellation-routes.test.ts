/**
 * How the Graph picture's lines run (src/frontend/components/graph/constellation-routes.ts
 * and restLines): no drawn line crosses a name or another cluster, at rest, lit or between stars,
 * at window and docked-panel widths; rest lines keep room around names and stay short; every lit line is drawn;
 * a space with no links draws none.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { layoutSky, nameBox, restLines, type Cluster, type Seg, type Sky } from "../../src/frontend/components/graph/constellation-layout.ts";
import { makeRouter } from "../../src/frontend/components/graph/constellation-routes.ts";
import { boxesMeet, course, discMeetsBox, flat, looseOnly, measure, one, sixty, type Space } from "../constellation-fixture.ts";

// The picture alone at 1440, 1100 and 800 wide, then beside the docked topic panel in windows of 1440 and 1100 and the narrowest window that still docks it.
const WIDTHS = [1440, 1100, 800, 836, 696, 644];

function setUp(sp: Space, width: number) {
	const sky = layoutSky(sp.topics, sp.links, sp.facts, width, measure);
	const router = makeRouter(sky);
	return { sky, router, rest: restLines(sky, sp.links, (a, z) => router.link(a, z, null, false)) };
}

/** Where a line ran into something it must not cross, or came closer than `room` points to a name's ink; null when clear. `own` are the topics whose clusters the line may leave from or arrive at. */
function crossing(sky: Sky, g: Seg, own: ReadonlySet<string>, room: number): string | null {
	for (let i = 0; i < g.pts.length; i += 2) {
		const x = g.pts[i]!;
		const y = g.pts[i + 1]!;
		if (x < 0 || y < 0 || x > sky.width || y > sky.height) return `leaves the picture at ${x.toFixed(0)}, ${y.toFixed(0)}`;
		for (const k of sky.clusters) {
			if (!own.has(k.topic.id) && Math.hypot(x - k.cx, y - k.cy) < k.r) return `crosses the cluster ${k.topic.name}`;
			const b = nameBox(k);
			const nearName = x > b.x0 - room && x < b.x1 + room && y > b.y0 + 2 && y < b.y1 - 1 + room;
			if (nearName) return `runs on or close along the name ${k.topic.name}`;
		}
	}
	return null;
}

const ends = (sky: Sky, g: Seg) => new Set([g.from, g.to].map((id) => sky.starById.get(id)?.topicId ?? id));

describe("the constellation's lines", () => {
	it("never cross a name or another cluster, at rest, lit, or between stars, and keep room around names", () => {
		for (const make of [course, sixty])
			for (const w of WIDTHS) {
				const sp = make();
				const { sky, router, rest } = setUp(sp, w);
				const lines: [string, Seg][] = rest.map((g) => ["rest", g]);
				for (const l of sp.links)
					for (const lead of [l.from, l.to, null]) {
						const g = router.link(l.from, l.to, lead, true);
						if (g) lines.push([`lit, lead ${lead}`, g]);
					}
				for (const c of sp.chains)
					for (const p of c.premises) {
						const g = router.chain(p, c.conclusion);
						if (g) lines.push(["chain", g]);
					}
				// Star chains may cross their own clusters (they start inside them); lines between topics may only touch their ends.
				// Rest lines keep 4 points of room around every name. A lit line may pass closer only where no roomier way exists, and rarely.
				let close = 0;
				for (const [kind, g] of lines) {
					const own = ends(sky, g);
					const why = crossing(sky, g, own, kind === "rest" ? 4 : 1);
					assert.equal(why, null, `${kind} line ${g.from} to ${g.to} at ${w}: ${why}`);
					if (crossing(sky, g, own, 4)) close++;
				}
				assert.ok(close <= lines.length * 0.03, `${close} of ${lines.length} lit lines pass close to a name at ${w}`);
			}
	});

	it("draws at most one short line per topic at rest, and most linked topics get one", () => {
		for (const w of WIDTHS) {
			const sp = course();
			const { sky, rest } = setUp(sp, w);
			for (const g of rest) {
				const a = sky.byTopic.get(g.from)!;
				const z = sky.byTopic.get(g.to)!;
				assert.ok(Math.hypot(z.cx - a.cx, z.cy - a.cy) - a.r - z.r <= w / 3, `${a.topic.name} to ${z.topic.name} is long`);
			}
			const linked = new Set(sp.links.flatMap((l) => [l.from, l.to]));
			const shown = new Set(rest.flatMap((g) => [g.from, g.to]));
			assert.ok(shown.size >= linked.size * 0.75, `${shown.size} of ${linked.size} linked topics show a line at ${w}`);
		}
	});

	it("draws every lit line, whichever end is pointed at", () => {
		for (const make of [course, sixty])
			for (const w of WIDTHS) {
				const sp = make();
				const { router } = setUp(sp, w);
				const missing = sp.links.flatMap((l) => [l.from, l.to].filter((lead) => !router.link(l.from, l.to, lead, true)).map((lead) => `${l.from} to ${l.to} (lead ${lead})`));
				assert.deepEqual(missing, [], `at ${w}`);
			}
	});

	it("draws no line for one topic or a space with no links", () => {
		// A lone topic linked to itself draws nothing either.
		const lone = one();
		const t = lone.topics[0]!;
		assert.ok(setUp({ ...lone, links: [{ from: t.id, to: t.id, weight: 1 }] }, 1440).rest.length === 0, "one topic");
		const sp = flat();
		assert.ok(setUp(sp, 1440).rest.length === 0, "no links");
		// The same grid with one link between neighbours draws exactly that line, so the check above can fail.
		const [a, b] = sp.topics.filter((x) => !x.ungrouped).sort((x, y) => x.name.localeCompare(y.name));
		const rest = setUp({ ...sp, links: [{ from: a!.id, to: b!.id, weight: 1 }] }, 1440).rest;
		assert.ok(rest.length === 1 && rest[0]!.from === a!.id && rest[0]!.to === b!.id, `${rest.length} lines with one link`);
	});

	it("works out every lit line of 60 topics in a narrow picture in moments", () => {
		for (const w of [700, 650]) {
			const sp = sixty();
			const { router } = setUp(sp, w);
			const t0 = performance.now();
			for (const l of sp.links) for (const lead of [l.from, l.to]) router.link(l.from, l.to, lead, true);
			// A loose limit: the step cap is what ends each search; this catches only work gone far too long, even on a busy laptop.
			assert.ok(performance.now() - t0 < 15_000, `at ${w}`);
		}
	});

	it("ends every single search quickly, even in a very wide or very narrow picture", () => {
		for (const w of [3000, 500, 320]) {
			const sp = sixty();
			const { router } = setUp(sp, w);
			let worst = 0;
			const time = (work: () => void) => {
				const t0 = performance.now();
				work();
				worst = Math.max(worst, performance.now() - t0);
			};
			for (const l of sp.links) for (const lead of [l.from, l.to]) time(() => router.link(l.from, l.to, lead, true));
			for (const f of sp.facts.slice(0, 20)) time(() => router.chain(sp.facts.at(-1)!.id, f.id));
			assert.ok(worst < 1500, `one route took ${worst.toFixed(0)} ms at ${w}`);
		}
	});

	it("still draws a lit line when no way through exists", () => {
		// A wall: one cluster as tall as the picture stands between the two ends.
		const [ta, tw, tz] = course().topics;
		const at = (topic: typeof ta, cx: number, r: number): Cluster => ({ topic: topic!, cx, cy: 100, r, stars: [], nameTop: 300, textW: 30, text: ["x"], tipW: 40, muted: false });
		const clusters = [at(ta, 40, 10), at(tw, 150, 130), at(tz, 260, 10)];
		const walled: Sky = { width: 300, height: 200, s: 6, clusters, byTopic: new Map(clusters.map((k) => [k.topic.id, k])), stars: [], starById: new Map() };
		const router = makeRouter(walled);
		assert.ok(router.link(ta!.id, tz!.id, ta!.id, true), "lit");
		assert.ok(router.link(ta!.id, tz!.id, null, false) === null, "at rest");
		// A picture with no size still ends its search.
		assert.ok(makeRouter({ ...walled, width: NaN, height: NaN }).link(ta!.id, tz!.id, ta!.id, true), "no size");
	});

	it("draws one rest line for two topics linked both ways", () => {
		for (const w of WIDTHS) {
			const sp = course();
			const both = { ...sp, links: [...sp.links, ...sp.links.map((l) => ({ ...l, from: l.to, to: l.from }))] };
			const pairs = setUp(both, w).rest.map((g) => [g.from, g.to].sort().join(">"));
			assert.equal(new Set(pairs).size, pairs.length, `at ${w}`);
		}
	});

	it("copes with odd data: lays it out without overlap, inside the picture, and draws its lit lines", () => {
		const withLinks = (extra: (sp: Space) => Space["links"]) => () => {
			const sp = course();
			return { ...sp, links: [...sp.links, ...extra(sp)] };
		};
		const CASES: [string, () => Space][] = [
			["links to a topic that is not there", withLinks((sp) => [{ from: "tpc_gone", to: sp.topics[4]!.id, weight: 2 }, { from: sp.topics[4]!.id, to: "tpc_gone", weight: 2 }])],
			["a topic linked to itself", withLinks((sp) => [{ from: sp.topics[4]!.id, to: sp.topics[4]!.id, weight: 2 }])],
			["every link twice", withLinks((sp) => sp.links)],
			[
				"a topic with no facts",
				() => {
					const sp = course();
					const empty = { ...sp.topics[4]!, id: "tpc_empty", name: "Nothing here yet", members: [], answers: [] };
					return { ...sp, topics: [...sp.topics, empty], links: [...sp.links, { from: sp.topics[0]!.id, to: empty.id, weight: 1 }] };
				},
			],
			["only Ungrouped", looseOnly],
			[
				"a level with no topics",
				() => {
					const sp = course();
					const gone = new Set(sp.topics.filter((t) => t.column === 2).map((t) => t.id));
					return { topics: sp.topics.filter((t) => !gone.has(t.id)), facts: sp.facts.filter((f) => !gone.has(f.topicId)), links: sp.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)), chains: [] };
				},
			],
		];
		for (const [name, make] of CASES)
			for (const w of [1100, 644, 320]) {
				const sp = make();
				const { sky, router } = setUp(sp, w);
				const at = `${name} at ${w}`;
				assert.equal(sky.clusters.length, sp.topics.length, at);
				for (const a of sky.clusters) {
					const b = nameBox(a);
					assert.ok(a.cx - a.r >= 0 && a.cx + a.r <= w && b.x0 >= 0 && b.x1 <= w && b.y1 <= sky.height, `${at}: ${a.topic.name} leaves the picture`);
					for (const z of sky.clusters) {
						if (a === z) continue;
						const against = `${at}: ${a.topic.name} against ${z.topic.name}`;
						assert.ok(Math.hypot(a.cx - z.cx, a.cy - z.cy) >= a.r + z.r, `${against}: clusters overlap`);
						assert.ok(!boxesMeet(b, nameBox(z)) && !discMeetsBox(a, nameBox(z)), `${against}: a name is covered`);
					}
				}
				const drawn = (id: string) => sky.byTopic.get(id)?.muted === false;
				for (const l of sp.links) {
					if (l.from === l.to || !drawn(l.from) || !drawn(l.to)) continue;
					const g = router.link(l.from, l.to, l.from, true);
					assert.ok(g !== null, `${at}: no lit line ${l.from} to ${l.to}`);
					const why = crossing(sky, g, ends(sky, g), 1);
					assert.ok(why === null, `${at}: ${l.from} to ${l.to} ${why}`);
				}
			}
	});

	it("remembers a route once worked out", () => {
		const sp = sixty();
		const { sky, router } = setUp(sp, 1100);
		const l = sp.links[0]!;
		const g = router.link(l.from, l.to, l.to, true);
		assert.ok(g !== null, "drawn");
		assert.ok(g === router.link(l.from, l.to, l.to, true), "worked out again");
		const why = crossing(sky, g, ends(sky, g), 1);
		assert.ok(why === null, why ?? "");
	});
});
