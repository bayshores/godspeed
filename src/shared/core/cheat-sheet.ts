/**
 * THE CHEAT SHEET: the notes a class lets the learner bring to a deadline,
 * one per deadline. The agent makes it as a real PDF with its own tools,
 * keeping its source in a working folder so a change edits it. The sheet
 * has a chat: each message from the learner is one request, which the
 * agent answers, and may answer by changing the sheet too. godspeed keeps
 * the last few versions, the chat and the sheet's rules (what should
 * always hold for it). Pure and browser-safe.
 */
import type { ClassDeadline, DeadlineKind } from "./contracts.ts";
import type { TopicStatus } from "./progress.ts";
import { safeEntryName } from "./class-shortcuts.ts";
import { RULE_MAX_CHARS, RULES_MAX, oneLine as cleanLine } from "./teaching-areas.ts";

// ─── the record ─────────────────────────────────────────────────────────────

/** A page's size in PDF points (72 to the inch). */
export interface SheetPage {
	widthPt: number;
	heightPt: number;
}

/** One PDF of the sheet, saved as v<n>.pdf. */
export interface SheetVersion {
	/** Counts up from 1 and is never reused. */
	n: number;
	/** The message it was made for ("" when there were only files). */
	prompt: string;
	at: string;
	pages: SheetPage[];
	/** Where it was made, for Show in Finder. */
	file?: string;
	/** Found newer in the working folder: made outside godspeed. */
	fromFolder?: true;
}

/** A picture or PDF sent with a message. */
export interface SheetFile {
	name: string;
	/** Its saved copy beside the sheet; absent on asks older godspeeds kept. */
	file?: string;
}

/** A box the learner drew on a page: fractions of the page's width and
 *  height from its top left corner. */
export interface SheetRegion {
	/** The version, and its page from 1. */
	n: number;
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The problem or question the learner is on in a session, sent along
 *  from the sheet beside it. */
export interface SheetAbout {
	kind: "problem" | "question";
	/** The session's title. */
	session: string;
	text: string;
	/** What they have written for it so far. */
	work?: string;
}

/** One message in the sheet's chat. */
export type SheetMessage =
	| { id: string; role: "you"; text: string; at: string; files?: SheetFile[]; region?: SheetRegion; about?: SheetAbout }
	| {
			id: string;
			role: "agent";
			text: string;
			at: string;
			/** The version this reply made. */
			version?: number;
			/** Rules this reply saved. */
			rules?: string[];
	  };

export type YouMessage = Extract<SheetMessage, { role: "you" }>;

/** Something that should always hold for this sheet ("A4, both sides"). */
export interface SheetRule {
	text: string;
	at: string;
}

export interface CheatSheet {
	deadlineId: string;
	/** Oldest first, the last VERSIONS_KEPT. */
	versions: SheetVersion[];
	/** The chat, oldest first, the last MESSAGES_KEPT. */
	messages: SheetMessage[];
	rules: SheetRule[];
	/** The working folder's name under the godspeed folder's cheat-sheets/,
	 *  picked at the first request so a renamed deadline keeps its source. */
	folder?: string;
	/** An older godspeed made a sheet here that this one can't show. */
	olderFormat?: true;
	updatedAt: string;
}

/** The record format this build writes, stamped as "version" (3 kept the
 *  learner's asks without replies, 2 was the HTML sheet, 1 the
 *  fixed-option block sheet). */
export const CHEAT_SHEET_FORMAT = 4;

/** Smallest and largest page side, in inches. */
const PAGE_MIN_IN = 2;
const PAGE_MAX_IN = 17;
export const MAX_PAGES = 4;
const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PROMPT_MAX = 2000;
const MESSAGES_KEPT = 100;
/** Versions kept on the canvas: enough to compare, few enough to stay light. */
const VERSIONS_KEPT = 5;

export function newCheatSheet(deadlineId: string, now: string): CheatSheet {
	return { deadlineId, versions: [], messages: [], rules: [], updatedAt: now };
}

/** The sheet with one more message in its chat. */
export function withMessage(sheet: CheatSheet, message: SheetMessage): CheatSheet {
	return { ...sheet, messages: [...sheet.messages, message].slice(-MESSAGES_KEPT) };
}

/** The sheet with new rules kept (cleaned, each once, at most RULES_MAX),
 *  and the ones that were new. */
export function withRules(sheet: CheatSheet, texts: readonly string[], at: string): { sheet: CheatSheet; added: string[] } {
	const have = new Set(sheet.rules.map((r) => r.text.toLowerCase()));
	const added: string[] = [];
	for (const raw of texts) {
		const text = cleanLine(raw, RULE_MAX_CHARS);
		if (!text || have.has(text.toLowerCase()) || sheet.rules.length + added.length >= RULES_MAX) continue;
		have.add(text.toLowerCase());
		added.push(text);
	}
	return { sheet: added.length > 0 ? { ...sheet, rules: [...sheet.rules, ...added.map((text) => ({ text, at }))] } : sheet, added };
}

export function withoutRule(sheet: CheatSheet, text: string): CheatSheet {
	return { ...sheet, rules: sheet.rules.filter((r) => r.text !== text) };
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

/** The copies Show in Finder writes into the working folder. */
const SHOWN_COPY = /^cheat sheet v\d+\.pdf$/i;

/** The PDF in the working folder that is newer than the current version
 *  (the learner changed the sheet outside godspeed), or null: the newest
 *  PDF there, when it was written after the current version was kept. */
export function newerFolderPdf(files: ReadonlyArray<{ name: string; mtimeMs: number }>, current: Pick<SheetVersion, "at"> | null): string | null {
	const newest = files.filter((f) => /\.pdf$/i.test(f.name) && !SHOWN_COPY.test(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
	if (!newest) return null;
	return !current || newest.mtimeMs > Date.parse(current.at) ? newest.name : null;
}

// ─── pointing at the sheet ──────────────────────────────────────────────────

/** Why a box isn't on a kept version's page, or null. */
export function regionProblem(r: SheetRegion, versions: readonly SheetVersion[]): string | null {
	const v = versions.find((x) => x.n === r.n);
	if (!v || !Number.isInteger(r.page) || r.page < 1 || r.page > v.pages.length) return "That version of the sheet is gone. Point at it again.";
	const fractions = [r.x, r.y, r.w, r.h].every((k) => Number.isFinite(k) && k >= 0 && k <= 1);
	return fractions && r.w > 0 && r.h > 0 && r.x + r.w <= 1.001 && r.y + r.h <= 1.001 ? null : "That box isn't on the page.";
}

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** "page 1 (the front), from 10% to 40% across and 20% to 35% down". */
export function regionText(r: SheetRegion, pages: number): string {
	const side = pages === 2 ? ` (the ${r.page === 1 ? "front" : "back"})` : "";
	return `page ${r.page}${side}, from ${pct(r.x)} to ${pct(r.x + r.w)} across and ${pct(r.y)} to ${pct(r.y + r.h)} down`;
}

// ─── reading a saved record ─────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const list = <T>(v: unknown, read: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : []);

function readVersion(v: unknown): SheetVersion | null {
	if (!isObject(v) || !isNumber(v.n) || !isString(v.prompt) || !isString(v.at) || !Array.isArray(v.pages)) return null;
	const pages = v.pages.filter((p): p is SheetPage => isObject(p) && isNumber(p.widthPt) && isNumber(p.heightPt)).map((p) => ({ widthPt: p.widthPt, heightPt: p.heightPt }));
	if (pages.length === 0) return null;
	return { n: v.n, prompt: v.prompt, at: v.at, pages, ...(isString(v.file) ? { file: v.file } : {}), ...(v.fromFolder === true ? { fromFolder: true as const } : {}) };
}

/** A file: format 4 keeps { name, file }, format 3 only the name. */
function readFile(v: unknown): SheetFile | null {
	if (isString(v)) return { name: v };
	return isObject(v) && isString(v.name) ? { name: v.name, ...(isString(v.file) ? { file: v.file } : {}) } : null;
}

/** A region as sent or saved, or undefined when it isn't one. */
export function sheetRegionOf(v: unknown): SheetRegion | undefined {
	if (!isObject(v)) return undefined;
	const { n, page, x, y, w, h } = v;
	return isNumber(n) && isNumber(page) && isNumber(x) && isNumber(y) && isNumber(w) && isNumber(h) ? { n, page, x, y, w, h } : undefined;
}

/** A session's problem or question as sent or saved, or undefined. */
export function sheetAboutOf(v: unknown): SheetAbout | undefined {
	if (!isObject(v) || (v.kind !== "problem" && v.kind !== "question") || !isString(v.session) || !isString(v.text)) return undefined;
	return { kind: v.kind, session: v.session, text: v.text, ...(isString(v.work) ? { work: v.work } : {}) };
}

function readMessage(v: unknown): SheetMessage | null {
	if (!isObject(v) || !isString(v.id) || !isString(v.text) || !isString(v.at)) return null;
	if (v.role === "you") {
		const files = list(v.files, readFile);
		const region = sheetRegionOf(v.region);
		const about = sheetAboutOf(v.about);
		return { id: v.id, role: "you", text: v.text, at: v.at, ...(files.length > 0 ? { files } : {}), ...(region ? { region } : {}), ...(about ? { about } : {}) };
	}
	if (v.role !== "agent") return null;
	const rules = Array.isArray(v.rules) ? v.rules.filter(isString) : [];
	return { id: v.id, role: "agent", text: v.text, at: v.at, ...(isNumber(v.version) ? { version: v.version } : {}), ...(rules.length > 0 ? { rules } : {}) };
}

function readRule(v: unknown): SheetRule | null {
	return isObject(v) && isString(v.text) && isString(v.at) ? { text: v.text, at: v.at } : null;
}

/** What formats 2 and 3 kept of the learner's asks, as the chat's first
 *  messages: each ask, then the version made for it (kept at the same
 *  moment). */
function askedBefore(prompts: unknown, versions: readonly SheetVersion[]): SheetMessage[] {
	const asks = list(prompts, (v) => (isObject(v) && isString(v.text) && isString(v.at) ? { text: v.text, at: v.at, files: list(v.files, readFile) } : null));
	return asks.flatMap((p, i): SheetMessage[] => {
		const made = versions.find((v) => v.at === p.at);
		return [
			{ id: `asked-${i}`, role: "you", text: p.text, at: p.at, ...(p.files.length > 0 ? { files: p.files } : {}) },
			...(made ? [{ id: `made-${i}`, role: "agent" as const, text: "", at: p.at, version: made.n }] : []),
		];
	});
}

/** Format 1's instructions, kept as its first message. */
function blockSheetAsks(raw: Record<string, unknown>, updatedAt: string): SheetMessage[] {
	const prefs = isObject(raw.prefs) ? raw.prefs : {};
	const text = isString(prefs.instructions) ? prefs.instructions.trim() : "";
	return text ? [{ id: "asked-0", role: "you", text, at: isString(raw.confirmedAt) ? raw.confirmedAt : updatedAt }] : [];
}

/**
 * A saved record: null when it isn't one, "newer" when a newer build wrote
 * it. Format 3's asks become the chat's first messages. An HTML sheet
 * (format 2) or block sheet (format 1) can't become a PDF without the
 * agent: its asks stay and it is marked olderFormat when it had a sheet.
 */
export function parseCheatSheet(raw: unknown): CheatSheet | "newer" | null {
	if (!isObject(raw) || !isString(raw.deadlineId)) return null;
	if (isNumber(raw.version) && raw.version > CHEAT_SHEET_FORMAT) return "newer";
	const updatedAt = isString(raw.updatedAt) ? raw.updatedAt : new Date(0).toISOString();
	const deadlineId = raw.deadlineId;
	if (raw.version === 2) return { deadlineId, versions: [], messages: askedBefore(raw.prompts, []), rules: [], ...(raw.doc ? { olderFormat: true as const } : {}), updatedAt };
	if (raw.version !== 3 && raw.version !== CHEAT_SHEET_FORMAT) {
		const made = Array.isArray(raw.blocks) && raw.blocks.length > 0;
		return { deadlineId, versions: [], messages: blockSheetAsks(raw, updatedAt), rules: [], ...(made ? { olderFormat: true as const } : {}), updatedAt };
	}
	const versions = list(raw.versions, readVersion);
	return {
		deadlineId,
		versions,
		messages: raw.version === 3 ? askedBefore(raw.prompts, versions) : list(raw.messages, readMessage),
		rules: list(raw.rules, readRule),
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
	rules: readonly SheetRule[];
	/** The deadline's topics in class order. */
	topics: readonly RequestTopic[];
	mistakes: readonly SheetMistake[];
	/** The working folder's absolute path, and what is in it now. */
	folder: { path: string; files: readonly string[] };
	/** Every kept version, oldest first (the newest is the sheet now). */
	versions: readonly SheetVersion[];
	/** The chat before this message, oldest first. */
	earlier: readonly SheetMessage[];
	message: YouMessage;
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
/** The chat a request carries: its last few messages, each cut short. */
const EARLIER_SENT = 8;
const EARLIER_CHARS = 500;
const ABOUT_CHARS = 1500;

function namedList(names: readonly string[], max: number): string {
	const rest = names.length - max;
	return `${names.slice(0, max).join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

function infoFileList(files: readonly string[]): string {
	return namedList([...files].sort((a, b) => Number(/syllabus|polic/i.test(b)) - Number(/syllabus|polic/i.test(a))), INFO_FILES_NAMED);
}

function folderText(r: CheatSheetRequest, current: SheetVersion | null): string {
	const files = r.folder.files.length > 0 ? `It has: ${namedList(r.folder.files, FOLDER_FILES_NAMED)}.` : "It is empty.";
	if (!current) return `Working folder: ${r.folder.path}\n${files} There is no sheet yet. Keep its source here so later changes can edit it.`;
	return `Working folder: ${r.folder.path}\n${files} The sheet now is version ${current.n} (${pageSizeLabel(current.pages)}), made from the source here. To change it, edit that source and keep the rest as it is.`;
}

function earlierText(messages: readonly SheetMessage[]): string {
	const lines = messages.slice(-EARLIER_SENT).map((m) => {
		if (m.role === "you") return `Student: ${oneLine(m.text, EARLIER_CHARS) || "(files only)"}`;
		return `You: ${[oneLine(m.text, EARLIER_CHARS), m.version ? `[made version ${m.version}]` : ""].filter(Boolean).join(" ")}`;
	});
	return lines.length > 0 ? `The chat so far, oldest first:\n${lines.join("\n")}` : "";
}

function aboutText(a: SheetAbout): string {
	const what = a.kind === "problem" ? "problem" : "question";
	return [
		`The student is on this ${what} in their session "${a.session}", with the sheet open beside it:`,
		oneLine(a.text, ABOUT_CHARS),
		a.work?.trim() ? `What they have written for it so far:\n${a.work.trim().slice(0, ABOUT_CHARS)}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function regionLine(r: SheetRegion, versions: readonly SheetVersion[], current: SheetVersion | null): string {
	const v = versions.find((x) => x.n === r.n);
	const older = current && r.n !== current.n ? ` That is an older version; the sheet now is version ${current.n}.` : "";
	return `They pointed at version ${r.n}, ${regionText(r, v?.pages.length ?? 1)}. The first picture shows that part.${older}`;
}

/** The request's text: the exam, the sheet's rules, the topics with
 *  readiness and facts, the mistakes, the working folder, the chat so far,
 *  what the learner is on and points at, and their message last. */
export function cheatSheetRequestText(r: CheatSheetRequest): string {
	const names = new Map(r.topics.map((t) => [t.id, t.name]));
	const current = r.versions[r.versions.length - 1] ?? null;
	const topic = (t: RequestTopic) =>
		[
			`${t.name} | ${STATUS_WORDS[t.status]}${t.mistakes > 0 ? `, ${t.mistakes} ${t.mistakes === 1 ? "mistake" : "mistakes"}` : ""}`,
			// Facts go with the first sheet only: after that the sheet holds them, and each message stays short.
			...(current ? [] : t.facts.map((f) => `  - ${f.name}: ${oneLine(f.statement, 140)}`)),
		].join("\n");
	const mistake = (m: SheetMistake) => `- ${m.kind === "hint" ? "needed hints" : "answered wrong"} (${names.get(m.topicId) ?? m.topicId}): "${m.text}"`;
	const m = r.message;
	return [
		[
			`Cheat sheet for: ${r.title} on ${r.date}`,
			r.classNotes ? `About the class: ${oneLine(r.classNotes, 300)}` : "",
			r.infoFiles.length > 0 ? `Course info files (the rules are likely here): ${infoFileList(r.infoFiles)}` : "The class has no course info files; search all its files for the rules.",
		]
			.filter(Boolean)
			.join("\n"),
		r.rules.length > 0 ? `This sheet's rules (follow every one):\n${r.rules.map((x) => `- ${x.text}`).join("\n")}` : "",
		r.topics.length > 0 ? `Topics on this exam (name | how the student does)${current ? "" : ", with some of the class's facts"}:\n${r.topics.map(topic).join("\n")}` : "",
		r.mistakes.length > 0 ? `Mistakes from practice:\n${r.mistakes.map(mistake).join("\n")}` : "",
		folderText(r, current),
		earlierText(r.earlier),
		m.about ? aboutText(m.about) : "",
		m.region ? regionLine(m.region, r.versions, current) : "",
		`The student says:\n${m.text.trim() || "(no words, only the files)"}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

// ─── a class's cheat sheets ─────────────────────────────────────────────────

/** Where a deadline's sheet is: made, the agent on it, made in an older
 *  format (or by a newer godspeed), or not there. */
type SheetStatus = "made" | "making" | "older" | "newer" | "none";

/** One deadline on the class's Cheat sheets page. */
export interface SheetCard {
	deadlineId: string;
	name: string;
	kind: DeadlineKind;
	date: string;
	time?: string;
	/** Done, or its day has gone by. */
	past: boolean;
	status: SheetStatus;
	/** The newest version, for its preview (also while the agent is on it). */
	version: SheetVersion | null;
}

/** GET /api/classes/<id>/cheat-sheets. */
export interface ClassSheetsView {
	className: string;
	cards: SheetCard[];
}

/** Every deadline of the class with its sheet: upcoming soonest first, then
 *  past ones, latest first. */
export function sheetCards(
	deadlines: readonly ClassDeadline[],
	sheetOf: (deadlineId: string) => CheatSheet | "newer" | null,
	running: (deadlineId: string) => boolean,
	today: string,
): SheetCard[] {
	const cards = deadlines.map((d): SheetCard => {
		const sheet = sheetOf(d.id);
		const version = sheet && sheet !== "newer" ? currentVersion(sheet) : null;
		const status: SheetStatus = running(d.id)
			? "making"
			: sheet === "newer"
				? "newer"
				: version
					? "made"
					: sheet?.olderFormat
						? "older"
						: "none";
		return { deadlineId: d.id, name: d.name, kind: d.kind, date: d.date, ...(d.time ? { time: d.time } : {}), past: d.done || d.date < today, status, version };
	});
	const when = (c: SheetCard) => `${c.date} ${c.time ?? "23:59"}`;
	return [...cards.filter((c) => !c.past).sort((a, b) => when(a).localeCompare(when(b))), ...cards.filter((c) => c.past).sort((a, b) => when(b).localeCompare(when(a)))];
}

// ─── what the studio reads ──────────────────────────────────────────────────

/** GET …/cheat-sheet: everything the studio and the sheet beside a
 *  session show. */
export interface CheatSheetView {
	className: string;
	deadlineName: string;
	/** The due day, YYYY-MM-DD. */
	date: string;
	sheet: CheatSheet;
	/** The message the agent is answering. */
	running: { messageId: string } | null;
	/** The message the last request failed on and why (Try again sends it again). */
	error: { messageId: string; text: string } | null;
	/** A newer godspeed saved it: shown, never changed. */
	newer?: true;
}
