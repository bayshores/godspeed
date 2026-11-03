/**
 * THE CHEAT SHEET: the one page of notes a class lets the learner bring
 * to a deadline. Each deadline can have one: the class's rules for it
 * (allowed, paper, handwritten or printed, what's banned), the learner's
 * choices (what goes on it, text size, columns, ink) and the blocks the
 * agent wrote, one per topic plus a "Watch out" block of past mistakes.
 *
 * Tailoring: weak topics and real mistakes come first and get the most
 * room, shaky topics are short, untested topics get the key formulas, and
 * topics the learner knows cold are left out (listed, so one can be added
 * back). Pure and browser-safe.
 */
import type { TopicStatus } from "./progress.ts";

// ─── rules ──────────────────────────────────────────────────────────────────

export type CheatSheetPaper = "letter" | "letter-both" | "index-card" | "a4";

export const CHEAT_SHEET_PAPERS: readonly CheatSheetPaper[] = ["letter", "letter-both", "index-card", "a4"];

interface PaperSize {
	label: string;
	/** The size as the learner knows it ("8.5 × 11 in"). */
	size: string;
	/** The paper's printed width and height in inches (the card lies flat). */
	widthIn: number;
	heightIn: number;
	sides: 1 | 2;
	marginIn: number;
	/** How the paper header names it ("one letter page, one side"). */
	phrase: string;
	/** The CSS @page size. */
	pageSize: string;
}

export const PAPERS: Record<CheatSheetPaper, PaperSize> = {
	letter: { label: "Letter, one side", size: "8.5 × 11 in", widthIn: 8.5, heightIn: 11, sides: 1, marginIn: 0.4, phrase: "one letter page, one side", pageSize: "8.5in 11in" },
	"letter-both": { label: "Letter, both sides", size: "8.5 × 11 in", widthIn: 8.5, heightIn: 11, sides: 2, marginIn: 0.4, phrase: "one letter page, both sides", pageSize: "8.5in 11in" },
	"index-card": { label: "Index card", size: "3 × 5 in", widthIn: 5, heightIn: 3, sides: 1, marginIn: 0.15, phrase: "one 3 × 5 index card", pageSize: "5in 3in" },
	a4: { label: "A4", size: "210 × 297 mm", widthIn: 8.27, heightIn: 11.69, sides: 1, marginIn: 0.4, phrase: "one A4 page, one side", pageSize: "210mm 297mm" },
};

export type CheatSheetWriting = "printed" | "by-hand";

export interface CheatSheetRules {
	allowed: boolean;
	paper: CheatSheetPaper;
	writing: CheatSheetWriting;
	/** What the class doesn't allow on it, in its own words ("Worked examples"). */
	banned: string[];
	/** Where the agent read them ("CSE 21 Syllabus.pdf, page 3"). */
	source?: string;
}

/** Longest banned item and most of them. */
const BANNED_MAX_CHARS = 60;
const BANNED_MAX = 8;

// ─── preferences ────────────────────────────────────────────────────────────

export type CheatSheetContent = "formulas" | "definitions" | "theorems" | "examples" | "mistakes";

export const CHEAT_SHEET_CONTENT: readonly { id: CheatSheetContent; label: string }[] = [
	{ id: "formulas", label: "Formulas" },
	{ id: "definitions", label: "Definitions" },
	{ id: "theorems", label: "Theorems" },
	{ id: "mistakes", label: "Your mistakes" },
	{ id: "examples", label: "Examples" },
];

export type CheatSheetTextSize = "small" | "medium" | "large";

export const TEXT_SIZES: Record<CheatSheetTextSize, { label: string; pt: number }> = {
	small: { label: "Small", pt: 7 },
	medium: { label: "Medium", pt: 8.5 },
	large: { label: "Large", pt: 11 },
};

export type CheatSheetInk = "black" | "color";

export interface CheatSheetPrefs {
	content: CheatSheetContent[];
	textSize: CheatSheetTextSize;
	columns: 2 | 3;
	ink: CheatSheetInk;
}

// ─── blocks and the record ──────────────────────────────────────────────────

/** The topic id of the "Watch out" block. */
export const WATCH_OUT = "watch_out";

export interface CheatSheetBlock {
	/** "blk_" + 8 hex. */
	id: string;
	/** A topic id of the deadline, or WATCH_OUT. */
	topicId: string;
	title: string;
	/** Markdown lines with $…$ math. */
	body: string;
	/** A few words beside the block: "Missed twice". */
	reason: string;
	/** One or two sentences on why it says what it says. */
	why?: string;
	/** Kept as it is when the sheet is made again and by the fit fixes. */
	pinned?: true;
}

export interface CheatSheet {
	deadlineId: string;
	rules: CheatSheetRules;
	prefs: CheatSheetPrefs;
	/** In paper order. */
	blocks: CheatSheetBlock[];
	/** The agent already looked for the rules in the class's files. */
	rulesRead?: true;
	/** When the learner confirmed the rules (Make my cheat sheet). */
	confirmedAt?: string;
	updatedAt: string;
}

/** The record format this build writes. */
export const CHEAT_SHEET_VERSION = 1;

export const DEFAULT_RULES: CheatSheetRules = { allowed: true, paper: "letter", writing: "printed", banned: [] };

export const DEFAULT_PREFS: CheatSheetPrefs = {
	content: ["formulas", "definitions", "theorems", "mistakes"],
	textSize: "medium",
	columns: 2,
	ink: "black",
};

export function newCheatSheet(deadlineId: string, now: string): CheatSheet {
	return { deadlineId, rules: { ...DEFAULT_RULES, banned: [] }, prefs: { ...DEFAULT_PREFS, content: [...DEFAULT_PREFS.content] }, blocks: [], updatedAt: now };
}

export function newBlockId(): string {
	return `blk_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// ─── reading a saved or sent record ─────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

const TEXT_SIZE_IDS = Object.keys(TEXT_SIZES) as CheatSheetTextSize[];
const CONTENT_IDS = CHEAT_SHEET_CONTENT.map((c) => c.id);

/** Banned items cleaned: one line each, trimmed, no repeats, capped. */
export function cleanBanned(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const item of raw) {
		if (!isString(item)) continue;
		const line = item.replace(/\s+/g, " ").trim().slice(0, BANNED_MAX_CHARS);
		if (line && !out.some((o) => o.toLowerCase() === line.toLowerCase())) out.push(line);
	}
	return out.slice(0, BANNED_MAX);
}

/** Rules from a patch over `base`: unknown or bad fields keep the base's. */
export function mergeRules(base: CheatSheetRules, raw: unknown): CheatSheetRules {
	if (!isObject(raw)) return base;
	const source = raw.source === null ? undefined : isString(raw.source) && raw.source.trim() ? raw.source.trim().slice(0, 120) : base.source;
	return {
		allowed: typeof raw.allowed === "boolean" ? raw.allowed : base.allowed,
		paper: oneOf(CHEAT_SHEET_PAPERS, raw.paper) ? raw.paper : base.paper,
		writing: oneOf(["printed", "by-hand"] as const, raw.writing) ? raw.writing : base.writing,
		banned: raw.banned !== undefined ? cleanBanned(raw.banned) : base.banned,
		...(source ? { source } : {}),
	};
}

/** Preferences from a patch over `base`. */
export function mergePrefs(base: CheatSheetPrefs, raw: unknown): CheatSheetPrefs {
	if (!isObject(raw)) return base;
	const content = Array.isArray(raw.content) ? CONTENT_IDS.filter((id) => (raw.content as unknown[]).includes(id)) : base.content;
	return {
		content,
		textSize: oneOf(TEXT_SIZE_IDS, raw.textSize) ? raw.textSize : base.textSize,
		columns: raw.columns === 2 || raw.columns === 3 ? raw.columns : base.columns,
		ink: oneOf(["black", "color"] as const, raw.ink) ? raw.ink : base.ink,
	};
}

function readBlock(v: unknown): CheatSheetBlock | null {
	if (!isObject(v) || !isString(v.id) || !isString(v.topicId) || !isString(v.title) || !isString(v.body) || !isString(v.reason)) return null;
	return {
		id: v.id,
		topicId: v.topicId,
		title: v.title,
		body: v.body,
		reason: v.reason,
		...(isString(v.why) && v.why ? { why: v.why } : {}),
		...(v.pinned === true ? { pinned: true as const } : {}),
	};
}

/** A saved record: null when it isn't one, "newer" when a newer build wrote it. */
export function parseCheatSheet(raw: unknown): CheatSheet | "newer" | null {
	if (!isObject(raw) || !isString(raw.deadlineId)) return null;
	if (typeof raw.version === "number" && raw.version > CHEAT_SHEET_VERSION) return "newer";
	return {
		deadlineId: raw.deadlineId,
		rules: mergeRules(DEFAULT_RULES, raw.rules),
		prefs: mergePrefs(DEFAULT_PREFS, raw.prefs),
		blocks: Array.isArray(raw.blocks) ? raw.blocks.map(readBlock).filter((b): b is CheatSheetBlock => b !== null) : [],
		...(raw.rulesRead === true ? { rulesRead: true as const } : {}),
		...(isString(raw.confirmedAt) ? { confirmedAt: raw.confirmedAt } : {}),
		updatedAt: isString(raw.updatedAt) ? raw.updatedAt : new Date(0).toISOString(),
	};
}

// ─── what the rules and choices mean ────────────────────────────────────────

const BAN_WORDS: Partial<Record<CheatSheetContent, RegExp>> = {
	formulas: /formula/i,
	definitions: /definition/i,
	theorems: /theorem/i,
	examples: /example/i,
};

/** The content kinds a banned item rules out ("Worked examples" → examples). */
export function bannedContent(banned: readonly string[]): Set<CheatSheetContent> {
	const out = new Set<CheatSheetContent>();
	for (const [id, word] of Object.entries(BAN_WORDS) as [CheatSheetContent, RegExp][]) if (banned.some((b) => word.test(b))) out.add(id);
	return out;
}

/** What actually goes on it: the learner's picks minus what's banned. */
export function sheetContent(sheet: Pick<CheatSheet, "rules" | "prefs">): CheatSheetContent[] {
	const banned = bannedContent(sheet.rules.banned);
	return sheet.prefs.content.filter((c) => !banned.has(c));
}

/** Written by hand takes Large text; printed goes back to Medium. */
export function prefsForWriting(prefs: CheatSheetPrefs, writing: CheatSheetWriting): CheatSheetPrefs {
	return { ...prefs, textSize: writing === "by-hand" ? "large" : "medium" };
}

/** Space between lines: a handwritten sheet gets more. */
export function lineLeading(writing: CheatSheetWriting): number {
	return writing === "by-hand" ? 1.6 : 1.25;
}

/** The paper header's band, in inches (title line and rule). */
export function headerHeightIn(paper: CheatSheetPaper): number {
	return paper === "index-card" ? 0.22 : 0.4;
}

/** How tall one column is, in inches. */
export function columnHeightIn(paper: CheatSheetPaper): number {
	const p = PAPERS[paper];
	return p.heightIn - 2 * p.marginIn - headerHeightIn(paper);
}

/** Lines of text one column holds at this size. */
export function linesPerColumn(sheet: Pick<CheatSheet, "rules" | "prefs">): number {
	const lineIn = (TEXT_SIZES[sheet.prefs.textSize].pt * lineLeading(sheet.rules.writing)) / 72;
	return Math.floor(columnHeightIn(sheet.rules.paper) / lineIn);
}

/** Lines the whole sheet holds: every column on every side. */
export function sheetLines(sheet: Pick<CheatSheet, "rules" | "prefs">): number {
	return linesPerColumn(sheet) * sheet.prefs.columns * PAPERS[sheet.rules.paper].sides;
}

// ─── which topics go on it ──────────────────────────────────────────────────

export interface SheetTopic {
	id: string;
	name: string;
	status: TopicStatus;
	/** Mistakes in this topic (wrong answers, problems that needed hints). */
	mistakes: number;
}

/** One mistake from the learner's lessons, for the Watch out block. */
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
		out.push({ topicId, text: line.length <= MISTAKE_CHARS ? line : `${line.slice(0, MISTAKE_CHARS - 1)}…`, kind: a.kind, at: a.at });
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

/** The deadline's topics split: what goes on the sheet (in class order)
 *  and what is left out because the learner knows it cold. */
export function sheetTopics(topics: readonly SheetTopic[]): { on: SheetTopic[]; leftOut: SheetTopic[] } {
	return { on: topics.filter((t) => t.status !== "strong" || t.mistakes > 0), leftOut: topics.filter((t) => t.status === "strong" && t.mistakes === 0) };
}

/** The topics a sheet's blocks don't cover (the "Left out" list). */
export function leftOutTopics(topics: readonly SheetTopic[], blocks: readonly Pick<CheatSheetBlock, "topicId">[]): SheetTopic[] {
	const on = new Set(blocks.map((b) => b.topicId));
	return topics.filter((t) => !on.has(t.id));
}

/** One line of the setup's "What goes on it", with its ramp color. */
interface PlanLine {
	status: TopicStatus;
	text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The setup's summary: mistakes and weak topics first, then shaky, then
 *  untested, and what is left out. */
export function planLines(topics: readonly SheetTopic[], mistakes: number, withMistakes: boolean): PlanLine[] {
	const count = (s: TopicStatus) => topics.filter((t) => t.status === s && (s !== "strong" || t.mistakes === 0)).length;
	const weak = count("weak");
	const shaky = count("shaky");
	const untested = count("untested");
	const strong = count("strong");
	const m = withMistakes ? mistakes : 0;
	const lines: { status: TopicStatus; text: string }[] = [];
	const first = [m > 0 ? `your ${plural(m, "mistake")} from practice` : "", weak > 0 ? `your weak ${weak === 1 ? "topic" : "topics"}` : ""].filter(Boolean);
	if (first.length > 0) lines.push({ status: "weak", text: first.join(" and ") });
	if (shaky > 0) lines.push({ status: "shaky", text: `${shaky === 1 ? "your shaky topic" : "shaky topics"}, short` });
	if (untested > 0) lines.push({ status: "untested", text: `the key formulas for the ${plural(untested, "topic")} you haven't been tested on` });
	const out: PlanLine[] = lines.map((l, i) => ({ status: l.status, text: `${i === 0 ? "First" : "Then"}: ${l.text}` }));
	if (strong > 0) out.push({ status: "strong", text: `Left out: the ${plural(strong, "topic")} you know cold` });
	return out;
}

/** Lines each block may take: the Watch out block a line per mistake,
 *  the rest shared by weight (weak 3, shaky 2, untested and strong 1),
 *  at least 2 each, after a title line per block. */
export function lineBudgets(total: number, topics: readonly Pick<SheetTopic, "id" | "status">[], mistakes: number): Map<string, number> {
	const out = new Map<string, number>();
	const blocks = topics.length + (mistakes > 0 ? 1 : 0);
	let left = Math.max(0, total - 2 * blocks);
	if (mistakes > 0) {
		const watch = Math.min(mistakes * 2, Math.floor(left / 4));
		out.set(WATCH_OUT, Math.max(2, watch));
		left -= watch;
	}
	const weight = (s: TopicStatus) => (s === "weak" ? 3 : s === "shaky" ? 2 : 1);
	const sum = topics.reduce((n, t) => n + weight(t.status), 0);
	for (const t of topics) out.set(t.id, Math.max(2, Math.floor((left * weight(t.status)) / Math.max(1, sum))));
	return out;
}

/** The color a topic's status reads in (the readiness ramp). */
export const STATUS_COLOR: Record<TopicStatus, string> = {
	weak: "var(--lh-ramp-1)",
	shaky: "var(--lh-ramp-2)",
	untested: "var(--lh-ink-3)",
	strong: "var(--lh-ramp-5)",
};

/** The blocks a new sheet will have, before the agent writes them (the
 *  studio's outline while it works): Watch out, then the topics on it. */
export function plannedBlocks(topics: readonly SheetTopic[], mistakes: number, withMistakes: boolean): { topicId: string; title: string }[] {
	return [...(withMistakes && mistakes > 0 ? [{ topicId: WATCH_OUT, title: "Watch out" }] : []), ...sheetTopics(topics).on.map((t) => ({ topicId: t.id, title: t.name }))];
}

// ─── what the studio reads ──────────────────────────────────────────────────

/** A request the agent is working on: the whole sheet, or some blocks. */
export interface CheatSheetRun {
	kind: "make" | "change";
	blockIds: string[];
	/** A topic being added back. */
	topicId?: string;
}

/** GET …/cheat-sheet: everything the setup and the studio show. */
export interface CheatSheetView {
	className: string;
	deadlineName: string;
	/** The due day, YYYY-MM-DD. */
	date: string;
	sheet: CheatSheet;
	/** False while the sheet is only defaults (never saved). */
	saved: boolean;
	/** The deadline's topics, in the order the class covered them. */
	topics: SheetTopic[];
	mistakes: number;
	running: CheatSheetRun | null;
	readingRules: boolean;
	/** Why the last request failed. */
	error: string | null;
	/** A newer godspeed saved it: shown, never changed. */
	newer?: true;
}
