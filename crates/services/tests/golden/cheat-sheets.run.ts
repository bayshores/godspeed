// Runs the cheat-sheet server code (cheat-sheets.ts, cheat-sheet-pdf.ts) over a fresh data folder
// and home folder with a synthetic space, and prints what the folders held before, each step and
// what it answered. cheat-sheets.golden.ts starts it in its own process with LH_DATA_DIR and HOME
// set, because the stores fix their folders when they load. Times the TypeScript clock made, and
// ids it made, are masked ("<now>", "<id>"): the Rust clock is not fixed.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

if (!process.env.LH_DATA_DIR || !process.env.HOME) throw new Error("LH_DATA_DIR and HOME must be set");
// Both the resolved and the given folder are masked, since the code reports either.
const RAW_DATA = process.env.LH_DATA_DIR;
const RAW_HOME = process.env.HOME;
const DATA = fs.realpathSync(RAW_DATA);
const HOME = fs.realpathSync(RAW_HOME);
const NOW = Date.UTC(2030, 0, 1, 12);
const RealDate = Date;
class FakeDate extends RealDate {
	constructor(...args: [] | [string | number | Date]) {
		super(...((args.length === 0 ? [NOW] : args) as [number]));
	}
	static override now(): number {
		return NOW;
	}
}
globalThis.Date = FakeDate as DateConstructor;
console.error = () => {};
console.warn = () => {};

const CLS = "cls_golden01_00000001";
const MID = "ddl_gold00000001";
const QUIZ = "ddl_gold00000002";
const NEWER = "ddl_gold00000003";
const OLD = "ddl_gold00000004";
const BAD = "ddl_gold00000005";
const OWN = "ddl_gold00000006";
const AT = (n: number) => `2029-03-0${n}T10:00:00.000Z`;
const tabs = (v: unknown) => `${JSON.stringify(v, null, "\t")}\n`;

/** A small PDF with the given page sizes (points). */
function tinyPdf(pages: [number, number][]): Buffer {
	const objs: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`];
	pages.forEach(([w, h], i) => {
		objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${4 + i * 2} 0 R /Resources << >> >>`);
		const body = `0.8 g 10 10 ${Math.max(w - 20, 1)} ${Math.max(h - 20, 1)} re f`;
		objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
	});
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objs.forEach((o, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(out, "latin1");
}

const spaceDir = path.join(DATA, "spaces", CLS);
const deadline = (id: string, name: string, date: string) => ({ id, kind: "exam", name, date, fileIds: [], done: false });
fs.mkdirSync(path.join(spaceDir, "cheat-sheets"), { recursive: true });
fs.writeFileSync(
	path.join(spaceDir, "space.json"),
	tabs({
		id: CLS,
		name: "Golden Space",
		description: "Notes about the space.",
		createdAt: AT(1),
		updatedAt: AT(1),
		archived: false,
		files: [
			{ id: "f_info00000001", origin: "copied", name: "syllabus.txt", path: "f_info00000001/syllabus.txt", kind: "info", contentFp: "aaaaaaaaaaaaaaaa", status: "ready", addedAt: AT(1), statSig: "1:1" },
			{ id: "f_study0000001", origin: "copied", name: "week 1.txt", path: "f_study0000001/week 1.txt", kind: "study", contentFp: "bbbbbbbbbbbbbbbb", status: "ready", addedAt: AT(1), statSig: "1:2" },
		],
		removedFiles: [],
		deadlines: [
			deadline(MID, "Midterm", "2030-02-01"),
			deadline(QUIZ, "Quiz 1", "2030-02-10"),
			deadline(NEWER, "Final", "2030-03-01"),
			deadline(OLD, "Lab 4", "2030-02-05"),
			deadline(BAD, "Project", "2030-02-20"),
			deadline(OWN, "Essay", "2030-02-25"),
		],
		version: 1,
	}),
);

const sheets = path.join(spaceDir, "cheat-sheets");
const page = { widthPt: 612, heightPt: 792 };
const folderOf = path.join(HOME, "godspeed", "cheat-sheets", "Golden Space Midterm");
const store = await import("../../../../src/backend/store/cheat-sheets.ts");
const core = await import("../../../../src/shared/core/cheat-sheet.ts");
const server = await import("../../../../src/backend/server/cheat-sheets.ts");
const { takeSheetPdf } = await import("../../../../src/backend/server/cheat-sheet-pdf.ts");

// The Midterm sheet: two versions, a chat, rules, a working folder.
const v1 = tinyPdf([[612, 792]]);
const v2 = tinyPdf([[612, 792], [612, 792]]);
fs.mkdirSync(folderOf, { recursive: true });
fs.writeFileSync(path.join(folderOf, "sheet.pdf"), v2);
const t1 = core.withVersion({ ...core.newCheatSheet(MID, AT(1)), folder: "Golden Space Midterm" }, { prompt: "first ask", at: AT(1), pages: [page] });
const t2 = core.withVersion(t1.sheet, { prompt: "bigger fonts", at: AT(2), pages: [page, page], file: path.join(folderOf, "sheet.pdf") });
let mid = core.withMessage(t2.sheet, { id: "m1", role: "you", text: "first ask", at: AT(1), files: [{ name: "pic.png", file: "aaaa11112222-pic.png" }] });
mid = core.withMessage(mid, { id: "m2", role: "agent", text: "Made it.", at: AT(1), version: 1, rules: ["no slang"] });
mid = core.withRules(mid, ["no slang", "A4, both sides"], AT(1)).sheet;
store.saveSheetPdf(CLS, MID, 1, v1);
store.saveSheetPdf(CLS, MID, 2, v2);
store.writeCheatSheet(CLS, { ...mid, updatedAt: AT(2) });
store.saveCheatSheetFile(CLS, MID, "aaaa11112222-pic.png", Buffer.from("not really a png"));
store.saveCheatSheetFile(CLS, MID, "bbbb33334444-notes.pdf", v1);
store.saveCheatSheetFile(CLS, MID, "cccc55556666-shot.jpg", Buffer.from("not really a jpeg"));
store.saveCheatSheetFile(CLS, MID, "dddd77778888-data.bin", Buffer.from([0, 1, 2, 3]));
store.saveCheatSheetFile(CLS, MID, "eeee9999aaaa-UPPER.PDF", v1);

// A sheet a newer build wrote, an older format, one that is not JSON, and one with its own file.
fs.writeFileSync(path.join(sheets, `${NEWER}.json`), tabs({ version: 5, deadlineId: NEWER, versions: [], messages: [], rules: [], updatedAt: AT(3) }));
fs.writeFileSync(path.join(sheets, `${OLD}.json`), tabs({ version: 2, deadlineId: OLD, prompts: [{ text: "make it bigger", at: AT(2), files: ["old.png"] }], doc: { html: "<p>x</p>" }, updatedAt: AT(2) }));
fs.writeFileSync(path.join(sheets, `${BAD}.json`), "{ this is not json");
const own = core.withVersion({ ...core.newCheatSheet(OWN, AT(1)), folder: "Golden Space Essay" }, { prompt: "essay", at: AT(1), pages: [page], file: path.join(HOME, "godspeed", "cheat-sheets", "Golden Space Essay", "made.pdf") });
store.saveSheetPdf(CLS, OWN, 1, v1);
store.writeCheatSheet(CLS, { ...own.sheet, updatedAt: AT(1) });
fs.mkdirSync(path.join(HOME, "godspeed", "cheat-sheets", "Golden Space Essay"), { recursive: true });
fs.writeFileSync(path.join(HOME, "godspeed", "cheat-sheets", "Golden Space Essay", "made.pdf"), v1);

/** Every file under a folder: [relative path, base64]. The home folder in a saved sheet is written as "<home>". */
function walk(root: string, dir = root): [string, string][] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) return walk(root, full);
		if (!e.isFile()) return [];
		const bytes = e.name.endsWith(".json") ? Buffer.from(fs.readFileSync(full, "utf8").replaceAll(HOME, "<home>")) : fs.readFileSync(full);
		return [[path.relative(root, full), bytes.toString("base64")] as [string, string]];
	});
}
const before = { data: walk(DATA), home: walk(HOME) };

const isoNow = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Masks what differs by run: times not from the fixtures, generated ids, the temp folders. */
function mask(v: unknown): unknown {
	if (typeof v === "string") {
		if (isoNow.test(v) && !v.startsWith("2029-")) return "<now>";
		if (uuid.test(v)) return "<id>";
		return v.replaceAll(DATA, "<data>").replaceAll(HOME, "<home>").replaceAll(RAW_DATA, "<data>").replaceAll(RAW_HOME, "<home>");
	}
	if (Array.isArray(v)) return v.map(mask);
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mask(x)]));
	return v;
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sheetFile = (ddl: string) => {
	try {
		return JSON.parse(fs.readFileSync(path.join(sheets, `${ddl}.json`), "utf8"));
	} catch {
		return null;
	}
};

type Step = { op: string; [key: string]: unknown };
const steps: Step[] = [];
const run = async (step: Step, act: () => unknown) => {
	let out: unknown;
	try {
		out = await act();
	} catch (err) {
		out = { threw: err instanceof Error ? err.message : String(err) };
	}
	steps.push({ ...step, out: mask(out ?? null) });
};
const view = (ddl: string, cls = CLS) => run({ op: "view", cls, ddl }, () => server.cheatSheetView(cls, ddl));
const ask = (ddl: string, body: Record<string, unknown>, cls = CLS) => run({ op: "ask", cls, ddl, body }, () => server.askCheatSheet(cls, ddl, body as never));
const put = (rel: string, base64: string, mtime: string) =>
	run({ op: "put", path: rel, base64, mtime }, () => {
		const file = path.join(HOME, "godspeed", "cheat-sheets", rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, Buffer.from(base64, "base64"));
		fs.utimesSync(file, new RealDate(mtime), new RealDate(mtime));
		return null;
	});
const take = (folder: string, pdfPath: string) =>
	run({ op: "take", folder, pdfPath }, async () => {
		const got = await takeSheetPdf(path.join(HOME, "godspeed", "cheat-sheets", folder), pdfPath.replace("<home>", HOME));
		return typeof got === "string" ? { error: got } : { pages: got.pages, file: got.file, size: got.bytes.length, sha256: hash(got.bytes) };
	});
const pdf = (b: Uint8Array) => Buffer.from(b).toString("base64");
const OLD_DAY = "2025-01-01T00:00:00.000Z";
const NEW_DAY = "2031-01-01T00:00:00.000Z";
const later = (n: number) => `2031-01-0${n}T00:00:00.000Z`;

// The space page and every view, each sheet state.
await run({ op: "space", cls: CLS }, () => server.spaceSheetsView(CLS));
await run({ op: "space", cls: "cls_nothere_00000000" }, () => server.spaceSheetsView("cls_nothere_00000000"));
for (const ddl of [MID, QUIZ, NEWER, OLD, BAD, OWN, "ddl_000000000000"]) await view(ddl);

// Reads: a version's PDF, a kept file.
for (const [ddl, n] of [[MID, 1], [MID, 2], [MID, 3], [QUIZ, 1], ["ddl_000000000000", 1]] as const) {
	await run({ op: "pdf", cls: CLS, ddl, n }, () => {
		const got = server.cheatSheetPdf(CLS, ddl, n);
		return got && { size: got.length, sha256: hash(got) };
	});
}
for (const file of ["aaaa11112222-pic.png", "bbbb33334444-notes.pdf", "cccc55556666-shot.jpg", "dddd77778888-data.bin", "eeee9999aaaa-UPPER.PDF", "ffff00000000-gone.png", ".hidden.png"]) {
	await run({ op: "kept", cls: CLS, ddl: MID, file }, () => {
		const got = server.cheatSheetFile(CLS, MID, file);
		return got && { type: got.type, size: got.bytes.length, sha256: hash(got.bytes) };
	});
}
await run({ op: "kept", cls: CLS, ddl: QUIZ, file: "aaaa11112222-pic.png" }, () => server.cheatSheetFile(CLS, QUIZ, "aaaa11112222-pic.png"));

// Asks that are refused before anything is kept.
await ask(MID, { text: "" });
await ask(MID, { text: "   \n\t " });
await ask(MID, { text: "x".repeat(2001) });
await ask(MID, { text: "hi", attachments: [{ name: "a.txt", mimeType: "text/plain", data: "AAAA" }] });
await ask(MID, { text: "hi", attachments: [{ name: "a.heic", mimeType: "image/heic", data: "AAAA" }] });
await ask(MID, { text: "", attachments: [{ name: "a.txt", mimeType: "text/plain", data: "AAAA" }] });
await ask("ddl_000000000000", { text: "hi" });
await ask(MID, { text: "hi" }, "cls_nothere_00000000");
await ask(NEWER, { text: "hi" });
await ask(NEWER, { text: "hi", region: { n: 1, page: 1, x: 0, y: 0, w: 1, h: 1 } });
await ask(MID, { text: "hi", region: { n: 99, page: 1, x: 0, y: 0, w: 1, h: 1 } });
await ask(MID, { text: "hi", region: { n: 2, page: 3, x: 0, y: 0, w: 1, h: 1 } });
await ask(MID, { text: "hi", region: { n: 2, page: 1.5, x: 0, y: 0, w: 1, h: 1 } });
await ask(MID, { text: "hi", region: { n: 2, page: 1, x: 0.5, y: 0, w: 0.6, h: 1 } });
await ask(MID, { text: "hi", region: { n: 2, page: 1, x: 0.5, y: 0.5, w: 0, h: 0.2 } });
await ask(MID, { text: "hi", region: { n: 2, page: 1, x: -0.1, y: 0, w: 0.5, h: 0.5 } });
await view(MID);

// Retry and stop with nothing going.
await run({ op: "retry", cls: CLS, ddl: MID }, () => server.retryCheatSheet(CLS, MID));
await run({ op: "retry", cls: CLS, ddl: "ddl_000000000000" }, () => server.retryCheatSheet(CLS, "ddl_000000000000"));
await run({ op: "stop", ddl: MID }, () => server.stopCheatSheet(MID));

// Rules.
const rule = (ddl: string, text: string, cls = CLS) => run({ op: "removeRule", cls, ddl, text }, () => server.removeSheetRule(cls, ddl, text));
await rule(MID, "no such rule");
await rule(MID, "  A4, BOTH sides ");
await view(MID);
await rule(MID, "no slang");
await view(MID);
await rule(MID, "");
await rule(QUIZ, "x");
await rule(OLD, "x");
await rule(NEWER, "x");
await rule("ddl_000000000000", "x");
await rule(MID, "x", "cls_nothere_00000000");
await run({ op: "sheet", ddl: MID }, () => sheetFile(MID));

// Show in Finder.
const file = (ddl: string, n: number) => run({ op: "file", cls: CLS, ddl, n }, () => server.sheetPdfFile(CLS, ddl, n));
await file(MID, 99);
await file(MID, 2);
await file(MID, 1);
await file(MID, 1);
await file(OWN, 1);
await file(QUIZ, 1);
await file(NEWER, 1);
await file(OLD, 1);
await file(BAD, 1);
await file(MID, 3.5);
await run({ op: "ls", dir: "Golden Space Midterm" }, () => fs.readdirSync(folderOf).sort());
await put("Golden Space Midterm/cheat sheet v1.pdf", pdf(tinyPdf([[300, 300]])), NEW_DAY);
await file(MID, 1);
await run({ op: "ls", dir: "Golden Space Midterm" }, () => fs.readdirSync(folderOf).sort());

// A newer PDF in the working folder comes in as a new version, each file looked at once.
await put("Golden Space Midterm/old.pdf", pdf(tinyPdf([[612, 792]])), OLD_DAY);
await view(MID);
await put("Golden Space Midterm/notes.pdf", Buffer.from("%PDF-1.4 junk that is no document\n").toString("base64"), later(1));
await view(MID);
await view(MID);
await put("Golden Space Midterm/five.pdf", pdf(tinyPdf(Array(5).fill([612, 792]))), later(2));
await view(MID);
await put("Golden Space Midterm/big.pdf", pdf(tinyPdf([[2000, 2000]])), later(3));
await view(MID);
await put("Golden Space Midterm/small.pdf", pdf(tinyPdf([[100, 100]])), later(4));
await view(MID);
await put("Golden Space Midterm/fake.pdf", Buffer.from("just text\n").toString("base64"), later(5));
await view(MID);
await put("Golden Space Midterm/same.pdf", pdf(v2), later(6));
await view(MID);
await put("Golden Space Midterm/new1.pdf", pdf(v1), later(7));
await view(MID);
await put("Golden Space Midterm/new2.pdf", pdf(tinyPdf([[612, 792]])), later(8));
await view(MID);
await put("Golden Space Midterm/new3.pdf", pdf(tinyPdf([[600, 800]])), later(9));
await view(MID);
await put("Golden Space Midterm/.hidden.pdf", pdf(tinyPdf([[500, 700]])), NEW_DAY.replace("2031-01-01", "2031-02-01"));
await view(MID);
await view(MID);
await run({ op: "sheet", ddl: MID }, () => sheetFile(MID));
await run({ op: "versions", ddl: MID }, () => fs.readdirSync(path.join(sheets, `${MID}-versions`)).sort());
await run({ op: "pdf", cls: CLS, ddl: MID, n: 4 }, () => {
	const got = server.cheatSheetPdf(CLS, MID, 4);
	return got && { size: got.length, sha256: hash(got) };
});

// Taking the PDF an agent made.
await put("Take/ok.pdf", pdf(tinyPdf([[612, 792], [300, 400]])), OLD_DAY);
await put("Take/sub/inner.pdf", pdf(tinyPdf([[612, 792]])), OLD_DAY);
await put("Take/five.pdf", pdf(tinyPdf(Array(5).fill([612, 792]))), OLD_DAY);
await put("Take/huge.pdf", pdf(tinyPdf([[2000, 2000]])), OLD_DAY);
await put("Take/tiny.pdf", pdf(tinyPdf([[100, 100]])), OLD_DAY);
await put("Take/words.txt", Buffer.from("just words\n").toString("base64"), OLD_DAY);
await put("Take/junk.pdf", Buffer.from("%PDF-1.4 junk that is no document\n").toString("base64"), OLD_DAY);
await put("Take/dir/inside.txt", Buffer.from("x").toString("base64"), OLD_DAY);
await run({ op: "link", path: "Take/link.pdf", outside: "outside.pdf", base64: pdf(tinyPdf([[612, 792]])) }, () => {
	fs.writeFileSync(path.join(HOME, "outside.pdf"), tinyPdf([[612, 792]]));
	fs.symlinkSync(path.join(HOME, "outside.pdf"), path.join(HOME, "godspeed", "cheat-sheets", "Take", "link.pdf"));
	return null;
});
for (const p of ["ok.pdf", "sub/inner.pdf", "./ok.pdf", "five.pdf", "huge.pdf", "tiny.pdf", "words.txt", "junk.pdf", "dir", "missing.pdf", "link.pdf", "../Golden Space Midterm/sheet.pdf", "<home>/outside.pdf", "<home>/godspeed/cheat-sheets/Take/ok.pdf"]) await take("Take", p);

process.stdout.write(JSON.stringify({ before, steps }));
process.exit(0);
