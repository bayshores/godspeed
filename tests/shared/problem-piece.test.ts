import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { problemPieceOf, problemStatementOf } from "../../src/shared/core/problem-piece.ts";
import { PIECE, PIECE_DETAILS, PIECE_TEXT, SINGLE_PIECE } from "../piece-fixtures.ts";

const withPiece = (change: (piece: Record<string, unknown>) => void) => {
	const piece = structuredClone(PIECE) as unknown as Record<string, unknown>;
	change(piece);
	return { piece, text: "words" };
};

describe("problemPieceOf", () => {
	it("reads a piece and its words", () => {
		assert.deepEqual(problemPieceOf(PIECE_DETAILS), { piece: PIECE, text: PIECE_TEXT });
	});

	it("reads a piece with a mark and no labels", () => {
		const mark = { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.02 };
		const read = problemPieceOf({ piece: { ...SINGLE_PIECE, mark }, text: "" });
		assert.deepEqual(read?.piece.mark, mark);
		assert.equal(read?.piece.labels, undefined);
	});

	it("drops keys it does not know and takes missing words as none", () => {
		const read = problemPieceOf({ piece: { ...SINGLE_PIECE, extra: 1 } });
		assert.deepEqual(read, { piece: SINGLE_PIECE, text: "" });
	});

	it("reads nothing from details that carry no piece", () => {
		for (const details of [null, undefined, "text", 4, [], {}, { piece: null }, { piece: [] }, { stop: { kind: "problem" } }]) assert.equal(problemPieceOf(details), null);
	});

	it("reads nothing from a piece of the wrong shape, and never throws", () => {
		const bad = [
			withPiece((p) => (p.fileId = "")),
			withPiece((p) => (p.fileId = 7)),
			withPiece((p) => (p.parts = [])),
			withPiece((p) => (p.parts = Array(5).fill(PIECE.parts[0]))),
			withPiece((p) => (p.parts = [{ page: 0, crop: [0, 0, 1, 1], aspect: 1 }])),
			withPiece((p) => (p.parts = [{ page: 1.5, crop: [0, 0, 1, 1], aspect: 1 }])),
			withPiece((p) => (p.parts = [{ page: 1, crop: [0, 0, 1], aspect: 1 }])),
			withPiece((p) => (p.parts = [{ page: 1, crop: [0.5, 0, 0.5, 1], aspect: 1 }])),
			withPiece((p) => (p.parts = [{ page: 1, crop: [0, 0.7, 1, 0.2], aspect: 1 }])),
			withPiece((p) => (p.parts = [{ page: 1, crop: [0, 0, 1, 1.2], aspect: 1 }])),
			withPiece((p) => (p.parts = [{ page: 1, crop: [0, 0, 1, Number.NaN], aspect: 1 }])),
			withPiece((p) => (p.parts = [{ page: 1, crop: [0, 0, 1, 1], aspect: 0 }])),
			withPiece((p) => (p.parts = [null])),
			withPiece((p) => (p.labels = "a")),
			withPiece((p) => (p.labels = [{ label: "", page: 1, y: 0.1 }])),
			withPiece((p) => (p.labels = [{ label: "a", page: 1, y: 2 }])),
			withPiece((p) => (p.mark = { page: 1, x: 0.1 })),
		];
		for (const details of bad) assert.equal(problemPieceOf(details), null, JSON.stringify(details.piece).slice(0, 80));
	});
});

describe("problemStatementOf", () => {
	it("is the call's statement when it has words", () => {
		assert.equal(problemStatementOf({ statement: "Prove it." }, PIECE_DETAILS), "Prove it.");
	});

	it("is the piece's words when the statement is left out or empty", () => {
		assert.equal(problemStatementOf({ mode: "recall" }, PIECE_DETAILS), PIECE_TEXT);
		assert.equal(problemStatementOf({ statement: "" }, PIECE_DETAILS), PIECE_TEXT);
		assert.equal(problemStatementOf(undefined, PIECE_DETAILS), PIECE_TEXT);
	});

	it("is empty when neither has words", () => {
		assert.equal(problemStatementOf({ statement: 4 }, null), "");
		assert.equal(problemStatementOf(null, { piece: "x" }), "");
	});
});
