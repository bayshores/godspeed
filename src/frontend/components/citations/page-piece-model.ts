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

/** About one line of a printed page, as a share of its height: the sheet shows this much of the
 *  page above the problem and under it. */
const LINE = 0.03;

/** Under this, two stretches meet. */
const TOUCH = 1e-6;

/** A fraction of a page kept to four places, so a picture's address stays short and the same. */
const fourPlaces = (n: number) => Math.round(n * 10000) / 10000;

/** The stretches joined where they meet or overlap, top to bottom. */
function joined(bands: readonly Band[]): Band[] {
	const out: Band[] = [];
	for (const band of [...bands].sort((a, b) => a.top - b.top)) {
		const last = out.at(-1);
		if (last && band.top <= last.top + last.height + TOUCH) last.height = Math.max(last.height, band.top + band.height - last.top);
		else out.push({ ...band });
	}
	return out;
}

/** What joined stretches leave of their part, top to bottom. */
function between(bands: readonly Band[]): Band[] {
	const out: Band[] = [];
	let at = 0;
	for (const band of bands) {
		if (band.top - at > TOUCH) out.push({ top: at, height: band.top - at });
		at = Math.max(at, band.top + band.height);
	}
	if (1 - at > TOUCH) out.push({ top: at, height: 1 - at });
	return out;
}

/** The line over a part's own stretch and the line under it, as fractions of the part; null where the part reaches no further than its own. */
function around(top: number, ownTop: number, ownBottom: number, bottom: number): [Band | null, Band | null] {
	const span = bottom - top;
	const over = { top: 0, height: (ownTop - top) / span };
	const under = { top: (ownBottom - top) / span, height: (bottom - ownBottom) / span };
	return [over.height > TOUCH ? over : null, under.height > TOUCH ? under : null];
}

/** Where the problem itself starts on its sheet: its mark on a page shown whole, else its first own line. */
function startOf(piece: ProblemPiece, parts: readonly PiecePart[]): Place {
	const marked = piece.mark ? parts.findIndex((p) => p.page === piece.mark!.page) : -1;
	const index = Math.max(0, marked);
	const [, top, , bottom] = parts[index]!.crop;
	const y = marked >= 0 ? piece.mark!.y : piece.parts[0]!.crop[1];
	return { part: index, at: clamp((y - top) / (bottom - top)) };
}

/**
 * The problem as its sheet shows it, read in its place on the page. `whole`: the sheet is the
 * page itself, from its top to its foot (the first part from its page's top, the last to its
 * page's foot); else the first part reaches a line higher on its page and the last a line lower,
 * as far as the page goes. Each part's stretches, as fractions of that part from its top:
 * `veiled`, the page around the problem and the labelled parts the learner is not on (veils);
 * `lit`, the rest, which carries the bar of the problem's own lines. A page with columns (which
 * can't be cut) has its mark instead of a bar. `edges`: each part's line over it and line under
 * it, which fade out toward the sheet's edge, since a line of the page may be cut through; a
 * whole page has none. `rest`: where the sheet rests, the start of the part the learner is on,
 * or on a whole page with no such part the problem's start.
 */
export function pieceSheet(piece: ProblemPiece, part: string | null, whole: boolean): { piece: ProblemPiece; veiled: Band[][]; lit: Band[][]; edges: (Band | null)[][]; rest: Place | null } {
	const last = piece.parts.length - 1;
	const parts = piece.parts.map((p, i): PiecePart => {
		const [left, top, right, bottom] = p.crop;
		const from = i !== 0 ? top : whole ? 0 : fourPlaces(Math.max(0, top - LINE));
		const to = i !== last ? bottom : whole ? 1 : fourPlaces(Math.min(1, bottom + LINE));
		return { ...p, crop: [left, from, right, to] };
	});
	const sheet = { ...piece, parts };
	const { bands, current } = veils(sheet, part);
	const rims = parts.map((p, i) => around(p.crop[1], piece.parts[i]!.crop[1], piece.parts[i]!.crop[3], p.crop[3]));
	const veiled = parts.map((_, i) => joined([...bands[i]!, ...rims[i]!.filter((band) => band !== null)]));
	const edges = whole ? parts.map((): [Band | null, Band | null] => [null, null]) : rims;
	return { piece: sheet, veiled, lit: veiled.map((bands) => (piece.mark ? [] : between(bands))), edges, rest: current ?? (whole ? startOf(piece, parts) : null) };
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
