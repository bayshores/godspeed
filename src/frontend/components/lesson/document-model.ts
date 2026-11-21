/** The Document panel beside a lesson: which file it shows, where the open problem sits on its pages and where the view goes. Pure. */
import type { LessonDocument, PiecePart, ProblemPiece } from "@/shared/core";

/** The files the panel's picker lists, the list's file first: the PDFs. */
export function documentChoices(documents: readonly LessonDocument[]): LessonDocument[] {
	return documents.filter((d) => d.pdf);
}

/** The PDF the panel shows: the one picked before in this lesson while it is still there, else
 *  the first. null when the lesson has none, and then the panel is not offered. */
export function shownDocument(documents: readonly LessonDocument[], picked: string | undefined): LessonDocument | null {
	const pdfs = documentChoices(documents);
	return pdfs.find((d) => d.id === picked) ?? pdfs[0] ?? null;
}

/** A box on a page, as fractions of the page; `aspect` is that page's width over its height. */
export interface PageBox {
	page: number;
	aspect: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Where the open problem is printed: its file, the page it starts on and its boxes. */
export interface ProblemPlace {
	fileId: string;
	page: number;
	boxes: PageBox[];
}

/** A stretch that holds this much of its page or more is a page shown whole. */
const WHOLE_PAGE = 0.9;

function partBox(part: PiecePart, piece: ProblemPiece): PageBox {
	const [left, top, right, bottom] = part.crop;
	const { mark } = piece;
	// A page with columns is cut whole, so the mark is where the problem is on it.
	if (mark && mark.page === part.page && (right - left) * (bottom - top) >= WHOLE_PAGE) return { page: part.page, aspect: part.aspect, x: mark.x, y: mark.y, w: mark.width, h: mark.height };
	return { page: part.page, aspect: part.aspect, x: left, y: top, w: right - left, h: bottom - top };
}

/** The open problem's place: its piece's stretches boxed, else the page its list gives in the
 *  list's file. null when neither says where it is. */
export function problemPlace(piece: ProblemPiece | null, page: number | undefined, listFileId: string | null): ProblemPlace | null {
	if (piece) return { fileId: piece.fileId, page: piece.parts[0]!.page, boxes: piece.parts.map((p) => partBox(p, piece)) };
	return page !== undefined && listFileId ? { fileId: listFileId, page, boxes: [] } : null;
}

/** The open problem's file: where its piece is printed, else the file its list is printed in
 *  (`listFileId`, null when there is no open problem or that file left the space). */
export function problemDocument(documents: readonly LessonDocument[], place: ProblemPlace | null, listFileId: string | null): LessonDocument | null {
	const id = place?.fileId ?? listFileId;
	return documents.find((d) => d.id === id) ?? null;
}

/** Each page's shape, width over height, in file `fileId`: a page the open problem is on has its
 *  own, the rest the first page's. */
export function pageAspects(pages: number, aspect: number, place: ProblemPlace | null, fileId: string): number[] {
	const own = new Map(place?.fileId === fileId ? place.boxes.map((b) => [b.page, b.aspect]) : []);
	return Array.from({ length: pages }, (_, i) => own.get(i + 1) ?? aspect);
}

/** A page is in view once its top passes this share of the view. */
const READ_LINE = 0.4;

/** The page in view, from 1: the last page whose top is above the view's reading line. */
export function pageAt(tops: readonly number[], scrollTop: number, viewH: number): number {
	const line = scrollTop + viewH * READ_LINE;
	let at = 0;
	tops.forEach((top, i) => {
		if (top <= line) at = i;
	});
	return Math.min(tops.length, at + 1);
}

/** Room left above a page or a box the view goes to. */
const MARGIN = 16;

/** Where the view scrolls to show a page: with a box on it, the box with a third of the room it
 *  leaves above it (its top under the margin when it is taller than the view), else the page's
 *  top. `room` is how far the view can scroll. */
export function scrollTarget(page: { top: number; height: number }, box: PageBox | null, viewH: number, room: number): number {
	let goal = page.top - MARGIN;
	if (box) {
		const top = page.top + box.y * page.height;
		const height = box.h * page.height;
		goal = height + 2 * MARGIN <= viewH ? top - (viewH - height) / 3 : top - MARGIN;
	}
	return Math.round(Math.max(0, Math.min(room, goal)));
}

/** The words of the key on "Your turn" that shows the open problem's page, "Page 4": the file is
 *  named in front ("Midterm 2022 key", ", page 2") only when it is not the lesson's first file. */
export function pageKeyWords(page: number, otherFile: string | null): { file: string | null; page: string } {
	return otherFile ? { file: otherFile, page: `, page ${page}` } : { file: null, page: `Page ${page}` };
}
