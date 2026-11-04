/**
 * The cheat sheet's pure core: the saved record (and the HTML and block
 * sheets of older builds read as "made in an older format"), its versions,
 * checking the agent's PDF, the page size, the request's text, and the
 * canvas's artboards and camera.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHEAT_SHEET_FORMAT,
	cheatSheetRequestText,
	currentVersion,
	mistakeCounts,
	newCheatSheet,
	pageCaption,
	pageSizeLabel,
	parseCheatSheet,
	pdfProblem,
	sheetFolderName,
	sheetMistakes,
	withPrompt,
	withVersion,
	type CheatSheet,
	type SheetPage,
} from "../src/core/cheat-sheet.ts";
import { artboards, bounds, fitCamera, visiblePart, wheelCamera, zoomAt, zoomLabel, zoomStep } from "../src/components/cheat-sheet/canvas-model.ts";

const A4: SheetPage = { widthPt: 595.28, heightPt: 841.89 };
const LETTER: SheetPage = { widthPt: 612, heightPt: 792 };

describe("cheat sheet: the saved record", () => {
	it("reads its versions, prompts and folder, drops broken entries, and refuses a newer record", () => {
		const saved = {
			version: CHEAT_SHEET_FORMAT,
			deadlineId: "ddl_1",
			versions: [{ n: 1, prompt: "A4", at: "t", pages: [A4, A4] }, { n: 2, prompt: "x", at: "t", pages: [] }, { n: "3" }],
			prompts: [{ text: "A4", at: "t", files: ["a.png"] }, { text: 3 }],
			folder: "CSE 21 Midterm",
			updatedAt: "u",
		};
		assert.deepEqual(parseCheatSheet(saved), {
			deadlineId: "ddl_1",
			versions: [{ n: 1, prompt: "A4", at: "t", pages: [A4, A4] }],
			prompts: [{ text: "A4", at: "t", files: ["a.png"] }],
			folder: "CSE 21 Midterm",
			updatedAt: "u",
		});
		assert.equal(parseCheatSheet({ ...saved, version: CHEAT_SHEET_FORMAT + 1 }), "newer");
		assert.equal(parseCheatSheet({ version: 3 }), null);
	});

	it("keeps an HTML sheet's prompts and says it was made in an older format", () => {
		const html = { version: 2, deadlineId: "ddl_1", doc: { widthIn: 8.27, heightIn: 11.69, css: "", pages: ["<p>x</p>"] }, prompts: [{ text: "A4", at: "t" }], updatedAt: "u" };
		assert.deepEqual(parseCheatSheet(html), { deadlineId: "ddl_1", versions: [], prompts: [{ text: "A4", at: "t" }], olderFormat: true, updatedAt: "u" });
		assert.equal((parseCheatSheet({ ...html, doc: null }) as CheatSheet).olderFormat, undefined, "nothing was made");
	});

	it("keeps a block sheet's instructions as its first prompt", () => {
		const blocks = { version: 1, deadlineId: "ddl_1", prefs: { instructions: " both sides " }, blocks: [{ title: "Counting", body: "x" }], confirmedAt: "c", updatedAt: "u" };
		assert.deepEqual(parseCheatSheet(blocks), { deadlineId: "ddl_1", versions: [], prompts: [{ text: "both sides", at: "c" }], olderFormat: true, updatedAt: "u" });
		assert.deepEqual((parseCheatSheet({ deadlineId: "ddl_1", blocks: [] }) as CheatSheet).prompts, [], "no version is version 1");
	});

	it("keeps the last 20 prompts", () => {
		let sheet = newCheatSheet("ddl_1", "t");
		for (let i = 0; i < 25; i++) sheet = withPrompt(sheet, { text: `ask ${i}`, at: "t" });
		assert.equal(sheet.prompts.length, 20);
		assert.equal(sheet.prompts[0]!.text, "ask 5");
	});

	it("numbers each version, keeps the last 5, says which went, and leaves the older format behind", () => {
		let sheet: CheatSheet = { ...newCheatSheet("ddl_1", "t"), olderFormat: true };
		assert.equal(currentVersion(sheet), null);
		const dropped: number[] = [];
		for (let i = 1; i <= 7; i++) {
			const next = withVersion(sheet, { prompt: `ask ${i}`, at: `t${i}`, pages: [A4] });
			sheet = next.sheet;
			dropped.push(...next.dropped);
		}
		assert.deepEqual(sheet.versions.map((v) => v.n), [3, 4, 5, 6, 7]);
		assert.deepEqual(dropped, [1, 2]);
		assert.deepEqual([currentVersion(sheet)!.prompt, sheet.updatedAt, sheet.olderFormat], ["ask 7", "t7", undefined]);
	});
});

describe("cheat sheet: the agent's PDF", () => {
	it("must be a PDF under 20 MB with 1 to 4 pages of a sane size", () => {
		assert.equal(pdfProblem({ bytes: 1000 }), null, "the size alone, before reading");
		assert.match(pdfProblem({ bytes: 21 * 1024 * 1024 })!, /21 MB; keep it under 20 MB/);
		assert.match(pdfProblem({ bytes: 10, head: "\\docum" })!, /not a PDF/);
		assert.equal(pdfProblem({ bytes: 10, head: "%PDF-1.5", pages: [A4, A4] }), null);
		assert.match(pdfProblem({ bytes: 10, head: "%PDF-", pages: [] })!, /0 pages; a cheat sheet has 1 to 4/);
		assert.match(pdfProblem({ bytes: 10, head: "%PDF-", pages: [A4, A4, A4, A4, A4] })!, /5 pages/);
		assert.match(pdfProblem({ bytes: 10, head: "%PDF-", pages: [{ widthPt: 72, heightPt: 792 }] })!, /between 2 and 17 inches/);
	});

	it("is made in a working folder named for the class and deadline", () => {
		assert.equal(sheetFolderName("CSE 21", "Midterm: part 1"), "CSE 21 Midterm- part 1");
	});
});

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

describe("cheat sheet: the request", () => {
	const topics = [
		{ id: "tpc_a", name: "Counting", status: "weak" as const, mistakes: 2, facts: [{ name: "Permutations", statement: "P(n,k) = n!/(n-k)!" }] },
		{ id: "tpc_b", name: "Sums", status: "strong" as const, mistakes: 0, facts: [] },
	];
	const base = {
		title: "CSE 21 Midterm",
		date: "2026-11-04",
		classNotes: "Rosen's notation.",
		infoFiles: ["syllabus.txt"],
		prompt: "double sided A4, and a flowchart",
		earlier: [],
		topics,
		mistakes: [{ topicId: "tpc_a", text: "7 students, 3 sections", kind: "wrong" as const, at: "t" }],
		folder: { path: "/home/me/godspeed/cheat-sheets/CSE 21 Midterm", files: [] },
		current: null,
	};

	it("says what the student asks, where the rules are, the topics with readiness and facts, the mistakes and the working folder", () => {
		const text = cheatSheetRequestText(base);
		assert.match(text, /^Cheat sheet for: CSE 21 Midterm on 2026-11-04\nAbout the class: Rosen's notation\.\nCourse info files \(the rules are likely here\): syllabus\.txt/);
		assert.match(text, /The student asks:\ndouble sided A4, and a flowchart/);
		assert.match(text, /Counting \| weak, 2 mistakes\n {2}- Permutations: P\(n,k\) = n!\/\(n-k\)!\nSums \| knows it well/);
		assert.match(text, /answered wrong \(Counting\): "7 students, 3 sections"/);
		assert.match(text, /Working folder: \/home\/me\/godspeed\/cheat-sheets\/CSE 21 Midterm\nIt is empty\. Keep the sheet's source here so later changes can edit it\.$/);
		assert.doesNotMatch(text, /current sheet|asked before/);
	});

	it("says where the current sheet's source is and what was asked before for a change", () => {
		const current = { n: 2, prompt: "A4", at: "t", pages: [A4, A4] };
		const text = cheatSheetRequestText({ ...base, infoFiles: [], prompt: "bigger text", earlier: [{ text: "A4", at: "t" }], folder: { ...base.folder, files: ["sheet.pdf", "sheet.tex"] }, current });
		assert.match(text, /no course info files; search all its files/);
		assert.match(text, /What they asked before, oldest first:\n- A4/);
		assert.match(text, /It has: sheet\.pdf, sheet\.tex\. The current sheet is the last PDF you made here \(A4, front and back\)\. Change its source as asked and send the new PDF; keep the rest as it is\.$/);
		const many = cheatSheetRequestText({ ...base, infoFiles: ["HW1.pdf", ...Array.from({ length: 9 }, (_, i) => `n${i}.txt`), "syllabus.txt"] });
		assert.match(many, /likely here\): syllabus\.txt, HW1\.pdf, n0\.txt, .*, n5\.txt, and 3 more\n/);
	});

	it("takes the newest mistakes in the deadline's topics, each question once, and counts them", () => {
		const answers = [
			{ text: "How many 5-card hands?", kind: "wrong" as const, at: "2026-10-01", topicIds: ["counting"] },
			{ text: "  How many 5-card   hands? ", kind: "wrong" as const, at: "2026-10-03", topicIds: ["counting"] },
			{ text: "E[X^2] for a die", kind: "hint" as const, at: "2026-10-02", topicIds: ["other", "probability"] },
			{ text: "Off topic", kind: "wrong" as const, at: "2026-10-04", topicIds: ["other"] },
		];
		assert.deepEqual(sheetMistakes(answers, ["counting", "probability"]).map((m) => [m.topicId, m.text, m.kind]), [
			["counting", "How many 5-card hands?", "wrong"],
			["probability", "E[X^2] for a die", "hint"],
		]);
		assert.deepEqual([...mistakeCounts(answers, ["counting", "probability"])], [["counting", 2], ["probability", 1]]);
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

	it("fits a box into the part of the view the panel leaves, centered, never past 100%", () => {
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

	it("finds the part of a page on screen, in the page's own pixels", () => {
		const page = { x: 0, y: 0, w: 800, h: 1000 };
		assert.deepEqual(visiblePart({ x: 0, y: 0, zoom: 1 }, page, { w: 400, h: 300 }), { x: 0, y: 0, w: 400, h: 300 });
		assert.deepEqual(visiblePart({ x: -200, y: 100, zoom: 2 }, page, { w: 400, h: 300 }), { x: 100, y: 0, w: 200, h: 100 });
		assert.equal(visiblePart({ x: 1000, y: 0, zoom: 1 }, page, { w: 400, h: 300 }), null);
	});
});
