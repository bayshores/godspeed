/**
 * The cheat sheet's pure core: the saved record (format 3's asks as the
 * chat's first messages, the HTML and block sheets of older builds read
 * as "made in an older format"), its chat, rules and versions, a newer PDF
 * in the working folder, pointing at a page, checking the agent's PDF, the
 * page size, the request's text, and the canvas's artboards and camera.
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
	sheetCards,
	sheetFolderName,
	newerFolderPdf,
	regionProblem,
	regionText,
	sheetMistakes,
	withMessage,
	withRules,
	withVersion,
	withoutRule,
	type CheatSheet,
	type SheetPage,
	type YouMessage,
} from "../src/core/cheat-sheet.ts";
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
} from "../src/components/cheat-sheet/canvas-model.ts";
import { DOCK_MIN_W, dockWidth, makeTarget, parseDockState, pickSheet, sessionAbout } from "../src/components/cheat-sheet/dock-model.ts";

const A4: SheetPage = { widthPt: 595.28, heightPt: 841.89 };
const LETTER: SheetPage = { widthPt: 612, heightPt: 792 };

describe("cheat sheet: the saved record", () => {
	it("reads its versions, chat, rules and folder, drops broken entries, and refuses a newer record", () => {
		const region = { n: 1, page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
		const about = { kind: "problem", session: "Counting", text: "How many?", work: "C(5,2)" };
		const saved = {
			version: CHEAT_SHEET_FORMAT,
			deadlineId: "ddl_1",
			versions: [{ n: 1, prompt: "A4", at: "t", pages: [A4, A4], fromFolder: true }, { n: 2, prompt: "x", at: "t", pages: [] }, { n: "3" }],
			messages: [
				{ id: "m1", role: "you", text: "A4", at: "t", files: [{ name: "a.png", file: "abc-a.png" }], region, about },
				{ id: "m2", role: "agent", text: "Done.", at: "t", version: 1, rules: ["A4"] },
				{ id: "m3", role: "teacher", text: "x", at: "t" },
				{ id: "m4", role: "you", text: 3 },
			],
			rules: [{ text: "A4, both sides", at: "t" }, { text: 1 }],
			folder: "CSE 21 Midterm",
			updatedAt: "u",
		};
		assert.deepEqual(parseCheatSheet(saved), {
			deadlineId: "ddl_1",
			versions: [{ n: 1, prompt: "A4", at: "t", pages: [A4, A4], fromFolder: true }],
			messages: [
				{ id: "m1", role: "you", text: "A4", at: "t", files: [{ name: "a.png", file: "abc-a.png" }], region, about },
				{ id: "m2", role: "agent", text: "Done.", at: "t", version: 1, rules: ["A4"] },
			],
			rules: [{ text: "A4, both sides", at: "t" }],
			folder: "CSE 21 Midterm",
			updatedAt: "u",
		});
		assert.equal(parseCheatSheet({ ...saved, version: CHEAT_SHEET_FORMAT + 1 }), "newer");
		assert.equal(parseCheatSheet({ version: 3 }), null);
	});

	it("turns format 3's asks into the chat's first messages, each followed by the version made for it", () => {
		const v3 = {
			version: 3,
			deadlineId: "ddl_1",
			versions: [{ n: 1, prompt: "A4", at: "t1", pages: [A4] }],
			prompts: [{ text: "A4", at: "t1", files: ["a.png"] }, { text: "bigger", at: "t2" }],
			folder: "CSE 21 Midterm",
			updatedAt: "u",
		};
		const sheet = parseCheatSheet(v3) as CheatSheet;
		assert.deepEqual(sheet.messages, [
			{ id: "asked-0", role: "you", text: "A4", at: "t1", files: [{ name: "a.png" }] },
			{ id: "made-0", role: "agent", text: "", at: "t1", version: 1 },
			{ id: "asked-1", role: "you", text: "bigger", at: "t2" },
		]);
		assert.deepEqual([sheet.rules, sheet.folder], [[], "CSE 21 Midterm"]);
	});

	it("keeps an HTML sheet's asks and says it was made in an older format", () => {
		const html = { version: 2, deadlineId: "ddl_1", doc: { widthIn: 8.27, heightIn: 11.69, css: "", pages: ["<p>x</p>"] }, prompts: [{ text: "A4", at: "t" }], updatedAt: "u" };
		assert.deepEqual(parseCheatSheet(html), { deadlineId: "ddl_1", versions: [], messages: [{ id: "asked-0", role: "you", text: "A4", at: "t" }], rules: [], olderFormat: true, updatedAt: "u" });
		assert.equal((parseCheatSheet({ ...html, doc: null }) as CheatSheet).olderFormat, undefined, "nothing was made");
	});

	it("keeps a block sheet's instructions as its first message", () => {
		const blocks = { version: 1, deadlineId: "ddl_1", prefs: { instructions: " both sides " }, blocks: [{ title: "Counting", body: "x" }], confirmedAt: "c", updatedAt: "u" };
		assert.deepEqual(parseCheatSheet(blocks), { deadlineId: "ddl_1", versions: [], messages: [{ id: "asked-0", role: "you", text: "both sides", at: "c" }], rules: [], olderFormat: true, updatedAt: "u" });
		assert.deepEqual((parseCheatSheet({ deadlineId: "ddl_1", blocks: [] }) as CheatSheet).messages, [], "no version is version 1");
	});

	it("keeps the last 100 messages", () => {
		let sheet = newCheatSheet("ddl_1", "t");
		for (let i = 0; i < 105; i++) sheet = withMessage(sheet, { id: `m${i}`, role: "you", text: `ask ${i}`, at: "t" });
		assert.equal(sheet.messages.length, 100);
		assert.equal(sheet.messages[0]!.text, "ask 5");
	});

	it("keeps rules once each, cleaned, at most 20, says which were new, and deletes one", () => {
		const first = withRules(newCheatSheet("ddl_1", "t"), ["A4,  both sides", "American spelling", "a4, both sides", "  "], "t1");
		assert.deepEqual(first.added, ["A4, both sides", "American spelling"]);
		assert.deepEqual(first.sheet.rules, [{ text: "A4, both sides", at: "t1" }, { text: "American spelling", at: "t1" }]);
		const again = withRules(first.sheet, ["American spelling"], "t2");
		assert.equal(again.sheet, first.sheet, "nothing new, nothing changed");
		const full = withRules(first.sheet, Array.from({ length: 30 }, (_, i) => `rule ${i}`), "t3");
		assert.equal(full.sheet.rules.length, 20);
		assert.deepEqual(withoutRule(first.sheet, "A4, both sides").rules.map((r) => r.text), ["American spelling"]);
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

describe("cheat sheet: a newer PDF in the working folder", () => {
	const at = "2026-11-04T10:00:00.000Z";
	const t = Date.parse(at);
	it("is the newest PDF there when it was written after the current version, never godspeed's own copies", () => {
		const files = [
			{ name: "sheet.tex", mtimeMs: t + 9000 },
			{ name: "sheet.pdf", mtimeMs: t + 5000 },
			{ name: "old.pdf", mtimeMs: t - 5000 },
			{ name: "cheat sheet v3.pdf", mtimeMs: t + 8000 },
		];
		assert.equal(newerFolderPdf(files, { at }), "sheet.pdf");
		assert.equal(newerFolderPdf(files.filter((f) => f.name !== "sheet.pdf"), { at }), null, "older than the version");
		assert.equal(newerFolderPdf([{ name: "old.pdf", mtimeMs: 1 }], null), "old.pdf", "any PDF when there is no version yet");
		assert.equal(newerFolderPdf([{ name: "sheet.tex", mtimeMs: t + 1 }], null), null);
	});
});

describe("cheat sheet: pointing at a page", () => {
	const versions = [{ n: 3, prompt: "", at: "t", pages: [A4, A4] }];
	it("must be on a kept version's page, inside it", () => {
		assert.equal(regionProblem({ n: 3, page: 2, x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, versions), null);
		assert.match(regionProblem({ n: 2, page: 1, x: 0, y: 0, w: 0.5, h: 0.5 }, versions)!, /version of the sheet is gone/);
		assert.match(regionProblem({ n: 3, page: 3, x: 0, y: 0, w: 0.5, h: 0.5 }, versions)!, /gone/);
		assert.match(regionProblem({ n: 3, page: 1, x: 0.8, y: 0, w: 0.5, h: 0.5 }, versions)!, /isn't on the page/);
		assert.match(regionProblem({ n: 3, page: 1, x: 0, y: 0, w: 0, h: 0.5 }, versions)!, /isn't on the page/);
	});

	it("says which page and where in plain percents", () => {
		assert.equal(regionText({ n: 3, page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.15 }, 2), "page 2 (the back), from 10% to 40% across and 20% to 35% down");
		assert.equal(regionText({ n: 3, page: 1, x: 0, y: 0, w: 1, h: 1 }, 1), "page 1, from 0% to 100% across and 0% to 100% down");
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
	const message: YouMessage = { id: "m9", role: "you", text: "double sided A4, and a flowchart", at: "t" };
	const base = {
		title: "CSE 21 Midterm",
		date: "2026-11-04",
		classNotes: "Rosen's notation.",
		infoFiles: ["syllabus.txt"],
		rules: [],
		topics,
		mistakes: [{ topicId: "tpc_a", text: "7 students, 3 sections", kind: "wrong" as const, at: "t" }],
		folder: { path: "/home/me/godspeed/cheat-sheets/CSE 21 Midterm", files: [] },
		versions: [],
		earlier: [],
		message,
	};

	it("says where the class's rules are, the topics with readiness and facts, the mistakes, the working folder, and the message last", () => {
		const text = cheatSheetRequestText(base);
		assert.match(text, /^Cheat sheet for: CSE 21 Midterm on 2026-11-04\nAbout the class: Rosen's notation\.\nCourse info files \(the rules are likely here\): syllabus\.txt/);
		assert.match(text, /Counting \| weak, 2 mistakes\n {2}- Permutations: P\(n,k\) = n!\/\(n-k\)!\nSums \| knows it well/);
		assert.match(text, /answered wrong \(Counting\): "7 students, 3 sections"/);
		assert.match(text, /Working folder: \/home\/me\/godspeed\/cheat-sheets\/CSE 21 Midterm\nIt is empty\. There is no sheet yet\. Keep its source here so later changes can edit it\./);
		assert.match(text, /\n\nThe student says:\ndouble sided A4, and a flowchart$/);
		assert.doesNotMatch(text, /rules \(follow|chat so far|pointed at|is on this/);
	});

	it("carries the sheet's rules, the sheet now, the last few messages, the problem the student is on and the part they point at", () => {
		const versions = [
			{ n: 1, prompt: "A4", at: "t", pages: [A4] },
			{ n: 2, prompt: "A4", at: "t", pages: [A4, A4] },
		];
		const earlier = [
			...Array.from({ length: 8 }, (_, i): YouMessage => ({ id: `o${i}`, role: "you", text: `old ${i}`, at: "t" })),
			{ id: "a1", role: "agent" as const, text: "Made it bigger.", at: "t", version: 2 },
			{ id: "a2", role: "agent" as const, text: "", at: "t", version: 1 },
		];
		const text = cheatSheetRequestText({
			...base,
			infoFiles: [],
			rules: [
				{ text: "A4, both sides", at: "t" },
				{ text: "American spelling", at: "t" },
			],
			folder: { ...base.folder, files: ["sheet.pdf", "sheet.tex"] },
			versions,
			earlier,
			message: {
				...message,
				text: "according to the cheat sheet that's what I did",
				about: { kind: "problem", session: "Counting practice", text: "How many   ways to seat 5?", work: "5! = 120" },
				region: { n: 1, page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
			},
		});
		assert.match(text, /no course info files; search all its files/);
		assert.match(text, /This sheet's rules \(follow every one\):\n- A4, both sides\n- American spelling/);
		assert.match(text, /It has: sheet\.pdf, sheet\.tex\. The sheet now is version 2 \(A4, front and back\), made from the source here\. To change it, edit that source/);
		assert.match(text, /The chat so far, oldest first:\nStudent: old 2\n.*Student: old 7\nYou: Made it bigger\. \[made version 2\]\nYou: \[made version 1\]/s);
		assert.doesNotMatch(text, /old 1\n/, "only the last 8 messages");
		assert.match(text, /The student is on this problem in their session "Counting practice", with the sheet open beside it:\nHow many ways to seat 5\?\nWhat they have written for it so far:\n5! = 120/);
		assert.match(text, /They pointed at version 1, page 1, from 10% to 40% across and 20% to 30% down\. The first picture shows that part\. That is an older version; the sheet now is version 2\./);
		assert.match(text, /The student says:\naccording to the cheat sheet that's what I did$/);
		const many = cheatSheetRequestText({ ...base, infoFiles: ["HW1.pdf", ...Array.from({ length: 9 }, (_, i) => `n${i}.txt`), "syllabus.txt"] });
		assert.match(many, /likely here\): syllabus\.txt, HW1\.pdf, n0\.txt, .*, n5\.txt, and 3 more\n/);
		assert.match(cheatSheetRequestText({ ...base, message: { ...message, text: "" } }), /The student says:\n\(no words, only the files\)$/);
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

describe("cheat sheet: a class's cheat sheets", () => {
	const deadline = (id: string, date: string, over: Record<string, unknown> = {}) => ({ id, kind: "exam" as const, name: id, date, fileIds: [], done: false, ...over });
	const made = { ...newCheatSheet("d", "t"), versions: [{ n: 2, prompt: "A4", at: "t", pages: [A4] }] };

	it("lists upcoming deadlines soonest first, then past ones latest first, each with where its sheet is", () => {
		const deadlines = [
			deadline("later", "2026-11-20"),
			deadline("old", "2026-10-01"),
			deadline("soon", "2026-11-05", { time: "09:00" }),
			deadline("done", "2026-11-30", { done: true }),
			deadline("soon2", "2026-11-05"),
			deadline("older", "2026-10-10"),
		];
		const sheets: Record<string, CheatSheet | "newer"> = { soon: made, later: { ...newCheatSheet("later", "t"), olderFormat: true }, old: made, older: "newer" };
		const cards = sheetCards(deadlines, (id) => sheets[id] ?? null, (id) => id === "old" || id === "soon2", "2026-11-04");
		assert.deepEqual(
			cards.map((c) => [c.deadlineId, c.past, c.status, c.version?.n ?? null]),
			[
				["soon", false, "made", 2],
				["soon2", false, "making", null],
				["later", false, "older", null],
				["done", true, "none", null],
				["older", true, "newer", null],
				["old", true, "making", 2],
			],
		);
		assert.equal(cards[0]!.time, "09:00");
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

	it("takes the problem and what the learner wrote, else the question and its choices, never the answer", () => {
		assert.deepEqual(sessionAbout({ session: "Counting", problem: { statement: " Seat 5 ", modelSolution: "5!" }, work: " 120 ", question: null }), { kind: "problem", session: "Counting", text: "Seat 5", work: "120" });
		const question = { question: "Which?", options: [{ label: "$n!$", value: "a" }, "two"], correctAnswer: "a", explanation: "x" };
		assert.deepEqual(sessionAbout({ session: "Counting", problem: null, work: undefined, question }), { kind: "question", session: "Counting", text: "Which?\n- $n!$\n- two" });
		assert.equal(sessionAbout({ session: "Counting", problem: null, work: undefined, question: { question: " " } }), null);
	});

	it("remembers whether it is open and which sheet, and keeps a width the session can live beside", () => {
		assert.deepEqual(parseDockState('{"open":true,"deadlineId":"ddl_1"}'), { open: true, deadlineId: "ddl_1" });
		assert.deepEqual(parseDockState("nope"), { open: false });
		assert.deepEqual(parseDockState(null), { open: false });
		assert.equal(dockWidth(900, 1200), 720);
		assert.equal(dockWidth(100, 1200), DOCK_MIN_W);
		assert.equal(dockWidth(500.4, 1600), 500);
	});
});
