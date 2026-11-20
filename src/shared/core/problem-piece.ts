/**
 * Where a problem is printed in its file: the pieces of pages the lesson draws instead of
 * retyped text. The server writes one JSON shape in a `problem` result's details and on a
 * stored homework problem; this reads it the way the display reads any stored input.
 */
import { isRecord } from "./is-record.ts";

/** One stretch of a page. `crop` is [left, top, right, bottom] as fractions of the page and
 *  `aspect` is the whole page's width over its height. */
export interface PiecePart {
	page: number;
	crop: [number, number, number, number];
	aspect: number;
}

/** Where a part of the problem, "a" or "b", starts: `y` is a fraction of its page from the top. */
export interface PieceLabel {
	label: string;
	page: number;
	y: number;
}

/** Where the problem starts on a page shown whole, as fractions of that page. */
interface PieceMark {
	page: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ProblemPiece {
	fileId: string;
	/** One to four, top to bottom. */
	parts: PiecePart[];
	labels?: PieceLabel[];
	mark?: PieceMark;
}

const MAX_PARTS = 4;

const isPage = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;
const isFraction = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;

function partOf(value: unknown): PiecePart | null {
	if (!isRecord(value) || !isPage(value.page) || typeof value.aspect !== "number" || !Number.isFinite(value.aspect) || value.aspect <= 0) return null;
	const crop = value.crop;
	if (!Array.isArray(crop) || crop.length !== 4 || !crop.every(isFraction)) return null;
	const [left, top, right, bottom] = crop as [number, number, number, number];
	if (!(left < right) || !(top < bottom)) return null;
	return { page: value.page, crop: [left, top, right, bottom], aspect: value.aspect };
}

function labelOf(value: unknown): PieceLabel | null {
	if (!isRecord(value) || typeof value.label !== "string" || value.label === "" || !isPage(value.page) || !isFraction(value.y)) return null;
	return { label: value.label, page: value.page, y: value.y };
}

function markOf(value: unknown): PieceMark | null {
	if (!isRecord(value) || !isPage(value.page) || !isFraction(value.x) || !isFraction(value.y) || !isFraction(value.width) || !isFraction(value.height)) return null;
	return { page: value.page, x: value.x, y: value.y, width: value.width, height: value.height };
}

/** A printed problem: where it is, and its words as the file has them. */
export interface ProblemPieceText {
	piece: ProblemPiece;
	text: string;
}

/** The piece and the words of a problem result's details, or null for details with no valid
 *  piece. One bad part, label or mark makes the whole piece unreadable. */
export function problemPieceOf(details: unknown): ProblemPieceText | null {
	if (!isRecord(details) || !isRecord(details.piece)) return null;
	const raw = details.piece;
	if (typeof raw.fileId !== "string" || raw.fileId === "" || !Array.isArray(raw.parts) || raw.parts.length < 1 || raw.parts.length > MAX_PARTS) return null;
	const parts = raw.parts.map(partOf);
	if (parts.some((p) => p === null)) return null;
	const piece: ProblemPiece = { fileId: raw.fileId, parts: parts as PiecePart[] };
	if (raw.labels !== undefined) {
		if (!Array.isArray(raw.labels)) return null;
		const labels = raw.labels.map(labelOf);
		if (labels.some((l) => l === null)) return null;
		piece.labels = labels as PieceLabel[];
	}
	if (raw.mark !== undefined) {
		const mark = markOf(raw.mark);
		if (!mark) return null;
		piece.mark = mark;
	}
	return { piece, text: typeof details.text === "string" ? details.text : "" };
}

/** The statement of a posed problem: the call's own when it is not empty, else the words of the
 *  piece its result carries. */
export function problemStatementOf(input: unknown, details: unknown): string {
	const statement = isRecord(input) && typeof input.statement === "string" ? input.statement : "";
	if (statement !== "") return statement;
	return problemPieceOf(details)?.text ?? "";
}
