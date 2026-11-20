import type { ProblemPiece } from "../src/shared/core/index.ts";

/** A problem printed on two pages with parts (a), (b) and (c), as the server writes it. */
export const PIECE: ProblemPiece = {
	fileId: "f_123",
	parts: [
		{ page: 2, crop: [0.1, 0.6, 0.9, 0.95], aspect: 0.75 },
		{ page: 3, crop: [0.1, 0.05, 0.9, 0.5], aspect: 0.75 },
	],
	labels: [
		{ label: "a", page: 2, y: 0.8 },
		{ label: "b", page: 3, y: 0.15 },
		{ label: "c", page: 3, y: 0.35 },
	],
};

export const PIECE_TEXT = "Let f be continuous. (a) Show f is bounded. (b) Show f attains a maximum. (c) Is f uniformly continuous?";

/** The details of a `problem` result that carries the piece. */
export const PIECE_DETAILS = JSON.parse(JSON.stringify({ piece: PIECE, text: PIECE_TEXT }));

/** One part on one page, no labels. */
export const SINGLE_PIECE: ProblemPiece = { fileId: "f_9", parts: [{ page: 1, crop: [0.1, 0.2, 0.9, 0.4], aspect: 0.5 }] };
