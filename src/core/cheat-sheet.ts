/**
 * THE CHEAT SHEET: the notes a class lets the learner bring to a deadline,
 * one per deadline. The agent makes it as a real PDF with its own tools,
 * from the learner's own words, keeping its source in a working folder so
 * a change edits it. godspeed keeps the last few versions (each with the
 * prompt that made it) and what the learner asked, oldest first. Pure and
 * browser-safe.
 */
import type { TopicStatus } from "./progress.ts";
import { safeEntryName } from "./class-shortcuts.ts";

// ─── the record ─────────────────────────────────────────────────────────────

/** A page's size in PDF points (72 to the inch). */
export interface SheetPage {
	widthPt: number;
	heightPt: number;
}

/** One PDF the agent sent, saved as v<n>.pdf. */
export interface SheetVersion {
	/** Counts up from 1 and is never reused. */
	n: number;
	/** What the learner asked for it ("" when they only sent files). */
	prompt: string;
	at: string;
	pages: SheetPage[];
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
	/** Oldest first, the last VERSIONS_KEPT. */
	versions: SheetVersion[];
	/** Oldest first, the last PROMPTS_KEPT. */
	prompts: CheatSheetPrompt[];
	/** The working folder's name under the godspeed folder's cheat-sheets/,
	 *  picked at the first request so a renamed deadline keeps its source. */
	folder?: string;
	/** An older godspeed made a sheet here that this one can't show. */
	olderFormat?: true;
	updatedAt: string;
}

/** The record format this build writes, stamped as "version" (2 was the
 *  HTML sheet, 1 the fixed-option block sheet). */
export const CHEAT_SHEET_FORMAT = 3;

/** Smallest and largest page side, in inches. */
const PAGE_MIN_IN = 2;
const PAGE_MAX_IN = 17;
export const MAX_PAGES = 4;
const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PROMPT_MAX = 2000;
const PROMPTS_KEPT = 20;
/** Versions kept on the canvas: enough to compare, few enough to stay light. */
const VERSIONS_KEPT = 5;

export function newCheatSheet(deadlineId: string, now: string): CheatSheet {
	return { deadlineId, versions: [], prompts: [], updatedAt: now };
}

/** The sheet with one more prompt kept. */
export function withPrompt(sheet: CheatSheet, prompt: CheatSheetPrompt): CheatSheet {
	return { ...sheet, prompts: [...sheet.prompts, prompt].slice(-PROMPTS_KEPT) };
}

/** The newest version, or null before the first. */
export function currentVersion(sheet: Pick<CheatSheet, "versions">): SheetVersion | null {
	return sheet.versions[sheet.versions.length - 1] ?? null;
}

/** The sheet with a new version as its newest, and the numbers of the
 *  versions that no longer fit (their files go). */
export function withVersion(sheet: CheatSheet, v: Omit<SheetVersion, "n">): { sheet: CheatSheet; dropped: number[] } {
	const n = (currentVersion(sheet)?.n ?? 0) + 1;
	const all = [...sheet.versions, { ...v, n }];
	const { olderFormat: _gone, ...rest } = sheet;
	return {
		sheet: { ...rest, versions: all.slice(-VERSIONS_KEPT), updatedAt: v.at },
		dropped: all.slice(0, -VERSIONS_KEPT).map((x) => x.n),
	};
}

/** Why a PDF the agent sent can't be the sheet, or null. Checks what it
 *  is given: the size alone before the file is read, then the rest. */
export function pdfProblem(pdf: { bytes: number; head?: string; pages?: readonly SheetPage[] }): string | null {
	if (pdf.bytes > PDF_MAX_BYTES) return `The PDF is ${Math.ceil(pdf.bytes / 1024 / 1024)} MB; keep it under ${PDF_MAX_BYTES / 1024 / 1024} MB.`;
	if (pdf.head !== undefined && !pdf.head.startsWith("%PDF-")) return "That file is not a PDF.";
	if (!pdf.pages) return null;
	if (pdf.pages.length < 1 || pdf.pages.length > MAX_PAGES) return `The PDF has ${pdf.pages.length} pages; a cheat sheet has 1 to ${MAX_PAGES}.`;
	const side = (pt: number) => Number.isFinite(pt) && pt >= PAGE_MIN_IN * 72 && pt <= PAGE_MAX_IN * 72;
	return pdf.pages.every((p) => side(p.widthPt) && side(p.heightPt)) ? null : `Each page must be between ${PAGE_MIN_IN} and ${PAGE_MAX_IN} inches on each side.`;
}

/** The working folder's name: "CSE 21 Midterm", safe on every OS. */
export function sheetFolderName(className: string, deadlineName: string): string {
	return safeEntryName(`${className} ${deadlineName}`);
}

// ─── reading a saved record ─────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function readPrompt(v: unknown): CheatSheetPrompt | null {
	if (!isObject(v) || !isString(v.text) || !isString(v.at)) return null;
	const files = Array.isArray(v.files) ? v.files.filter(isString) : [];
	return { text: v.text, at: v.at, ...(files.length > 0 ? { files } : {}) };
}

function readVersion(v: unknown): SheetVersion | null {
	if (!isObject(v) || !isNumber(v.n) || !isString(v.prompt) || !isString(v.at) || !Array.isArray(v.pages)) return null;
	const pages = v.pages.filter((p): p is SheetPage => isObject(p) && isNumber(p.widthPt) && isNumber(p.heightPt)).map((p) => ({ widthPt: p.widthPt, heightPt: p.heightPt }));
	return pages.length > 0 ? { n: v.n, prompt: v.prompt, at: v.at, pages } : null;
}

const list = <T>(v: unknown, read: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : []);

/** Version 1's instructions, kept as its first prompt. */
function blockSheetPrompts(raw: Record<string, unknown>, updatedAt: string): CheatSheetPrompt[] {
	const prefs = isObject(raw.prefs) ? raw.prefs : {};
	const text = isString(prefs.instructions) ? prefs.instructions.trim() : "";
	return text ? [{ text, at: isString(raw.confirmedAt) ? raw.confirmedAt : updatedAt }] : [];
}

/**
 * A saved record: null when it isn't one, "newer" when a newer build wrote
 * it. An HTML sheet (version 2) or block sheet (version 1) can't become a
 * PDF without the agent: its prompts stay and it is marked olderFormat
 * when it had a sheet.
 */
export function parseCheatSheet(raw: unknown): CheatSheet | "newer" | null {
	if (!isObject(raw) || !isString(raw.deadlineId)) return null;
	if (isNumber(raw.version) && raw.version > CHEAT_SHEET_FORMAT) return "newer";
	const updatedAt = isString(raw.updatedAt) ? raw.updatedAt : new Date(0).toISOString();
	const deadlineId = raw.deadlineId;
	if (raw.version === 2) return { deadlineId, versions: [], prompts: list(raw.prompts, readPrompt), ...(raw.doc ? { olderFormat: true as const } : {}), updatedAt };
	if (raw.version !== CHEAT_SHEET_FORMAT) {
		const made = Array.isArray(raw.blocks) && raw.blocks.length > 0;
		return { deadlineId, versions: [], prompts: blockSheetPrompts(raw, updatedAt), ...(made ? { olderFormat: true as const } : {}), updatedAt };
	}
	return {
		deadlineId,
		versions: list(raw.versions, readVersion),
		prompts: list(raw.prompts, readPrompt),
		...(isString(raw.folder) && raw.folder ? { folder: raw.folder } : {}),
		...(raw.olderFormat === true ? { olderFormat: true as const } : {}),
		updatedAt,
	};
}

// ─── the page size ──────────────────────────────────────────────────────────

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

/** "A4, front and back", "Letter sideways, one side", "6 × 9 in, 3 pages"
 *  (named by the first page). */
export function pageSizeLabel(pages: readonly SheetPage[]): string {
	const first = pages[0];
	if (!first) return "";
	const w = first.widthPt / 72;
	const h = first.heightPt / 72;
	const upright = NAMED_SIZES.find((s) => near(s.w, w) && near(s.h, h));
	const turned = NAMED_SIZES.find((s) => near(s.h, w) && near(s.w, h));
	const inches = (v: number) => String(Math.round(v * 100) / 100);
	const size = upright ? upright.name : turned ? (turned.card ? turned.name : `${turned.name} sideways`) : `${inches(w)} × ${inches(h)} in`;
	const n = pages.length;
	return `${size}, ${n === 1 ? "one side" : n === 2 ? "front and back" : `${n} pages`}`;
}

/** The label above a page: "Front" and "Back" for two, else its number. */
export function pageCaption(index: number, pages: number): string {
	return pages === 2 ? (index === 0 ? "Front" : "Back") : `Page ${index + 1}`;
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
	/** The working folder's absolute path, and what is in it now. */
	folder: { path: string; files: readonly string[] };
	/** The sheet to change, or null for a new one. */
	current: SheetVersion | null;
}

const STATUS_WORDS: Record<TopicStatus, string> = { weak: "weak", shaky: "shaky", untested: "not tested yet", strong: "knows it well" };

function oneLine(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** Most info files named in a request: the syllabus first, the rest counted. */
const INFO_FILES_NAMED = 8;
/** Most working folder files named in a request. */
const FOLDER_FILES_NAMED = 12;

function namedList(names: readonly string[], max: number): string {
	const rest = names.length - max;
	return `${names.slice(0, max).join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

function infoFileList(files: readonly string[]): string {
	return namedList([...files].sort((a, b) => Number(/syllabus|polic/i.test(b)) - Number(/syllabus|polic/i.test(a))), INFO_FILES_NAMED);
}

function folderText(r: CheatSheetRequest): string {
	const files = r.folder.files.length > 0 ? `It has: ${namedList(r.folder.files, FOLDER_FILES_NAMED)}.` : "It is empty.";
	if (!r.current) return `Working folder: ${r.folder.path}\n${files} Keep the sheet's source here so later changes can edit it.`;
	return [
		`Working folder: ${r.folder.path}`,
		`${files} The current sheet is the last PDF you made here (${pageSizeLabel(r.current.pages)}). Change its source as asked and send the new PDF; keep the rest as it is.`,
	].join("\n");
}

/** The request's text: the ask, the exam, the topics with readiness and
 *  facts, the mistakes, and the working folder. */
export function cheatSheetRequestText(r: CheatSheetRequest): string {
	const names = new Map(r.topics.map((t) => [t.id, t.name]));
	const topic = (t: RequestTopic) =>
		[
			`${t.name} | ${STATUS_WORDS[t.status]}${t.mistakes > 0 ? `, ${t.mistakes} ${t.mistakes === 1 ? "mistake" : "mistakes"}` : ""}`,
			...t.facts.map((f) => `  - ${f.name}: ${oneLine(f.statement, 140)}`),
		].join("\n");
	const mistake = (m: SheetMistake) => `- ${m.kind === "hint" ? "needed hints" : "answered wrong"} (${names.get(m.topicId) ?? m.topicId}): "${m.text}"`;
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
		folderText(r),
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
