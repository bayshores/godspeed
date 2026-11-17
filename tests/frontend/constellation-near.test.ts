/**
 * What the near Graph picture adds under each star
 * (src/frontend/components/graph/constellation-near.ts): the answer row
 * and the placement of fact names, checked through the real layout at the
 * zoom a flight to a topic lands on and at the least near zoom.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnswerOutcome } from "../../src/shared/core/index.ts";
import { layoutSky, NAME_GAP, NAME_LINE, type Cluster, type Rect } from "../../src/frontend/components/graph/constellation-layout.ts";
import { fitPicture } from "../../src/frontend/components/graph/constellation-fit.ts";
import { HIST_SQ, LABEL_LINE, NAME_DROP, factNameText, historyRow, placeFactNames, placeLabels, type LabelAsk } from "../../src/frontend/components/graph/constellation-near.ts";
import { STAR_CAP, camOnTopic, project, starPitch, topZoom, viewRect, type Cam, type Frame } from "../../src/frontend/components/graph/constellation-camera.ts";
import { boxesMeet, course, flat, looseOnly, measure, one, sixty, type Space } from "../constellation-fixture.ts";
import { introC } from "../constellation-course-fixture.ts";

describe("a star's answer row", () => {
	const answers = (...outcomes: AnswerOutcome[]) => outcomes.map((outcome) => ({ outcome }));

	it("shows no squares for a fact never asked", () => {
		assert.deepEqual(historyRow([], 100, 50), []);
	});

	it("puts one square per answer, oldest first, centred under the star", () => {
		const row = historyRow(answers("wrong", "hinted", "right"), 100, 50);
		assert.deepEqual(row.map((q) => q.outcome), ["wrong", "hinted", "right"]);
		assert.ok(row.every((q) => q.y === 50));
		const left = row[0]!.x;
		const right = row[2]!.x + HIST_SQ;
		assert.ok(Math.abs((left + right) / 2 - 100) <= 1, "centred on the star");
		assert.ok(row[0]!.x < row[1]!.x && row[1]!.x < row[2]!.x);
	});

	it("shows only the latest eight answers", () => {
		const many = answers("wrong", "wrong", "wrong", "wrong", "right", "right", "right", "right", "dontKnow", "hinted");
		const row = historyRow(many, 100, 50);
		assert.equal(row.length, 8);
		assert.deepEqual(row.map((q) => q.outcome), many.slice(-8).map((a) => a.outcome));
	});
});

const labelMeasure = (t: string) => (t.length * 7 * 12) / 13;
const SPACES: [string, () => Space][] = [
	["the intro course", introC],
	["the made-up course", course],
	["60 topics", sixty],
	["one topic", one],
	["no links", flat],
	["Ungrouped alone", looseOnly],
];

function setup(space: Space) {
	const { sky, scale } = fitPicture((w) => layoutSky(space.topics, space.links, space.facts, w, measure), { width: 1192, height: 600 });
	const f: Frame = { w: sky.width * scale, h: Math.max(sky.height * scale, 600), scale, skyW: sky.width, skyH: sky.height };
	const nn = starPitch(sky);
	return { space, sky, f, nn, zMax: topZoom(nn, f) };
}

/** The fact names the picture places with the camera at `cam`, and everything they must not touch. */
function nearPicture({ space, sky, f }: ReturnType<typeof setup>, cam: Cam) {
	const P = project(cam, f);
	const sx = (x: number) => x * P.k + P.tx;
	const sy = (y: number) => y * P.k + P.ty;
	const d = Math.min(sky.s * P.k, STAR_CAP);
	const around = viewRect(cam, f, 60);
	const inAround = (x: number, y: number) => x >= around.x0 && x <= around.x1 && y >= around.y0 && y <= around.y1;
	const byId = new Map(space.facts.map((fact) => [fact.id, fact]));
	const blocks: Rect[] = [];
	for (const o of sky.clusters) {
		if (o.cx + o.r < around.x0 || o.cx - o.r > around.x1 || o.cy + o.r < around.y0 || o.cy - o.r > around.y1) continue;
		const lowest = Math.max(o.cy, ...o.stars.map((s) => s.cy));
		const left = sx(o.cx) - o.textW / 2;
		const top = sy(lowest) + d / 2 + NAME_GAP + NAME_DROP;
		const h = o.text.length * NAME_LINE;
		if (left >= 0 && top >= 0 && left + o.textW <= f.w && top + h <= f.h) blocks.push({ x0: left - 4, x1: left + o.textW + 4, y0: top - 2, y1: top + h });
	}
	const placed = placeFactNames({
		clusters: sky.clusters,
		factById: byId,
		text: factNameText(labelMeasure),
		at: (x, y) => [sx(x), sy(y)],
		shown: inAround,
		d,
		blocks,
		view: { x0: 0, x1: f.w, y0: 0, y1: f.h },
		first: null,
	});
	const stars: Rect[] = [];
	for (const o of sky.clusters)
		for (const st of o.stars) {
			stars.push({ x0: sx(st.cx) - d / 2, x1: sx(st.cx) + d / 2, y0: sy(st.cy) - d / 2, y1: sy(st.cy) + d / 2 });
			for (const q of historyRow(byId.get(st.id)!.answers, sx(st.cx), sy(st.cy) + d / 2 + 3)) stars.push({ x0: q.x, x1: q.x + HIST_SQ, y0: q.y, y1: q.y + HIST_SQ });
		}
	const names = placed.map((p) => ({ id: p.id, box: { x0: p.left, x1: p.left + p.w, y0: p.top, y1: p.top + p.lines.length * LABEL_LINE } }));
	const inView = sky.stars.filter((st) => inAround(st.cx, st.cy) && sx(st.cx) >= 0 && sx(st.cx) <= f.w && sy(st.cy) >= 0 && sy(st.cy) <= f.h).length;
	return { names, stars, blocks, inView };
}

/** How many of a picture's fact names touch a star, an answer square, a topic's name or another fact name. */
function touches(p: ReturnType<typeof nearPicture>): number {
	return p.names.filter((a) => p.stars.some((s) => boxesMeet(a.box, s)) || p.blocks.some((b) => boxesMeet(a.box, b)) || p.names.some((b) => b !== a && boxesMeet(a.box, b.box))).length;
}

/** The camera a click on the topic flies to. */
const flown = (sc: ReturnType<typeof setup>, k: Cluster) => camOnTopic(k, sc.f, sc.nn, sc.zMax);
/** Exactly the least near pitch, centred on the topic. */
const leastNear = (sc: ReturnType<typeof setup>, k: Cluster): Cam => ({ z: 80 / (sc.nn * sc.f.scale), x: k.cx, y: k.cy + 40 / sc.f.scale });

describe("fact names under their stars", () => {
	for (const [name, make] of SPACES) {
		it(`${name}: no name touches a star, an answer square, a topic's name or another name, at the zoom a flight to any topic lands on`, () => {
			const sc = setup(make());
			let drawn = 0;
			for (const k of sc.sky.clusters) {
				const p = nearPicture(sc, flown(sc, k));
				assert.equal(touches(p), 0, k.topic.name);
				drawn += p.names.length;
			}
			assert.ok(drawn > 0, "some names are drawn");
		});

		it(`${name}: and none touches anything at the least near zoom either`, () => {
			const sc = setup(make());
			for (const k of sc.sky.clusters) assert.equal(touches(nearPicture(sc, leastNear(sc, k))), 0, k.topic.name);
		});
	}

	it("at least 90% of the facts in view, and 80% in each view, get a name after a flight to a topic of the intro course", () => {
		const sc = setup(introC());
		let drawn = 0;
		let wanted = 0;
		for (const k of sc.sky.clusters) {
			const p = nearPicture(sc, flown(sc, k));
			assert.ok(p.names.length >= 0.8 * p.inView, `${k.topic.name}: ${p.names.length} of ${p.inView}`);
			drawn += p.names.length;
			wanted += p.inView;
		}
		assert.ok(drawn >= 0.9 * wanted, `${drawn} of ${wanted} names drawn`);
	});

	it("a small topic flown to gets a name on every one of its facts", () => {
		const sc = setup(course());
		const small = [...sc.sky.clusters].sort((a, b) => a.r - b.r)[0]!;
		const own = new Set(small.stars.map((s) => s.id));
		assert.equal(nearPicture(sc, flown(sc, small)).names.filter((n) => own.has(n.id)).length, own.size);
	});

	it("a name that would leave the view is not drawn", () => {
		const view: Rect = { x0: 0, x1: 100, y0: 0, y1: 60 };
		const ask: LabelAsk = { id: "a", cx: 95, cy: 20, d: 12, row: false, lines: ["A long name"], w: 80 };
		assert.equal(placeLabels([ask], [], view).length, 0);
		assert.equal(placeLabels([{ ...ask, cx: 50 }], [], view).length, 1);
	});

	it("a name that would touch a star, a topic's name or a name already placed waits", () => {
		const view: Rect = { x0: 0, x1: 400, y0: 0, y1: 300 };
		const a: LabelAsk = { id: "a", cx: 100, cy: 20, d: 12, row: false, lines: ["Alpha"], w: 40 };
		const below: LabelAsk = { ...a, id: "b", cy: 50 };
		assert.deepEqual(placeLabels([a, below], [], view).map((p) => p.id), ["b"], "a's name would sit on the star under it");
		const block: Rect = { x0: 80, x1: 120, y0: 30, y1: 50 };
		assert.equal(placeLabels([a], [block], view).length, 0);
		const twin: LabelAsk = { ...a, id: "c", cy: 21 };
		assert.deepEqual(placeLabels([a, twin], [], view).map((p) => p.id), ["a"], "the twin's name would land on a's");
		assert.deepEqual(placeLabels([twin, a], [], view).map((p) => p.id), ["c"], "the first ask wins");
	});
});
