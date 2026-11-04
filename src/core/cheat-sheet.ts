/**
 * THE CHEAT SHEET: the notes a class lets the learner bring to a deadline,
 * one per deadline. The agent writes it as a document from the learner's
 * own words: a page size it picks and an HTML body per page (two pages
 * are the front and back), laid out however the request asks. What the
 * learner asked is kept, oldest first. Pure and browser-safe.
 */
import type { TopicStatus } from "./progress.ts";
import { sheetText, type SheetPiece } from "./sheet-text.ts";

// ─── the record ─────────────────────────────────────────────────────────────

export interface CheatSheetDoc {
	/** The page size in inches, as the agent chose it. */
	widthIn: number;
	heightIn: number;
	/** CSS shared by every page. */
	css: string;
	/** Each page's HTML body, in order. */
	pages: string[];
}

/** One thing the learner asked for. */
export interface CheatSheetPrompt {
	text: string;
	at: string;
	/** The names of the pictures and PDFs sent with it. */
	files?: string[];
}

export interface CheatSheet {
	deadlineId: string;
	/** Null until the agent writes the first one. */
	doc: CheatSheetDoc | null;
	/** Oldest first, the last PROMPTS_KEPT. */
	prompts: CheatSheetPrompt[];
	updatedAt: string;
}

/** The record format this build writes (1 was the fixed-option block sheet). */
export const CHEAT_SHEET_VERSION = 2;

/** Smallest and largest page side, in inches. */
export const PAGE_MIN_IN = 2;
export const PAGE_MAX_IN = 17;
export const MAX_PAGES = 4;
/** The whole document (pages and CSS), in characters. */
export const DOC_MAX_CHARS = 200_000;
export const PROMPT_MAX = 2000;
const PROMPTS_KEPT = 20;

export function newCheatSheet(deadlineId: string, now: string): CheatSheet {
	return { deadlineId, doc: null, prompts: [], updatedAt: now };
}

/** Why a written document can't be used, or null. */
export function docProblem(doc: CheatSheetDoc): string | null {
	const side = (v: number) => Number.isFinite(v) && v >= PAGE_MIN_IN && v <= PAGE_MAX_IN;
	if (!side(doc.widthIn) || !side(doc.heightIn)) return `The page size must be between ${PAGE_MIN_IN} and ${PAGE_MAX_IN} inches on each side.`;
	if (doc.pages.length < 1 || doc.pages.length > MAX_PAGES) return `Send 1 to ${MAX_PAGES} pages.`;
	if (doc.pages.some((p) => !p.trim())) return "A page is empty.";
	const size = doc.css.length + doc.pages.reduce((n, p) => n + p.length, 0);
	return size > DOC_MAX_CHARS ? `The sheet is ${size} characters; keep it under ${DOC_MAX_CHARS}.` : null;
}

/** The sheet with one more prompt kept. */
export function withPrompt(sheet: CheatSheet, prompt: CheatSheetPrompt): CheatSheet {
	return { ...sheet, prompts: [...sheet.prompts, prompt].slice(-PROMPTS_KEPT) };
}

// ─── reading a saved record ─────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

function readDoc(v: unknown): CheatSheetDoc | null {
	if (!isObject(v) || typeof v.widthIn !== "number" || typeof v.heightIn !== "number" || !Array.isArray(v.pages)) return null;
	const doc = { widthIn: v.widthIn, heightIn: v.heightIn, css: isString(v.css) ? v.css : "", pages: v.pages.filter(isString) };
	return docProblem(doc) ? null : doc;
}

function readPrompt(v: unknown): CheatSheetPrompt | null {
	if (!isObject(v) || !isString(v.text) || !isString(v.at)) return null;
	const files = Array.isArray(v.files) ? v.files.filter(isString) : [];
	return { text: v.text, at: v.at, ...(files.length > 0 ? { files } : {}) };
}

/** A saved record: null when it isn't one, "newer" when a newer build wrote
 *  it. A version 1 block sheet comes back as a document. */
export function parseCheatSheet(raw: unknown): CheatSheet | "newer" | null {
	if (!isObject(raw) || !isString(raw.deadlineId)) return null;
	if (typeof raw.version === "number" && raw.version > CHEAT_SHEET_VERSION) return "newer";
	const updatedAt = isString(raw.updatedAt) ? raw.updatedAt : new Date(0).toISOString();
	if (raw.version !== CHEAT_SHEET_VERSION) return upgradeBlockSheet(raw, raw.deadlineId, updatedAt);
	return {
		deadlineId: raw.deadlineId,
		doc: readDoc(raw.doc),
		prompts: Array.isArray(raw.prompts) ? raw.prompts.map(readPrompt).filter((p): p is CheatSheetPrompt => p !== null) : [],
		updatedAt,
	};
}

// ─── the version 1 block sheet ──────────────────────────────────────────────

/** Version 1's papers: the size and how many sides. */
const OLD_PAPERS: Record<string, { widthIn: number; heightIn: number; pages: number; marginIn: number }> = {
	letter: { widthIn: 8.5, heightIn: 11, pages: 1, marginIn: 0.4 },
	"letter-both": { widthIn: 8.5, heightIn: 11, pages: 2, marginIn: 0.4 },
	"index-card": { widthIn: 5, heightIn: 3, pages: 1, marginIn: 0.15 },
	a4: { widthIn: 8.27, heightIn: 11.69, pages: 1, marginIn: 0.4 },
};
const OLD_TEXT_PT: Record<string, number> = { small: 7, medium: 8.5, large: 11 };

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function piecesHtml(pieces: readonly SheetPiece[]): string {
	return pieces.map((p) => (p.kind === "math" ? `\\(${escapeHtml(p.tex)}\\)` : p.bold ? `<b>${escapeHtml(p.text)}</b>` : escapeHtml(p.text))).join("");
}

/** A block's markdown lines as HTML, its math left for the page to render. */
function blockHtml(title: string, body: string, boxed: boolean): string {
	const out: string[] = [];
	let list: string[] = [];
	const flush = () => {
		if (list.length > 0) out.push(`<ul>${list.join("")}</ul>`);
		list = [];
	};
	for (const line of sheetText(body)) {
		if (line.kind === "bullet") {
			list.push(`<li>${piecesHtml(line.pieces)}</li>`);
			continue;
		}
		flush();
		if (line.kind === "display") out.push(`<div>\\[${escapeHtml(line.tex)}\\]</div>`);
		else out.push(`<p>${line.kind === "step" ? `${escapeHtml(line.marker ?? "")} ` : ""}${piecesHtml(line.pieces)}</p>`);
	}
	flush();
	return `<section${boxed ? ' class="box"' : ""}><h3>${escapeHtml(title)}</h3>${out.join("")}</section>`;
}

/** Version 1 to a document: its paper's size, one page per side, the
 *  blocks as titled sections in its columns and text size, shared out over
 *  the pages by length. Its instructions become the first prompt. */
function upgradeBlockSheet(raw: Record<string, unknown>, deadlineId: string, updatedAt: string): CheatSheet {
	const rules = isObject(raw.rules) ? raw.rules : {};
	const prefs = isObject(raw.prefs) ? raw.prefs : {};
	const paper = OLD_PAPERS[isString(rules.paper) ? rules.paper : ""] ?? OLD_PAPERS.letter!;
	const blocks = (Array.isArray(raw.blocks) ? raw.blocks : []).filter(
		(b): b is { title: string; body: string; topicId?: unknown } => isObject(b) && isString(b.title) && isString(b.body),
	);
	const instructions = isString(prefs.instructions) ? prefs.instructions.trim() : "";
	const prompts: CheatSheetPrompt[] = instructions ? [{ text: instructions, at: isString(raw.confirmedAt) ? raw.confirmedAt : updatedAt }] : [];
	if (blocks.length === 0) return { deadlineId, doc: null, prompts, updatedAt };

	const total = blocks.reduce((n, b) => n + b.body.length, 0);
	const pages: string[][] = Array.from({ length: paper.pages }, () => []);
	let seen = 0;
	for (const b of blocks) {
		const page = Math.min(paper.pages - 1, Math.floor((seen / Math.max(1, total)) * paper.pages));
		pages[page]!.push(blockHtml(b.title, b.body, b.topicId === "watch_out"));
		seen += b.body.length;
	}
	const pt = OLD_TEXT_PT[isString(prefs.textSize) ? prefs.textSize : ""] ?? OLD_TEXT_PT.medium!;
	const columns = prefs.columns === 3 ? 3 : 2;
	const leading = rules.writing === "by-hand" ? 1.6 : 1.25;
	const css = [
		`body { padding: ${paper.marginIn}in; font: ${pt}pt/${leading} Georgia, serif; }`,
		`.cols { column-count: ${columns}; column-gap: 0.2in; }`,
		"section { break-inside: avoid; margin: 0 0 0.6em; }",
		"section.box { border: 1px solid #000; padding: 0.3em 0.5em; }",
		"h3 { margin: 0; font-size: 1.08em; }",
		"p, ul { margin: 0; }",
		"ul { padding-left: 1.1em; }",
	].join("\n");
	return {
		deadlineId,
		doc: { widthIn: paper.widthIn, heightIn: paper.heightIn, css, pages: pages.map((p) => `<div class="cols">${p.join("")}</div>`) },
		prompts,
		updatedAt,
	};
}

// ─── the page size and the fit ──────────────────────────────────────────────

/** Paper sizes by name, upright; a card reads the same either way. */
const NAMED_SIZES: { name: string; w: number; h: number; card?: true }[] = [
	{ name: "Letter", w: 8.5, h: 11 },
	{ name: "A4", w: 8.27, h: 11.69 },
	{ name: "Legal", w: 8.5, h: 14 },
	{ name: "3 × 5 card", w: 3, h: 5, card: true },
	{ name: "4 × 6 card", w: 4, h: 6, card: true },
	{ name: "5 × 8 card", w: 5, h: 8, card: true },
];

const near = (a: number, b: number) => Math.abs(a - b) < 0.06;

/** "A4, front and back", "Letter sideways, one side", "6 × 9 in, 3 pages". */
export function pageSizeLabel(doc: Pick<CheatSheetDoc, "widthIn" | "heightIn" | "pages">): string {
	const upright = NAMED_SIZES.find((s) => near(s.w, doc.widthIn) && near(s.h, doc.heightIn));
	const turned = NAMED_SIZES.find((s) => near(s.h, doc.widthIn) && near(s.w, doc.heightIn));
	const inches = (v: number) => String(Math.round(v * 100) / 100);
	const size = upright ? upright.name : turned ? (turned.card ? turned.name : `${turned.name} sideways`) : `${inches(doc.widthIn)} × ${inches(doc.heightIn)} in`;
	const n = doc.pages.length;
	return `${size}, ${n === 1 ? "one side" : n === 2 ? "front and back" : `${n} pages`}`;
}

/** The CSS @page size. */
export function pageSizeCss(doc: Pick<CheatSheetDoc, "widthIn" | "heightIn">): string {
	return `${doc.widthIn}in ${doc.heightIn}in`;
}

/** A rendered page's sizes, in CSS pixels. */
interface PageMeasure {
	scrollWidth: number;
	scrollHeight: number;
	clientWidth: number;
	clientHeight: number;
}

/** Something runs off the page (a pixel or two of rounding is not). */
export function runsOver(m: PageMeasure): boolean {
	return m.scrollHeight > m.clientHeight + 2 || m.scrollWidth > m.clientWidth + 2;
}

const pageList = (pages: readonly number[]) => (pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`);

/** "Page 2 runs over", "Pages 1 and 2 run over" (pages counted from 1). */
export function overflowLine(over: readonly number[], pageCount: number): string {
	if (pageCount === 1) return "The page runs over";
	return `${pageList(over)} ${over.length === 1 ? "runs" : "run"} over`;
}

/** What Make it fit asks for. */
export function fitPrompt(over: readonly number[], pageCount: number): string {
	const which = pageCount === 1 ? "The page runs over" : `${pageList(over)} ${over.length === 1 ? "runs" : "run"} over`;
	return `${which}. Make everything fit on its page without making the text too small to read.`;
}

// ─── what the request says ──────────────────────────────────────────────────

interface SheetTopic {
	id: string;
	name: string;
	status: TopicStatus;
	/** Mistakes in this topic (wrong answers, problems that needed hints). */
	mistakes: number;
}

/** One mistake from the learner's lessons. */
export interface SheetMistake {
	topicId: string;
	/** The question or problem, one line. */
	text: string;
	/** "wrong": answered wrong; "hint": solved only with hints. */
	kind: "wrong" | "hint";
	at: string;
}

/** Most mistakes sent to the agent, and their length. */
const MISTAKES_MAX = 6;
const MISTAKE_CHARS = 160;

/**
 * The mistakes in the deadline's topics, newest first, each question
 * once, at most MISTAKES_MAX. Answers name their topics already.
 */
export function sheetMistakes(
	answers: ReadonlyArray<{ text: string; kind: "wrong" | "hint"; at: string; topicIds: readonly string[] }>,
	topicIds: readonly string[],
): SheetMistake[] {
	const wanted = new Set(topicIds);
	const seen = new Set<string>();
	const out: SheetMistake[] = [];
	for (const a of [...answers].sort((x, y) => y.at.localeCompare(x.at))) {
		const topicId = a.topicIds.find((t) => wanted.has(t));
		const line = a.text.replace(/\s+/g, " ").trim();
		if (!topicId || !line || seen.has(line)) continue;
		seen.add(line);
		out.push({ topicId, text: oneLine(line, MISTAKE_CHARS), kind: a.kind, at: a.at });
	}
	return out.slice(0, MISTAKES_MAX);
}

/** Every mistake counted for the first of the deadline's topics it is in
 *  (a question missed twice counts twice). */
export function mistakeCounts(answers: ReadonlyArray<{ topicIds: readonly string[] }>, topicIds: readonly string[]): Map<string, number> {
	const wanted = new Set(topicIds);
	const out = new Map<string, number>();
	for (const a of answers) {
		const topicId = a.topicIds.find((t) => wanted.has(t));
		if (topicId) out.set(topicId, (out.get(topicId) ?? 0) + 1);
	}
	return out;
}

/** A topic as the request lists it, with a few of its facts. */
export interface RequestTopic extends SheetTopic {
	facts: { name: string; statement: string }[];
}

interface CheatSheetRequest {
	/** "CSE 21 Midterm". */
	title: string;
	date: string;
	/** The learner's words about the class (notation, textbook). */
	classNotes: string;
	/** The class's course info files (syllabus, policies). */
	infoFiles: readonly string[];
	/** What the learner asks now. */
	prompt: string;
	/** What they asked before, oldest first. */
	earlier: readonly CheatSheetPrompt[];
	/** The deadline's topics in class order. */
	topics: readonly RequestTopic[];
	mistakes: readonly SheetMistake[];
	/** The sheet to change, or null for a new one. */
	current: CheatSheetDoc | null;
}

const STATUS_WORDS: Record<TopicStatus, string> = { weak: "weak", shaky: "shaky", untested: "not tested yet", strong: "knows it well" };

function oneLine(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** Most info files named in a request: the syllabus first, the rest counted. */
const INFO_FILES_NAMED = 8;

function infoFileList(files: readonly string[]): string {
	const ranked = [...files].sort((a, b) => Number(/syllabus|polic/i.test(b)) - Number(/syllabus|polic/i.test(a)));
	const rest = ranked.length - INFO_FILES_NAMED;
	return `${ranked.slice(0, INFO_FILES_NAMED).join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

/** The request's text: the ask, the exam, the topics with readiness and
 *  facts, the mistakes, and the current sheet when it is a change. */
export function cheatSheetRequestText(r: CheatSheetRequest): string {
	const names = new Map(r.topics.map((t) => [t.id, t.name]));
	const topic = (t: RequestTopic) =>
		[
			`${t.name} | ${STATUS_WORDS[t.status]}${t.mistakes > 0 ? `, ${t.mistakes} ${t.mistakes === 1 ? "mistake" : "mistakes"}` : ""}`,
			...t.facts.map((f) => `  - ${f.name}: ${oneLine(f.statement, 140)}`),
		].join("\n");
	const mistake = (m: SheetMistake) => `- ${m.kind === "hint" ? "needed hints" : "answered wrong"} (${names.get(m.topicId) ?? m.topicId}): "${m.text}"`;
	const current = r.current
		? [
				`The current sheet (send the whole sheet back, changed as asked):`,
				`Page size: ${r.current.widthIn} × ${r.current.heightIn} in`,
				r.current.css.trim() ? `CSS:\n${r.current.css.trim()}` : "",
				...r.current.pages.map((p, i) => `Page ${i + 1}:\n${p.trim()}`),
			]
				.filter(Boolean)
				.join("\n\n")
		: "";
	return [
		[
			`Cheat sheet for: ${r.title} on ${r.date}`,
			r.classNotes ? `About the class: ${oneLine(r.classNotes, 300)}` : "",
			r.infoFiles.length > 0 ? `Course info files (the rules are likely here): ${infoFileList(r.infoFiles)}` : "The class has no course info files; search all its files for the rules.",
		]
			.filter(Boolean)
			.join("\n"),
		`The student asks:\n${r.prompt.trim()}`,
		r.earlier.length > 0 ? `What they asked before, oldest first:\n${r.earlier.map((p) => `- ${oneLine(p.text, 300)}`).join("\n")}` : "",
		r.topics.length > 0 ? `Topics on this exam (name | how the student does), with some of the class's facts:\n${r.topics.map(topic).join("\n")}` : "",
		r.mistakes.length > 0 ? `Mistakes from practice:\n${r.mistakes.map(mistake).join("\n")}` : "",
		current,
	]
		.filter(Boolean)
		.join("\n\n");
}

// ─── what the studio reads ──────────────────────────────────────────────────

/** GET …/cheat-sheet: everything the studio shows. */
export interface CheatSheetView {
	className: string;
	deadlineName: string;
	/** The due day, YYYY-MM-DD. */
	date: string;
	sheet: CheatSheet;
	/** The request the agent is working on: a first sheet or a change. */
	running: { kind: "make" | "change"; prompt: string } | null;
	/** Why the last request failed (Try again sends it again). */
	error: string | null;
	/** A newer godspeed saved it: shown, never changed. */
	newer?: true;
}
