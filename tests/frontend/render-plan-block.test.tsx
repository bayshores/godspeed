import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlanBlock } from "../../src/frontend/components/plan-block.tsx";
import {
	blockLayout,
	edgePathD,
	wrapTitle,
	GAP_X,
	NODE_H,
	NODE_W_MIN,
	nodeWidth,
	estimateLineWidth,
} from "../../src/frontend/components/plan-block-model.ts";
import type { PlanBlockData, PlanTree } from "../../src/shared/core/contracts.ts";

// Plan blocks: the pure layered layout and the frozen-snapshot card.
// "The plan" dialog is tested with the plan row (render-plan-row.test.tsx).

const CHAIN: PlanTree = {
	nodes: [
		{ id: "a", title: "Alpha node" },
		{ id: "b", title: "Beta node" },
		{ id: "c", title: "Gamma node" },
	],
	edges: [
		{ from: "a", to: "b" },
		{ from: "b", to: "c" },
	],
};

describe("plan block layout (pure)", () => {
	it("layers a chain top-down, one node per depth row", () => {
		const layout = blockLayout(CHAIN.nodes, CHAIN.edges);
		assert.ok(layout.y.get("a")! < layout.y.get("b")! && layout.y.get("b")! < layout.y.get("c")!, "one row per depth, top-down");
		// Text-first sizing: each box hugs its title (10 chars ≈ 66 + 2×16).
		const W = nodeWidth(wrapTitle("Alpha node"));
		assert.equal(W, 98);
		assert.equal(nodeWidth(wrapTitle("Gamma node")), 98);
		assert.equal(layout.width, 98);
		assert.equal(layout.height, 3 * NODE_H + 2 * 48);
		assert.equal(layout.nodeW.get("a"), W);
	});

	it("centers same-depth nodes over the widest row; tolerates dangling edges", () => {
		const nodes = [
			{ id: "r", title: "Root" },
			{ id: "x", title: "Left" },
			{ id: "y", title: "Right" },
		];
		const layout = blockLayout(nodes, [
			{ from: "r", to: "x" },
			{ from: "r", to: "y" },
			{ from: "ghost", to: "r" }, // dangling: ignored defensively
		]);
		const W = nodeWidth(wrapTitle("Root"));
		assert.equal(layout.width, 2 * W + GAP_X);
		// Root centered over its two children: (2*W+GAP - W)/2
		assert.equal(layout.x.get("r"), (2 * W + GAP_X - W) / 2);
		assert.ok(layout.x.get("x") === 0 && layout.x.get("y") === W + GAP_X);
	});

	it("edgePathD draws dagre's route through curveBasis — mouth pulled back from the border", () => {
		// Straight 3-point route (source border → mid → target border): the
		// basis curve starts exactly at the border point; the END pulls
		// back by HEAD_TIP_OVERHANG + the docking gap (92 − 2.359 − 2.667) so
		// the head's TIP floats 2.67 short of the border with its mouth at
		// the path's end, on a straight shaft (the head + gap scaled ⅔ with
		// the 1px lines).
		const d = edgePathD([{ x: 80, y: 44 }, { x: 80, y: 68 }, { x: 80, y: 92 }]);
		assert.ok(d.startsWith("M80,44"), "starts at the source border point");
		assert.ok(d.endsWith("L80,86.974"), "mouth pulled back; tip floats 2.67 off the border");
		// The whole run stays on-axis (every x is 80): a collinear route
		// renders straight — the shaft stub never bends a straight edge.
		const xs = [...d.matchAll(/(?:[MLC]|,)(-?[\d.]+),/g)].map((m) => m[1]);
		assert.ok(xs.length > 0 && xs.every((v) => v === "80"), "collinear route renders on-axis");
		// A perpendicular entry with the target box is the SAME geometry.
		const pd = edgePathD([{ x: 80, y: 44 }, { x: 80, y: 68 }, { x: 80, y: 92 }], { x: 0, y: 92, w: 160, h: 44 });
		assert.equal(pd, d);
	});

	it("edgePathD clamps the entry to ±40° of the face perpendicular", () => {
		const box = { x: 20, y: 100, w: 160, h: 44 };
		// A 60° tilt into the top face swings to the 40° cone edge: the
		// mouth lands at (97.726, 93.289) and the final segment runs at
		// exactly 40° (Δx/Δy = tan 40°). The tip floats DOCK_GAP (4) off the
		// face along the normal: border (100,100) → tip (100,96).
		const clamped = edgePathD([{ x: 70, y: 70 }, { x: 100, y: 100 }], box);
		assert.ok(clamped.endsWith("L98.484,95.526"), "swung to the cone edge");
		// final L's from-point is the previous number pair; recompute direction
		const nums = [...clamped.matchAll(/(-?[\d.]+)/g)].map((m) => Number(m[1]));
		const ax = nums[nums.length - 4]!;
		const ay = nums[nums.length - 3]!;
		const bx = nums[nums.length - 2]!;
		const by = nums[nums.length - 1]!;
		assert.ok(Math.abs((bx - ax) / (by - ay) - Math.tan((40 * Math.PI) / 180)) < 0.01, "40° cone edge");
		// Tip = mouth + u'·overhang floats 2.67 above the face.
		const tipY = by + 0.766 * 2.359;
		assert.ok(Math.abs(tipY - 97.333) < 0.01, "docking gap along the face normal");
		// A shallow (~9.5°) tilt is WITHIN the limit: no swing.
		const free = edgePathD([{ x: 90, y: 40 }, { x: 100, y: 100 }], box);
		assert.ok(free.endsWith("L99.612,95.006"), "unclamped within the cone");
	});

	it("wrapTitle wraps greedily and NEVER drops content (boxes grow instead)", () => {
		assert.deepEqual(wrapTitle("Chain rule intuition"), ["Chain rule intuition"]); // well under — one line
		assert.deepEqual(wrapTitle("Chain rule intuition and fluency"), [
			"Chain rule intuition and", // 24 — appending "fluency" would pass 28
			"fluency",
		]);
		// Oversized word hard-chunked, nothing lost.
		assert.deepEqual(wrapTitle("supercalifragilisticexpialidocious word"), [
			"supercalifragilisticexpialid", // the chunker cuts AT maxChars
			"ocious word",
		]);
		assert.deepEqual(wrapTitle("supercalifragilistic"), ["supercalifragilistic"]); // exactly 20 — fits
	});

	it("nodeWidth hugs the wrapped text (the box grows WITH its lines)", () => {
		// Short titles floor at the min; wide ones size to the widest line.
		// Per-char-CLASS estimate (the flat px/char rate
		// overshot the rendered width — invisible slack beside the text).
		assert.equal(nodeWidth(["supercalifragilistic"]), 164); // 20 chars ≈ 132 + 2×16
		assert.equal(nodeWidth(wrapTitle("Symmetry and orthogonal complements")), 184);
		// The hug is symmetric padding — 16 a side, the SAME as the vertical
		// (44−12)/2 — and never below the floor.
		assert.ok(nodeWidth(["a"]) === NODE_W_MIN);
		assert.ok(Math.abs(estimateLineWidth("The normal-form ladder") - 145.2) < 0.5);
	});
});

describe("plan block render", () => {
	it("the card fills the column, statuses AS CARRIED (never re-derived)", () => {
		const data: PlanBlockData = {
			kind: "full",
			at: "2026-09-09T12:00:00Z",
			current: null,
			nodes: [
				{ id: "a", title: "Alpha node", status: "visited" },
				{ id: "b", title: "Beta node", status: "upcoming" },
			],
			edges: [{ from: "a", to: "b" }],
		};
		const html = renderToStaticMarkup(<PlanBlock data={data} onOpen={() => {}} />);
		assert.match(html, /data-testid="plan-block-full"/);
		// A card on the lesson's background, like the other cards in the text.
		assert.match(html, /data-testid="plan-block-full"[^>]*class="[^"]*border-edge bg-background/);
		// Fills the column UP TO the chat-font cap: the svg is w-full +
		// mx-auto with maxWidth = extent × TEXT_CAP_SCALE, so node text never
		// renders past the 16px prose size.
		assert.match(html, /<svg[^>]*class="block h-auto w-full mx-auto"/);
		// The reading font, not the mono UI font — via the
		// runtime var (the font-prose utility would bake the @theme literal
		// and ignore the Appearance reading-font override).
		assert.match(html, /<svg[^>]*font-family:var\(--font-prose\)/);
		// Lines + outlines at the app's standard 1px border weight.
		assert.match(html, /<rect[^>]*stroke-width="1"/);
		assert.match(html, /max-width:161.5px/); // (98+16) × 17/12
		// Centered text: every title line
		// anchors to its box's midline — the old x=12 left inset is gone.
		assert.match(html, /<text[^>]*x="49"[^>]*text-anchor="middle"/); // 98/2
		assert.ok(!/x="12"/.test(html), "no left-inset text");
		// Panel-colored boxes with ink outlines; no node shows progress.
		assert.match(html, /<rect[^>]*class="fill-panel stroke-ink"/);
		// Two stacked nodes: 2*NODE_H + GAP_Y = 136 extent + GRAPH_PAD on
		// every side (strokes/glow never clip at the edges). The width
		// rides the hug now: 96-min boxes, not the old 160 slabs.
		assert.match(html, /viewBox="-8 -8 114 152"/);
		// Snapshot statuses render as carried.
		assert.match(html, /data-testid="plan-node-a" data-status="visited"/);
		assert.match(html, /data-testid="plan-node-b" data-status="upcoming"/);
		assert.ok(html.includes('aria-label="Open the full plan"'), "the trigger names itself (tooltip copy)");
	});

});
