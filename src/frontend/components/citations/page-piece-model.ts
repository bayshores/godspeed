import type { PieceLabel, PiecePart, ProblemPiece } from "@/shared/core";

/** The widths the server draws a page picture at; one asked for is rounded up to the next
 *  (crates/services/src/app/reading_pages.rs PIECE_WIDTHS). */
export const PIECE_WIDTHS = [480, 720, 960, 1440, 1920] as const;

/** The width to ask for: the box's width in screen pixels, up to the next step. */
export function pieceWidth(boxWidth: number, pixelRatio: number): number {
	const need = boxWidth * pixelRatio;
	return PIECE_WIDTHS.find((w) => w >= need) ?? PIECE_WIDTHS[PIECE_WIDTHS.length - 1]!;
}

/** The picture of a page, or of one stretch of it when `crop` is given: in the theme's ink, or as printed. */
export function pageSrc(fileId: string, page: number, width: number, ink: string | null, crop?: PiecePart["crop"]): string {
	const query = [...(crop ? [`crop=${crop.join(",")}`] : []), `w=${width}`, ...(ink === null ? [] : [`ink=${ink.replace(/^#/, "").toLowerCase()}`])];
	return `/api/cited/${fileId}/page/${page}?${query.join("&")}`;
}

/** The picture of one part: its page cut to its crop. */
export function partSrc(fileId: string, part: PiecePart, width: number, ink: string | null): string {
	return pageSrc(fileId, part.page, width, ink, part.crop);
}

/** The shape a part's box keeps before its picture arrives: width over height. */
export function partAspect(part: PiecePart): number {
	const [left, top, right, bottom] = part.crop;
	return ((right - left) * part.aspect) / (bottom - top);
}

/** A stretch of one part, as fractions of that part's height from its top. */
interface Band {
	top: number;
	height: number;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** A label's place: the part that shows it and how far down that part it starts. */
interface Place {
	part: number;
	at: number;
}

/** The part of a page that holds `y`, else the first part on that page. */
function placeOf(parts: readonly PiecePart[], label: PieceLabel): Place | null {
	const holds = parts.findIndex((p) => p.page === label.page && label.y >= p.crop[1] && label.y <= p.crop[3]);
	const index = holds >= 0 ? holds : parts.findIndex((p) => p.page === label.page);
	if (index < 0) return null;
	const [, top, , bottom] = parts[index]!.crop;
	return { part: index, at: clamp((label.y - top) / (bottom - top)) };
}

/** A part's label as the learner is told it: "(a)", "a" and "A" are one. */
const same = (a: string, b: string) => a.trim().replace(/^\(|\)$/g, "").toLowerCase() === b.trim().replace(/^\(|\)$/g, "").toLowerCase();

/** Where each part, top to bottom, is veiled, and where the part the learner is on starts.
 *  Every labelled part but `part` is veiled from its label to the next one (or the piece's
 *  end); what stands above the first label is never veiled. */
export function veils(piece: ProblemPiece, part: string | null): { bands: Band[][]; current: Place | null } {
	const bands: Band[][] = piece.parts.map(() => []);
	const places = (piece.labels ?? []).map((l) => ({ label: l.label, place: placeOf(piece.parts, l) }));
	if (!part || !places.some((l) => same(l.label, part))) return { bands, current: null };
	let current: Place | null = null;
	places.forEach((l, i) => {
		if (!l.place) return;
		if (same(l.label, part)) {
			current = l.place;
			return;
		}
		const next = places.slice(i + 1).find((n) => n.place)?.place ?? { part: piece.parts.length - 1, at: 1 };
		for (let p = l.place.part; p <= next.part; p++) {
			const from = p === l.place.part ? l.place.at : 0;
			const to = p === next.part ? next.at : 1;
			if (to > from) bands[p]!.push({ top: from, height: to - from });
		}
	});
	return { bands, current };
}

/** The mark of a piece, as fractions of the part that shows its page (a page with columns is
 *  shown whole, so these are the page's own), or null when no part shows that page. */
export function markBox(piece: ProblemPiece, partIndex: number): { x: number; y: number; w: number; h: number } | null {
	const { mark } = piece;
	const part = piece.parts[partIndex];
	if (!mark || !part || part.page !== mark.page) return null;
	const [left, top, right, bottom] = part.crop;
	return { x: (mark.x - left) / (right - left), y: (mark.y - top) / (bottom - top), w: mark.width / (right - left), h: mark.height / (bottom - top) };
}
