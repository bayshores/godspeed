/**
 * What the foot line counts of a zoomed-in Graph picture
 * (src/frontend/components/graph/use-in-view.ts): which topics are in view,
 * their facts and lit facts, and the topic's name when it is the only one.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnswerOutcome } from "../../src/shared/core/index.ts";
import { countInView } from "../../src/frontend/components/graph/use-in-view.ts";
import { figuresOf, movedSky } from "../../src/frontend/components/graph/constellation-figure.ts";
import { camOnTopic, starPitch, topZoom, viewRect, type Frame } from "../../src/frontend/components/graph/constellation-camera.ts";
import { fitPicture } from "../../src/frontend/components/graph/constellation-fit.ts";
import { layoutSky, type Rect } from "../../src/frontend/components/graph/constellation-layout.ts";
import { course, measure } from "../constellation-fixture.ts";
import { introC } from "../constellation-course-fixture.ts";

/** A topic of stars at the given places, `ids` in order. */
const cluster = (name: string, ids: string[], at: (i: number) => [number, number], muted = false) => ({
	muted,
	topic: { name },
	stars: ids.map((id, i) => ({ id, cx: at(i)[0], cy: at(i)[1] })),
});
const sky = (...clusters: ReturnType<typeof cluster>[]) => ({ clusters }) as never;
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const view: Rect = { x0: 0, y0: 0, x1: 100, y1: 100 };
const IN: [number, number] = [50, 50];
const OUT: [number, number] = [500, 500];
/** Answers by id: `r` last answered right, anything else not. */
const lit = (right: string[]) => new Map(right.map((id) => [id, { answers: [{ outcome: "right" as AnswerOutcome }] }])) as never;

describe("the topics in view", () => {
	it("a topic with half its facts in view counts, and then all its facts count", () => {
		const a = cluster("Alpha", ids("a", 4), (i) => (i < 2 ? IN : OUT));
		const got = countInView(sky(a), view, lit([]));
		assert.deepEqual([got.topics, got.facts, got.name], [1, 4, "Alpha"]);
	});

	it("a topic with fewer than half its facts in view does not count, nor do its facts", () => {
		const a = cluster("Alpha", ids("a", 4), () => IN);
		const b = cluster("Beta", ids("b", 3), (i) => (i < 1 ? IN : OUT));
		const got = countInView(sky(a, b), view, lit([]));
		assert.deepEqual([got.topics, got.facts, got.name], [1, 4, "Alpha"]);
	});

	it("two topics in view are counted together and have no single name", () => {
		const a = cluster("Alpha", ids("a", 3), () => IN);
		const b = cluster("Beta", ids("b", 2), () => IN);
		const got = countInView(sky(a, b), view, lit([]));
		assert.deepEqual([got.topics, got.facts, got.name], [2, 5, null]);
	});

	it("Ungrouped never counts, however many of its facts are in view", () => {
		const loose = cluster("Ungrouped", ids("u", 5), () => IN, true);
		const a = cluster("Alpha", ids("a", 2), () => IN);
		assert.deepEqual(countInView(sky(loose, a), view, lit([])), { topics: 1, facts: 2, lit: 0, name: "Alpha" });
		assert.deepEqual(countInView(sky(loose), view, lit([])), { topics: 0, facts: 0, lit: 0, name: null });
	});

	it("when no topic reaches half, the topic with the most facts in view counts, with all its facts", () => {
		const a = cluster("Alpha", ids("a", 8), (i) => (i < 2 ? IN : OUT));
		const b = cluster("Beta", ids("b", 9), (i) => (i < 3 ? IN : OUT));
		const c = cluster("Gamma", ids("c", 6), (i) => (i < 1 ? IN : OUT));
		const got = countInView(sky(a, b, c), view, lit([]));
		assert.deepEqual([got.topics, got.facts, got.name], [1, 9, "Beta"]);
	});

	it("a view with no fact in it counts nothing", () => {
		const a = cluster("Alpha", ids("a", 3), () => OUT);
		assert.deepEqual(countInView(sky(a), view, lit([])), { topics: 0, facts: 0, lit: 0, name: null });
		assert.deepEqual(countInView(sky(), view, lit([])), { topics: 0, facts: 0, lit: 0, name: null });
	});

	it("a fact on the edge of the view is in it", () => {
		const a = cluster("Alpha", ids("a", 1), () => [100, 0]);
		assert.equal(countInView(sky(a), view, lit([])).topics, 1);
	});
});

describe("the lit count", () => {
	it("is the lit facts of the named topic, and a fact is lit when its latest answer was right", () => {
		const a = cluster("Alpha", ids("a", 4), () => IN);
		const factById = new Map([
			["a0", { answers: [{ outcome: "wrong" }, { outcome: "right" }] }],
			["a1", { answers: [{ outcome: "right" }, { outcome: "wrong" }] }],
			["a2", { answers: [] }],
		]) as never;
		assert.equal(countInView(sky(a), view, factById).lit, 1);
	});

	it("counts nothing from a topic that is not counted, nor from Ungrouped", () => {
		const a = cluster("Alpha", ids("a", 2), () => IN);
		const b = cluster("Beta", ids("b", 3), (i) => (i < 1 ? IN : OUT));
		const loose = cluster("Ungrouped", ids("u", 2), () => IN, true);
		const got = countInView(sky(a, b, loose), view, lit(["a0", "b0", "b1", "u0", "u1"]));
		assert.deepEqual([got.name, got.facts, got.lit], ["Alpha", 2, 1]);
	});

	it("adds up the counted topics when more than one is in view", () => {
		const a = cluster("Alpha", ids("a", 2), () => IN);
		const b = cluster("Beta", ids("b", 2), () => IN);
		assert.equal(countInView(sky(a, b), view, lit(["a0", "b0", "b1"])).lit, 3);
	});
});

describe("the figure places near", () => {
	const space = course();
	const far = layoutSky(space.topics, space.links, space.facts, 1440, measure);
	const nn = starPitch(far);
	const figures = figuresOf(far, space.chains, nn);
	const placed = movedSky(far, figures.places, 1);
	const factById = new Map(space.facts.map((f) => [f.id, f]));

	it("a fact whose figure place is outside the view is not in view, even where its far place is inside", () => {
		const k = far.clusters.find((o) => !o.muted && o.stars.length > 3)!;
		const mover = k.stars.find((st) => Math.hypot(figures.places.get(st.id)!.cx - st.cx, figures.places.get(st.id)!.cy - st.cy) > 6)!;
		assert.ok(mover, "a fact that moves into its figure");
		const around: Rect = { x0: mover.cx - 1, y0: mover.cy - 1, x1: mover.cx + 1, y1: mover.cy + 1 };
		assert.equal(countInView(far, around, factById).topics, 1, "in view where it is laid out");
		assert.deepEqual(countInView(placed, around, factById), { topics: 0, facts: 0, lit: 0, name: null });
	});

	it("a fact whose figure place is inside the view is in view, even where its far place is outside", () => {
		const k = far.clusters.find((o) => !o.muted && o.stars.length > 3)!;
		const mover = k.stars.find((st) => Math.hypot(figures.places.get(st.id)!.cx - st.cx, figures.places.get(st.id)!.cy - st.cy) > 6)!;
		const to = figures.places.get(mover.id)!;
		const around: Rect = { x0: to.cx - 1, y0: to.cy - 1, x1: to.cx + 1, y1: to.cy + 1 };
		assert.equal(countInView(far, around, factById).topics, 0);
		assert.equal(countInView(placed, around, factById).topics, 1);
	});

	for (const [name, make] of [["the intro course", introC], ["the made-up course", course]] as const) {
		it(`${name}: flying to a topic by its figure places brings every one of its facts into view`, () => {
			const sp = make();
			const { sky: s, scale } = fitPicture((w) => layoutSky(sp.topics, sp.links, sp.facts, w, measure), { width: 1192, height: 600 });
			const f: Frame = { w: s.width * scale, h: Math.max(s.height * scale, 600), scale, skyW: s.width, skyH: s.height };
			const pitch = starPitch(s);
			const shown = movedSky(s, figuresOf(s, sp.chains, pitch).places, 1);
			const byId = new Map(sp.facts.map((x) => [x.id, x]));
			for (const k of shown.clusters.filter((o) => !o.muted)) {
				const v = viewRect(camOnTopic(k, f, pitch, topZoom(pitch, f)), f);
				for (const st of k.stars) assert.ok(st.cx >= v.x0 && st.cx <= v.x1 && st.cy >= v.y0 && st.cy <= v.y1, `${k.topic.name}: ${st.id}`);
				const got = countInView(shown, v, byId);
				assert.ok(got.facts >= k.stars.length, `${k.topic.name} counts`);
				if (got.topics === 1) assert.equal(got.name, k.topic.name);
			}
		});
	}
});
