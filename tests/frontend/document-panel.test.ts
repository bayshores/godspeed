/**
 * The panel beside a lesson and its Document panel, pure parts: what a lesson remembers, which
 * panel is open, which file shows, where the open problem's box sits and where the view goes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LessonDocument, ProblemPiece } from "../../src/shared/core/index.ts";
import { DOCK_MIN_W, dockWidth, openPanel, parseDockState } from "../../src/frontend/components/lesson/lesson-dock-model.ts";
import { documentChoices, pageAspects, pageAt, pageKeyWords, problemDocument, problemPlace, scrollTarget, shownDocument } from "../../src/frontend/components/lesson/document-model.ts";
import { PIECE, SINGLE_PIECE } from "../piece-fixtures.ts";

const pdf = (id: string, name: string): LessonDocument => ({ id, name, path: `/files/${name}.pdf`, pdf: true, pages: 9, aspect: 0.77 });
const TEST = pdf("f_test", "Midterm 2022");
const KEY = pdf("f_key", "Midterm 2022 key");
const NOTES: LessonDocument = { id: "f_notes", name: "Notes", path: "/files/Notes.docx", pdf: false };

describe("the panel beside a lesson", () => {
	it("remembers which panel is open, the sheet and the file, and reads a state saved before the Document panel", () => {
		assert.deepEqual(parseDockState('{"panel":"document","fileId":"f_key","deadlineId":"ddl_1"}'), { panel: "document", deadlineId: "ddl_1", fileId: "f_key" });
		assert.deepEqual(parseDockState('{"open":true,"deadlineId":"ddl_1"}'), { panel: "sheet", deadlineId: "ddl_1" });
		assert.deepEqual(parseDockState('{"open":false}'), { panel: null });
		assert.deepEqual(parseDockState('{"panel":"plugin"}'), { panel: null });
		assert.deepEqual(parseDockState("nope"), { panel: null });
		assert.deepEqual(parseDockState(null), { panel: null });
	});

	it("opens one panel at a time, and only one the lesson has", () => {
		const both = { sheet: true, document: true };
		assert.equal(openPanel("document", both), "document");
		assert.equal(openPanel("sheet", both), "sheet");
		assert.equal(openPanel(null, both), null);
		assert.equal(openPanel("document", { sheet: true, document: false }), null, "its file left the space");
		assert.equal(openPanel("sheet", { sheet: false, document: true }), null, "a lesson with no space");
	});

	it("keeps a width the lesson can live beside", () => {
		assert.equal(dockWidth(900, 1440), 440);
		assert.equal(dockWidth(100, 1200), DOCK_MIN_W);
		assert.equal(dockWidth(500.4, 1600), 500);
	});
});

describe("the Document panel: which file", () => {
	it("lists the PDFs only, the list's file first", () => {
		assert.deepEqual(documentChoices([TEST, NOTES, KEY]), [TEST, KEY]);
		assert.deepEqual(documentChoices([NOTES]), []);
	});

	it("shows the file picked before while it is there, else the first PDF, else none", () => {
		assert.equal(shownDocument([TEST, KEY], undefined), TEST);
		assert.equal(shownDocument([TEST, KEY], "f_key"), KEY);
		assert.equal(shownDocument([TEST], "f_key"), TEST, "the picked file left the space");
		assert.equal(shownDocument([NOTES, KEY], "f_notes"), KEY, "a file that is not a PDF is never shown");
		assert.equal(shownDocument([NOTES], undefined), null);
		assert.equal(shownDocument([], undefined), null);
	});
});

describe("the Document panel: the open problem", () => {
	it("boxes each stretch of the problem's piece on its page", () => {
		assert.deepEqual(problemPlace(PIECE, 7, "f_test"), {
			fileId: "f_123",
			page: 2,
			boxes: [
				{ page: 2, aspect: 0.75, x: 0.1, y: 0.6, w: 0.8, h: 0.35 },
				{ page: 3, aspect: 0.75, x: 0.1, y: 0.05, w: 0.8, h: 0.45 },
			],
		});
	});

	it("boxes the mark on a page with columns, which is cut whole", () => {
		const columns: ProblemPiece = { fileId: "f_c", parts: [{ page: 4, crop: [0, 0, 1, 1], aspect: 1.3 }], mark: { page: 4, x: 0.52, y: 0.1, width: 0.4, height: 0.2 } };
		assert.deepEqual(problemPlace(columns, undefined, null)!.boxes, [{ page: 4, aspect: 1.3, x: 0.52, y: 0.1, w: 0.4, h: 0.2 }]);
	});

	it("without a piece goes to the page the list gives in the list's file, else nowhere", () => {
		assert.deepEqual(problemPlace(null, 3, "f_test"), { fileId: "f_test", page: 3, boxes: [] });
		assert.equal(problemPlace(null, undefined, "f_test"), null);
		assert.equal(problemPlace(null, 3, null), null);
	});

	it("shows the problem in its piece's file, else in the list's file, never in whichever file comes first", () => {
		const key = pdf("f_key", "Key");
		const piece = pdf("f_123", "Midterm");
		assert.equal(problemDocument([key, piece], problemPlace(PIECE, undefined, null), "f_test"), piece);
		assert.equal(problemDocument([key, pdf("f_test", "Test")], problemPlace(null, 3, "f_test"), "f_test")?.id, "f_test");
		assert.equal(problemDocument([key], null, null), null, "the list's file left the space: the key is not taken for it");
		assert.equal(problemDocument([key], problemPlace(null, 3, null), null), null);
	});

	it("draws the problem's pages at their own shape and the rest at the first page's", () => {
		const place = problemPlace(SINGLE_PIECE, undefined, null);
		assert.deepEqual(pageAspects(3, 0.77, place, "f_9"), [0.5, 0.77, 0.77]);
		assert.deepEqual(pageAspects(2, 0.77, place, "f_other"), [0.77, 0.77], "another file");
		assert.deepEqual(pageAspects(2, 0.77, null, "f_9"), [0.77, 0.77]);
	});

	it("names the page, and the file only when it is not the lesson's first", () => {
		assert.deepEqual(pageKeyWords(4, null), { file: null, page: "Page 4" });
		assert.deepEqual(pageKeyWords(2, "Midterm 2022 key"), { file: "Midterm 2022 key", page: ", page 2" });
	});
});

describe("the Document panel: the view", () => {
	it("says the page whose top passed the view's reading line", () => {
		const tops = [12, 512, 1012, 1512];
		assert.equal(pageAt(tops, 0, 400), 1);
		assert.equal(pageAt(tops, 400, 400), 2, "page 2's top is above 40% of the view");
		assert.equal(pageAt(tops, 300, 400), 1);
		assert.equal(pageAt(tops, 5000, 400), 4);
		assert.equal(pageAt([], 0, 400), 0);
	});

	it("puts the box a third of the room it leaves down the view, a tall box at the top and no box at the page's top", () => {
		const page = { top: 1000, height: 600 };
		const box = { page: 2, aspect: 0.75, x: 0.1, y: 0.5, w: 0.8, h: 0.25 };
		// The box is 150 tall from 1300; the view is 450, so 100 is left above it.
		assert.equal(scrollTarget(page, box, 450, 5000), 1200);
		assert.equal(scrollTarget(page, { ...box, h: 0.9 }, 450, 5000), 1284, "taller than the view: its top under the margin");
		assert.equal(scrollTarget(page, null, 450, 5000), 984);
		assert.equal(scrollTarget(page, box, 450, 900), 900, "never past the end");
		assert.equal(scrollTarget({ top: 12, height: 600 }, null, 450, 5000), 0, "never above the start");
	});
});
