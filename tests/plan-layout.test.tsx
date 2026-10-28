import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockLayout, edgePathD, type LayoutNode } from "../src/components/plan-block.tsx";

// ─── The canvas must cover the arrows (owner, 2026-10-10) ────────────────────
// The owner's REAL linear-algebra plan (chat_mv19m6xe, plan_init's mermaid
// parsed to nodes/edges — golden fixtures use real data, owner ruling
// 2026-10-10): a cross-column edge's bezier control points reached x=776
// while dagre's node-extent width was 754 — 14px of arrow clipped at the
// viewBox edge (the Hume plan cut 20px the same way).
const LINEAR_ALGEBRA_NODES: LayoutNode[] = [
{ id: "vector-space-axioms", title: "What a vector space is" },
	{ id: "span-basis-dimension", title: "Span, basis, dimension" },
	{ id: "matrix-as-map", title: "Matrices as maps" },
	{ id: "elimination-rank", title: "Elimination exposes rank" },
	{ id: "determinant-volume", title: "Det as volume scaling" },
	{ id: "orthogonality-complements", title: "Orthogonality and complements" },
	{ id: "projection-theorem", title: "The projection theorem" },
	{ id: "transpose-adjoint", title: "The transpose as bridge" },
	{ id: "normal-equations", title: "Least squares, normal equations" },
	{ id: "eigen-diagonalization", title: "Eigenvectors as coordinates" },
	{ id: "spectral-theorem", title: "The spectral theorem" },
	{ id: "pca-synthesis", title: "Goal: PCA and least-squares derivations" }
];
const LINEAR_ALGEBRA_EDGES: ReadonlyArray<{ from: string; to: string }> = [
{ from: "span-basis-dimension", to: "matrix-as-map" },
	{ from: "matrix-as-map", to: "elimination-rank" },
	{ from: "matrix-as-map", to: "determinant-volume" },
	{ from: "matrix-as-map", to: "orthogonality-complements" },
	{ from: "span-basis-dimension", to: "orthogonality-complements" },
	{ from: "orthogonality-complements", to: "projection-theorem" },
	{ from: "orthogonality-complements", to: "transpose-adjoint" },
	{ from: "matrix-as-map", to: "transpose-adjoint" },
	{ from: "projection-theorem", to: "normal-equations" },
	{ from: "transpose-adjoint", to: "normal-equations" },
	{ from: "matrix-as-map", to: "normal-equations" },
	{ from: "determinant-volume", to: "eigen-diagonalization" },
	{ from: "matrix-as-map", to: "eigen-diagonalization" },
	{ from: "span-basis-dimension", to: "eigen-diagonalization" },
	{ from: "eigen-diagonalization", to: "spectral-theorem" },
	{ from: "transpose-adjoint", to: "spectral-theorem" },
	{ from: "orthogonality-complements", to: "spectral-theorem" },
	{ from: "spectral-theorem", to: "pca-synthesis" },
	{ from: "normal-equations", to: "pca-synthesis" }
];

describe("blockLayout ink extent", () => {
	it("covers every edge path's control points — arrows never clip (owner, 2026-10-10)", () => {
		const L = blockLayout(LINEAR_ALGEBRA_NODES, LINEAR_ALGEBRA_EDGES);
		// The viewBox extent must reach the furthest control point of
		// every drawn edge (a bezier never leaves its control-point hull).
		let ctrlMaxX = -Infinity;
		for (const e of LINEAR_ALGEBRA_EDGES) {
			const pts = L.edgePts.get(`${e.from}->${e.to}`);
			if (!pts) continue;
			const target = {
				x: L.x.get(e.to)!,
				y: L.y.get(e.to)!,
				w: L.nodeW.get(e.to)!,
				h: L.nodeH.get(e.to)!,
			};
			const nums = edgePathD(pts, target).match(/-?\d+(?:\.\d+)?/g) ?? [];
			for (let i = 0; i + 1 < nums.length; i += 2)
				ctrlMaxX = Math.max(ctrlMaxX, parseFloat(nums[i]!));
		}
		assert.ok(ctrlMaxX > -Infinity, "the fixture has edges");
		assert.ok(
			ctrlMaxX <= (L.originX ?? 0) + L.width + 0.5,
			`control point ${ctrlMaxX} exceeds the canvas right edge ${(L.originX ?? 0) + L.width}`,
		);
	});

	it("the real plan's overhang actually EXTENDS the canvas past the node extent", () => {
		const L = blockLayout(LINEAR_ALGEBRA_NODES, LINEAR_ALGEBRA_EDGES);
		let nodeMaxX = -Infinity;
		for (const n of LINEAR_ALGEBRA_NODES)
			nodeMaxX = Math.max(nodeMaxX, (L.x.get(n.id) ?? 0) + (L.nodeW.get(n.id) ?? 0));
		// Pre-fix dagre width was 754 with ink at 776 — width must stay ≥
		// ink, which here strictly exceeds the node extent.
		assert.ok(L.width > nodeMaxX + 1, `layout width ${L.width} should exceed node extent ${nodeMaxX}`);
	});
});
