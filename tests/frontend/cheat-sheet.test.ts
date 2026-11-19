/**
 * The cheat sheet's pure core: the page size, and the canvas's artboards and
 * camera.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	pageCaption,
	pageSizeLabel,
	type SheetPage,
} from "../../src/shared/core/cheat-sheet.ts";
import {
	artboards,
	bounds,
	fitCamera,
	fitWidthCamera,
	pageAt,
	pageRegion,
	regionScale,
	toWorld,
	visiblePart,
	wheelCamera,
	zoomAt,
	zoomLabel,
	zoomStep,
} from "../../src/frontend/components/cheat-sheet/canvas-model.ts";
import { DOCK_MIN_W, dockWidth, makeTarget, parseDockState, pickSheet } from "../../src/frontend/components/cheat-sheet/dock-model.ts";

const A4: SheetPage = { widthPt: 595.28, heightPt: 841.89 };
const LETTER: SheetPage = { widthPt: 612, heightPt: 792 };

describe("cheat sheet: the page size", () => {
	it("names the paper by its first page, and the sides", () => {
		assert.equal(pageSizeLabel([A4, A4]), "A4, front and back");
		assert.equal(pageSizeLabel([{ widthPt: 792, heightPt: 612 }]), "Letter sideways, one side");
		assert.equal(pageSizeLabel([{ widthPt: 360, heightPt: 216 }]), "3 × 5 card, one side");
		assert.equal(pageSizeLabel([{ widthPt: 432, heightPt: 657 }, LETTER, LETTER]), "6 × 9.13 in, 3 pages");
		assert.equal(pageSizeLabel([]), "");
	});

	it("labels two pages Front and Back, the rest by number", () => {
		assert.deepEqual([pageCaption(0, 2), pageCaption(1, 2), pageCaption(0, 1), pageCaption(2, 3)], ["Front", "Back", "Page 1", "Page 3"]);
	});
});

describe("cheat sheet: the canvas", () => {
	const versions = [
		{ n: 1, pages: [LETTER] },
		{ n: 2, pages: [A4, A4] },
	];

	it("lays out the newest version first, its pages side by side at their size, labeled", () => {
		const [newest, older] = artboards(versions);
		assert.deepEqual([newest!.n, older!.n], [2, 1]);
		assert.deepEqual(
			newest!.pages.map((p) => [p.label, Math.round(p.x), p.y, Math.round(p.w), Math.round(p.h)]),
			[
				["Front", 0, 0, 794, 1123],
				["Back", 842, 0, 794, 1123],
			],
		);
		assert.deepEqual(older!.pages.map((p) => [p.label, Math.round(p.x), p.w, p.h]), [["Page 1", 1835, 816, 1056]]);
		assert.deepEqual(bounds(newest!.pages.map((p) => p))!, newest!.box);
		assert.equal(bounds([]), null);
	});

	it("fits a box into the part of the view the toolbar leaves, centered, never past 100%", () => {
		const cam = fitCamera({ x: 0, y: 0, w: 1000, h: 500 }, { x: 0, y: 0, w: 628, h: 600 }, 64);
		assert.equal(cam.zoom, 0.5);
		assert.deepEqual([cam.x, cam.y], [64, 175]);
		assert.equal(fitCamera({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 800, h: 800 }).zoom, 1);
	});

	it("zooms toward a point, keeping what is under it still, within 10% and 800%", () => {
		const cam = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, { x: 100, y: 50 });
		assert.deepEqual(cam, { x: -100, y: -50, zoom: 2 });
		assert.equal(zoomAt(cam, 100, { x: 0, y: 0 }).zoom, 8);
		assert.equal(zoomAt(cam, 0.001, { x: 0, y: 0 }).zoom, 0.1);
	});

	it("steps − and + through set zooms, and shows the zoom as a percent", () => {
		assert.deepEqual([zoomStep(1, 1), zoomStep(1, -1), zoomStep(0.6, 1), zoomStep(8, 1), zoomStep(0.1, -1)], [1.25, 0.75, 0.67, 8, 0.1]);
		assert.equal(zoomLabel(0.666), "67%");
	});

	it("pans on scroll and zooms toward the pointer on pinch or Ctrl/⌘ + scroll", () => {
		const cam = { x: 10, y: 10, zoom: 1 };
		const wheel = { deltaX: 5, deltaY: 20, deltaMode: 0, ctrlKey: false, metaKey: false };
		assert.deepEqual(wheelCamera(cam, wheel, { x: 0, y: 0 }), { x: 5, y: -10, zoom: 1 });
		assert.deepEqual(wheelCamera(cam, { ...wheel, deltaMode: 1, deltaX: 0, deltaY: 1 }, { x: 0, y: 0 }), { x: 10, y: -6, zoom: 1 });
		const pinch = wheelCamera(cam, { ...wheel, deltaY: -30, ctrlKey: true }, { x: 10, y: 10 });
		assert.ok(pinch.zoom > 1);
		assert.deepEqual([pinch.x, pinch.y], [10, 10], "the point under the pointer stays");
		assert.ok(wheelCamera(cam, { ...wheel, metaKey: true }, { x: 0, y: 0 }).zoom < 1);
	});

	it("stacks a version's pages one under another for a narrow view, and fits its width with the top in view", () => {
		const [only] = artboards([{ n: 2, pages: [A4, A4] }], true);
		assert.deepEqual(
			only!.pages.map((p) => [p.label, p.x, Math.round(p.y)]),
			[
				["Front", 0, 0],
				["Back", 0, 1171],
			],
		);
		const cam = fitWidthCamera(only!.box, { x: 0, y: 0, w: 430, h: 600 }, 16);
		assert.equal(cam.zoom, 398 / only!.box.w);
		assert.deepEqual([Math.round(cam.x), cam.y], [16, 16]);
	});

	it("turns a drag into a box on the page, as fractions cut to its edges", () => {
		const page = { x: 100, y: 0, w: 800, h: 1000 };
		assert.deepEqual(pageRegion({ x: 500, y: 600 }, { x: 300, y: 100 }, page), { x: 0.25, y: 0.1, w: 0.25, h: 0.5 });
		assert.deepEqual(pageRegion({ x: 0, y: -50 }, { x: 300, y: 200 }, page), { x: 0, y: 0, w: 0.25, h: 0.2 });
		assert.equal(pageRegion({ x: 300, y: 300 }, { x: 303, y: 400 }, page), null, "too thin to mean anything");
		const boards = artboards([{ n: 1, pages: [A4, A4] }])[0]!.pages;
		assert.equal(pageAt(boards, { x: 900, y: 10 })?.page, 1);
		assert.equal(pageAt(boards, { x: 810, y: 10 }), null, "the gap between pages");
		assert.deepEqual(toWorld({ x: -100, y: 50, zoom: 2 }, { x: 100, y: 250 }), { x: 100, y: 100 });
	});

	it("draws a pointed-at part about 1400 pixels across, between 1.5 and 4 times", () => {
		assert.equal(regionScale(700, 200), 2);
		assert.equal(regionScale(100, 50), 4);
		assert.equal(regionScale(2000, 900), 1.5);
	});

	it("finds the part of a page on screen, in the page's own pixels", () => {
		const page = { x: 0, y: 0, w: 800, h: 1000 };
		assert.deepEqual(visiblePart({ x: 0, y: 0, zoom: 1 }, page, { w: 400, h: 300 }), { x: 0, y: 0, w: 400, h: 300 });
		assert.deepEqual(visiblePart({ x: -200, y: 100, zoom: 2 }, page, { w: 400, h: 300 }), { x: 100, y: 0, w: 200, h: 100 });
		assert.equal(visiblePart({ x: 1000, y: 0, zoom: 1 }, page, { w: 400, h: 300 }), null);
	});
});

describe("cheat sheet: beside a session", () => {
	const card = (deadlineId: string, made: boolean, past = false) => ({
		deadlineId,
		name: deadlineId,
		kind: "exam" as const,
		date: "2026-11-20",
		past,
		status: made ? ("made" as const) : ("none" as const),
		version: made ? { n: 1, prompt: "", at: "t", pages: [A4] } : null,
	});

	it("shows the sheet picked before, else the session's deadline's, else the next upcoming one with a sheet", () => {
		const cards = [card("quiz", true), card("mid", false), card("final", true), card("old", true, true)];
		assert.equal(pickSheet(cards, "mid", "final"), "final");
		assert.equal(pickSheet(cards, "final", undefined), "final");
		assert.equal(pickSheet(cards, "mid", "gone"), "quiz", "the session's has no sheet yet");
		assert.equal(pickSheet([card("old", true, true)], undefined, undefined), "old");
		assert.equal(pickSheet([card("mid", false)], "mid", undefined), null);
	});

	it("makes a new sheet for the session's deadline, else the next upcoming one", () => {
		assert.equal(makeTarget([card("quiz", false), card("mid", false)], "mid"), "mid");
		assert.equal(makeTarget([card("old", false, true), card("quiz", false)], undefined), "quiz");
		assert.equal(makeTarget([], "mid"), null);
	});

	it("remembers whether it is open and which sheet, and keeps a width the session can live beside", () => {
		assert.deepEqual(parseDockState('{"open":true,"deadlineId":"ddl_1"}'), { open: true, deadlineId: "ddl_1" });
		assert.deepEqual(parseDockState("nope"), { open: false });
		assert.deepEqual(parseDockState(null), { open: false });
		assert.equal(dockWidth(900, 1440), 440);
		assert.equal(dockWidth(100, 1200), DOCK_MIN_W);
		assert.equal(dockWidth(500.4, 1600), 500);
	});
});
