/**
 * A Study topic's page under the paragraph that quotes it: which text part
 * draws it, where the text splits around it, and how its PDF page, code
 * lines or passage are cut and marked. Pure.
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { mathFromMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import { CITE_TAG, citeView, fileCiteMark, openerLeadId, textPartMessageId, type Cite, type LhViewPart, type TopicParts } from "@/shared/core";

/** A source in a space file. */
export type FileCite = Extract<Cite, { kind: "file" }>;

/** A box on a PDF page, as fractions of the page image from its top left. */
interface PageBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Code lines: `spans` are file line numbers with UTF-16 offsets in that line. */
type CodeMarks = { kind: "lines"; first: number; lines: string[]; spans: { line: number; start: number; end: number }[] };

/** Where the quoted words sit, as GET /api/cited answers it. */
type CitedMarks = { kind: "page"; boxes: PageBox[] } | CodeMarks | { kind: "passage"; start: number; end: number };

/** GET /api/cited: the place, its PDF page if it has one, and the marked words. */
export interface CitedPassage {
	page: number | null;
	text: string;
	marks: CitedMarks | null;
}

/** Each topic's page mark as it is stored, by the text it sits in: the
 *  reply's message id, or the opener lead's part id. */
export function topicPageMarks(topics: readonly TopicParts[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const { page } of topics) {
		if (!page) continue;
		const owner = page.leadOf === null ? page.messageId : openerLeadId(page.leadOf);
		if (owner !== null) out.set(owner, fileCiteMark(page.fileId, page.range, page.name, page.quote));
	}
	return out;
}

/** The text parts of one transcript row that draw a page: part index to
 *  the stored mark. A page draws once, under the first part holding it. */
export function excerptParts(parts: readonly LhViewPart[], marks: ReadonlyMap<string, string>): Map<number, string> {
	const out = new Map<number, string>();
	if (marks.size === 0) return out;
	const drawn = new Set<string>();
	parts.forEach((part, i) => {
		if (part.type !== "text" || !part.id) return;
		const owner = textPartMessageId(part.id) ?? part.id;
		const mark = marks.get(owner);
		if (!mark || drawn.has(owner) || !part.text?.includes(mark)) return;
		drawn.add(owner);
		out.set(i, mark);
	});
	return out;
}

/** The page's source in a text's numbered sources: its number and the
 *  source with the quote, which is what the page and its dialog mark. */
export function pageSource(cites: readonly Cite[], mark: string): { n: number; cite: FileCite } | null {
	const page = citeView(mark).cites[0];
	if (page?.kind !== "file") return null;
	const at = cites.findIndex((c) => c.kind === "file" && c.fileId === page.fileId && c.range === page.range);
	return at < 0 ? null : { n: at + 1, cite: page };
}

/** Rendered teacher text split after the block holding source `n`'s first
 *  number, so the page draws right under that paragraph (or list, or
 *  quote). The whole text and "" when the number is not there. */
export function splitAfterSource(text: string, n: number): [string, string] {
	const at = text.indexOf(`<${CITE_TAG} n="${n}">`);
	if (at < 0) return [text, ""];
	const tree = fromMarkdown(text, { extensions: [math({ singleDollarTextMath: true })], mdastExtensions: [mathFromMarkdown()] });
	const end = tree.children.find((block) => (block.position?.start.offset ?? 0) <= at && at < (block.position?.end.offset ?? 0))?.position?.end.offset;
	if (end === undefined) return [text, ""];
	return [text.slice(0, end), text.slice(end).trimStart()];
}

/** How the page sits in its 220px frame: a landscape page shows whole at
 *  that height; a portrait page fills the width and shows a band with the
 *  marked words (the top when nothing is marked). `at` is the fraction of
 *  the page height that stays at the same fraction of the band. */
export function pageBand(size: { w: number; h: number } | null, boxes: readonly PageBox[]): { landscape: boolean; aspect: number; at: number } {
	const aspect = size && size.h > 0 ? size.w / size.h : 16 / 9;
	if (boxes.length === 0) return { landscape: aspect >= 1, aspect, at: 0 };
	const top = Math.min(...boxes.map((b) => b.y));
	const bottom = Math.max(...boxes.map((b) => b.y + b.h));
	return { landscape: aspect >= 1, aspect, at: Math.min(1, Math.max(0, (top + bottom) / 2)) };
}

/** How the page reads to a screen reader: "Lecture 6, page 14, marked "degree 12"". */
export function pageLabel(name: string, page: number, quote: string | undefined, marked: boolean): string {
	const base = `${name.replace(/\.pdf$/i, "")}, page ${page}`;
	return marked && quote ? `${base}, marked "${quote}"` : base;
}

/** How code lines read to a screen reader: "lab3/arrays.c, lines 10 to 21". */
export function linesLabel(name: string, marks: CodeMarks): string {
	const last = marks.first + marks.lines.length - 1;
	return last === marks.first ? `${name}, line ${last}` : `${name}, lines ${marks.first} to ${last}`;
}

const TAB = 4;

/** One code line to draw: its number, its text with tabs as spaces, and
 *  the marked ranges in that text. */
interface CodeRow {
	n: number;
	text: string;
	marks: [number, number][];
}

/** The lines with their marks, tabs turned into spaces at 4-column stops. */
export function codeRows(marks: CodeMarks): CodeRow[] {
	return marks.lines.map((raw, i) => {
		const n = marks.first + i;
		const at: number[] = [];
		let text = "";
		for (const ch of raw) {
			for (let k = 0; k < ch.length; k++) at.push(text.length);
			text += ch === "\t" ? " ".repeat(TAB - (text.length % TAB)) : ch;
		}
		at.push(text.length);
		const col = (offset: number) => at[Math.min(Math.max(offset, 0), at.length - 1)]!;
		const spans = marks.spans.filter((s) => s.line === n && s.end > s.start).map((s): [number, number] => [col(s.start), col(s.end)]);
		return { n, text, marks: spans };
	});
}

/** The language a file's code is coloured as, from its extension. */
export function codeLanguage(name: string): string {
	const ext = /\.([a-z0-9+]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
	return ext === "h" ? "c" : ext || "text";
}

/** Runs of text (coloured tokens) cut at the marked ranges, in stretches
 *  that are all marked or all not, so one mark covers a whole expression. */
export function markRuns<T extends { content: string }>(runs: readonly T[], marks: readonly [number, number][]): { marked: boolean; pieces: { run: T; text: string }[] }[] {
	const out: { marked: boolean; pieces: { run: T; text: string }[] }[] = [];
	let offset = 0;
	for (const run of runs) {
		const end = offset + run.content.length;
		const cuts = new Set([offset, end]);
		for (const [a, b] of marks) for (const c of [a, b]) if (c > offset && c < end) cuts.add(c);
		const points = [...cuts].sort((p, q) => p - q);
		for (let i = 0; i + 1 < points.length; i++) {
			const [a, b] = [points[i]!, points[i + 1]!];
			const marked = marks.some(([s, e]) => s <= a && b <= e);
			const piece = { run, text: run.content.slice(a - offset, b - offset) };
			const last = out.at(-1);
			if (last && last.marked === marked) last.pieces.push(piece);
			else out.push({ marked, pieces: [piece] });
		}
		offset = end;
	}
	return out;
}

/** A .docx or .pptx quote: the lines holding the marked words, cut in three. */
export function passageQuote(text: string, start: number, end: number): { before: string; marked: string; after: string } {
	const from = text.slice(0, start).lastIndexOf("\n") + 1;
	const stop = text.indexOf("\n", end);
	const to = stop < 0 ? text.length : stop;
	return { before: text.slice(from, start), marked: text.slice(start, end), after: text.slice(end, to) };
}
