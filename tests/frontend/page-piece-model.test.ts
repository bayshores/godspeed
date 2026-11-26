import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markBox, pageSrc, partAspect, partSrc, pieceSheet, pieceWidth, veils } from "../../src/frontend/components/citations/page-piece-model.ts";
import type { ProblemPiece } from "../../src/shared/core/index.ts";
import { PIECE, SINGLE_PIECE } from "../piece-fixtures.ts";

const near = (got: number, want: number) => assert.ok(Math.abs(got - want) < 1e-4, `${got} is not ${want}`);
const bandsAre = (got: { top: number; height: number }[], want: [number, number][]) => {
	assert.equal(got.length, want.length, JSON.stringify(got));
	want.forEach(([top, height], i) => {
		near(got[i]!.top, top);
		near(got[i]!.height, height);
	});
};

describe("pieceWidth", () => {
	it("rounds the box's pixels up to the next step", () => {
		assert.equal(pieceWidth(300, 1), 480);
		assert.equal(pieceWidth(480, 1), 480);
		assert.equal(pieceWidth(481, 1), 720);
		assert.equal(pieceWidth(360, 2), 720);
		assert.equal(pieceWidth(600, 2), 1440);
		assert.equal(pieceWidth(900, 2), 1920);
	});

	it("stops at the widest step", () => {
		assert.equal(pieceWidth(3000, 2), 1920);
	});

	it("asks the narrowest step of a box with no width yet", () => {
		assert.equal(pieceWidth(0, 2), 480);
	});
});

describe("partSrc", () => {
	const part = PIECE.parts[0]!;

	it("asks for the part's page, crop and width, in the ink", () => {
		assert.equal(partSrc("f_123", part, 960, "#33322C"), "/api/cited/f_123/page/2?crop=0.1,0.6,0.9,0.95&w=960&ink=33322c");
	});

	it("leaves the ink out for a page as printed", () => {
		assert.equal(partSrc("f_123", part, 720, null), "/api/cited/f_123/page/2?crop=0.1,0.6,0.9,0.95&w=720");
	});
});

describe("pageSrc", () => {
	it("asks for a whole page with no crop", () => {
		assert.equal(pageSrc("f_1", 14, 1440, "#33322C"), "/api/cited/f_1/page/14?w=1440&ink=33322c");
		assert.equal(pageSrc("f_1", 14, 720, null), "/api/cited/f_1/page/14?w=720");
	});
});

describe("partAspect", () => {
	it("is the cropped width over its height, in the page's own shape", () => {
		near(partAspect({ page: 1, crop: [0, 0, 1, 1], aspect: 0.7727 }), 0.7727);
		near(partAspect({ page: 1, crop: [0.1, 0.6, 0.9, 0.95], aspect: 0.75 }), (0.8 * 0.75) / 0.35);
	});
});

describe("veils", () => {
	it("veils nothing while no part is named, or a part the piece does not have", () => {
		for (const part of [null, "z"]) {
			const { bands, current } = veils(PIECE, part);
			assert.deepEqual(bands, [[], []]);
			assert.equal(current, null);
		}
	});

	it("veils nothing on a piece with no labels", () => {
		const { bands, current } = veils({ fileId: "f", parts: PIECE.parts }, "a");
		assert.deepEqual(bands, [[], []]);
		assert.equal(current, null);
	});

	it("keeps (a) clear and veils (b) and (c) down to the piece's end, across the page break", () => {
		const { bands, current } = veils(PIECE, "a");
		assert.deepEqual(bands[0], []);
		bandsAre(bands[1]!, [
			[0.2222, 0.4444],
			[0.6667, 0.3333],
		]);
		assert.equal(current?.part, 0);
		near(current!.at, 0.5714);
	});

	it("veils (a) from its label across the page break to (b), and (c) after (b)", () => {
		const { bands, current } = veils(PIECE, "(B)");
		bandsAre(bands[0]!, [[0.5714, 0.4286]]);
		bandsAre(bands[1]!, [
			[0, 0.2222],
			[0.6667, 0.3333],
		]);
		assert.equal(current?.part, 1);
		near(current!.at, 0.2222);
	});

	it("never veils what stands above the first label", () => {
		const { bands } = veils(PIECE, "c");
		assert.ok(bands[0]![0]!.top >= 0.5714 - 1e-4);
	});

	it("skips a label whose page the piece does not show", () => {
		const lost: ProblemPiece = { ...PIECE, labels: [...PIECE.labels!, { label: "d", page: 9, y: 0.5 }] };
		const { bands } = veils(lost, "a");
		bandsAre(bands[1]!, [
			[0.2222, 0.4444],
			[0.6667, 0.3333],
		]);
	});
});

describe("pieceSheet", () => {
	it("shows a line of the page above the first part and under the last, and nothing more between them", () => {
		const { piece } = pieceSheet(PIECE, null, false);
		assert.deepEqual(
			piece.parts.map((p) => p.crop),
			[
				[0.1, 0.57, 0.9, 0.95],
				[0.1, 0.05, 0.9, 0.53],
			],
		);
		assert.deepEqual(pieceSheet(SINGLE_PIECE, null, false).piece.parts[0]!.crop, [0.1, 0.17, 0.9, 0.43]);
	});

	it("reaches no further than the page", () => {
		const edge: ProblemPiece = { fileId: "f", parts: [{ page: 1, crop: [0, 0.01, 1, 0.99], aspect: 0.75 }] };
		assert.deepEqual(pieceSheet(edge, null, false).piece.parts[0]!.crop, [0, 0, 1, 1]);
	});

	it("names the line over the first part and the line under the last as the sheet's edges", () => {
		const { edges } = pieceSheet(PIECE, null, false);
		assert.equal(edges[0]![1], null);
		assert.equal(edges[1]![0], null);
		bandsAre([edges[0]![0]!, edges[1]![1]!], [
			[0, 0.0789],
			[0.9375, 0.0625],
		]);
		const whole: ProblemPiece = { fileId: "f", parts: [{ page: 1, crop: [0, 0, 1, 1], aspect: 0.75 }] };
		assert.deepEqual(pieceSheet(whole, null, false).edges, [[null, null]]);
	});

	it("veils the lines around the problem and bars the rest", () => {
		const { veiled, lit, rest } = pieceSheet(SINGLE_PIECE, null, false);
		bandsAre(veiled[0]!, [
			[0, 0.1154],
			[0.8846, 0.1154],
		]);
		bandsAre(lit[0]!, [[0.1154, 0.7692]]);
		assert.equal(rest, null);
	});

	it("veils the parts the learner is not on with those lines, joined where they meet, and bars only what is left", () => {
		const { veiled, lit, rest } = pieceSheet(PIECE, "b", false);
		bandsAre(veiled[0]!, [
			[0, 0.0789],
			[0.6053, 0.3947],
		]);
		bandsAre(veiled[1]!, [
			[0, 0.2083],
			[0.625, 0.375],
		]);
		bandsAre(lit[0]!, [[0.0789, 0.5263]]);
		bandsAre(lit[1]!, [[0.2083, 0.4167]]);
		assert.equal(rest?.part, 1);
		near(rest!.at, 0.2083);
	});

	it("shows the page itself when whole: from its top to its foot, veiled around the problem, with no fading edges, resting on the problem's start", () => {
		const { piece, veiled, lit, edges, rest } = pieceSheet(SINGLE_PIECE, null, true);
		assert.deepEqual(piece.parts[0]!.crop, [0.1, 0, 0.9, 1]);
		bandsAre(veiled[0]!, [
			[0, 0.2],
			[0.4, 0.6],
		]);
		bandsAre(lit[0]!, [[0.2, 0.2]]);
		assert.deepEqual(edges, [[null, null]]);
		assert.equal(rest?.part, 0);
		near(rest!.at, 0.2);
	});

	it("shows both pages of a problem that runs on, whole, and rests on the part the learner is on", () => {
		const { piece, rest } = pieceSheet(PIECE, "b", true);
		assert.deepEqual(
			piece.parts.map((p) => p.crop),
			[
				[0.1, 0, 0.9, 0.95],
				[0.1, 0.05, 0.9, 1],
			],
		);
		assert.equal(rest?.part, 1);
	});

	it("rests a whole page with columns on its mark", () => {
		const columns: ProblemPiece = { fileId: "f", parts: [{ page: 4, crop: [0, 0, 1, 1], aspect: 0.75 }], mark: { page: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.02 } };
		const { rest } = pieceSheet(columns, null, true);
		assert.equal(rest?.part, 0);
		near(rest!.at, 0.2);
	});

	it("bars nothing on a page shown whole, which has its mark", () => {
		const whole: ProblemPiece = { fileId: "f", parts: [{ page: 4, crop: [0, 0, 1, 1], aspect: 0.75 }], mark: { page: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.02 } };
		const { piece, veiled, lit } = pieceSheet(whole, null, false);
		assert.deepEqual(piece.parts[0]!.crop, [0, 0, 1, 1]);
		assert.deepEqual(veiled, [[]]);
		assert.deepEqual(lit, [[]]);
	});
});

describe("markBox", () => {
	const mark = { page: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.02 };
	const whole: ProblemPiece = { fileId: "f", parts: [{ page: 4, crop: [0, 0, 1, 1], aspect: 0.75 }], mark };

	it("is the mark's own box on a page shown whole", () => {
		assert.deepEqual(markBox(whole, 0), { x: 0.1, y: 0.2, w: 0.3, h: 0.02 });
	});

	it("is nothing without a mark, or on a part of another page", () => {
		assert.equal(markBox({ ...whole, mark: undefined }, 0), null);
		assert.equal(markBox({ ...whole, mark: { ...mark, page: 5 } }, 0), null);
		assert.equal(markBox(whole, 1), null);
	});
});
