/**
 * CLASS SEARCH, the pure parts: class files cut into passages (each with
 * where it sits in its file), keyword ranking (MiniSearch BM25+), vector
 * ranking over normalized embeddings, and the fusion of the two.
 *
 * The model and the stored index live in src/server/search-index.ts.
 */
import MiniSearch from "minisearch";
import { extensionOf, TRANSCRIPT_EXTENSIONS } from "./contracts.ts";

/** One piece of a class file, before it gets an id and a hash. `from`/`to`
 *  locate it: pages (PDFs), seconds (captions) or lines (text). */
export interface PassageChunk {
	range: string;
	from: number;
	to: number;
	text: string;
}

/** A file's passages plus its size for the class outline ("98 pages"). */
interface ChunkedFile {
	chunks: PassageChunk[];
	extent: string;
}

/** About 400 tokens: the embedding model reads at most 512. */
const MAX_PASSAGE_CHARS = 1600;
/** About 300 tokens: the target size of a text window. */
const TEXT_WINDOW_CHARS = 1200;
/** Caption windows close after a minute and never pass a minute and a half. */
const CAPTION_WINDOW_MIN_S = 60;
const CAPTION_WINDOW_MAX_S = 90;

/** Cut a class file's text into passages. PDFs (text with "--- Page N ---"
 *  heads) by page, .srt/.vtt (the raw caption file) by time, everything
 *  else by paragraph windows with line ranges. */
export function chunkFile(name: string, text: string): ChunkedFile {
	const ext = extensionOf(name);
	if (ext === ".pdf") return chunkPdf(text);
	if ((TRANSCRIPT_EXTENSIONS as readonly string[]).includes(ext)) return chunkCaptions(text);
	return chunkText(text);
}

function chunkPdf(text: string): ChunkedFile {
	const chunks: PassageChunk[] = [];
	const parts = text.split(/^--- Page (\d+) ---$/m);
	let pages = 0;
	for (let i = 1; i < parts.length; i += 2) {
		const page = Number(parts[i]);
		pages = Math.max(pages, page);
		for (const piece of splitLong(parts[i + 1]!.trim(), MAX_PASSAGE_CHARS)) {
			chunks.push({ range: `p. ${page}`, from: page, to: page, text: piece });
		}
	}
	return { chunks, extent: `${pages} ${pages === 1 ? "page" : "pages"}` };
}

/** Split text longer than `max` at line ends (or, for one huge line, at
 *  spaces), each piece at most `max` characters. Empty text gives none. */
function splitLong(text: string, max: number): string[] {
	if (text === "") return [];
	if (text.length <= max) return [text];
	const out: string[] = [];
	let cur = "";
	for (const line of text.split("\n")) {
		for (const piece of line.length > max ? hardWrap(line, max) : [line]) {
			if (cur && cur.length + 1 + piece.length > max) {
				out.push(cur);
				cur = piece;
			} else {
				cur = cur ? `${cur}\n${piece}` : piece;
			}
		}
	}
	if (cur.trim()) out.push(cur);
	return out;
}

function hardWrap(line: string, max: number): string[] {
	const out: string[] = [];
	let rest = line;
	while (rest.length > max) {
		const cut = rest.lastIndexOf(" ", max);
		const at = cut > max / 2 ? cut : max;
		out.push(rest.slice(0, at));
		rest = rest.slice(at).trimStart();
	}
	if (rest) out.push(rest);
	return out;
}

interface Cue {
	start: number;
	end: number;
	text: string;
}

/** "00:01:02,500" / "01:02.500" → seconds. */
function cueSeconds(stamp: string): number {
	const parts = stamp.trim().replace(",", ".").split(":").map(Number);
	return parts.reduce((total, n) => total * 60 + n, 0);
}

function parseCues(raw: string): Cue[] {
	const cues: Cue[] = [];
	let current: Cue | null = null;
	for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
		const timing = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(line);
		if (timing) {
			current = { start: cueSeconds(timing[1]!), end: cueSeconds(timing[2]!), text: "" };
			cues.push(current);
			continue;
		}
		const t = line.replace(/<[^>]+>/g, "").trim();
		if (t === "") {
			current = null;
		} else if (current) {
			current.text = current.text ? `${current.text} ${t}` : t;
		}
	}
	return cues.filter((c) => c.text !== "");
}

/** Seconds as m:ss, or h:mm:ss from an hour on. */
function clock(seconds: number): string {
	const s = Math.floor(seconds);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const ss = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function chunkCaptions(raw: string): ChunkedFile {
	const chunks: PassageChunk[] = [];
	let window: Cue[] = [];
	let last = "";
	const close = () => {
		if (window.length === 0) return;
		const from = window[0]!.start;
		const to = window.at(-1)!.end;
		chunks.push({ range: `${clock(from)}–${clock(to)}`, from, to, text: window.map((c) => c.text).join(" ") });
		window = [];
	};
	for (const cue of parseCues(raw)) {
		// Rolling captions repeat the previous line: keep it once.
		if (cue.text === last) continue;
		last = cue.text;
		if (window.length > 0 && (cue.end - window[0]!.start > CAPTION_WINDOW_MAX_S || windowChars(window) + cue.text.length > MAX_PASSAGE_CHARS)) close();
		window.push(cue);
		if (cue.end - window[0]!.start >= CAPTION_WINDOW_MIN_S) close();
	}
	close();
	const minutes = Math.round((chunks.at(-1)?.to ?? 0) / 60);
	return { chunks, extent: `${minutes} min` };
}

function windowChars(window: Cue[]): number {
	return window.reduce((n, c) => n + c.text.length + 1, 0);
}

/** Paragraph windows of about TEXT_WINDOW_CHARS with their line ranges
 *  (1-based). Also how a long passage is cut into windows for embedding. */
export function chunkText(text: string): ChunkedFile {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const chunks: PassageChunk[] = [];
	let buf: string[] = [];
	let from = 0;
	let to = 0;
	const flush = () => {
		const body = buf.join("\n").trim();
		if (body) {
			const pieces = splitLong(body, MAX_PASSAGE_CHARS);
			for (const piece of pieces) chunks.push({ range: `lines ${from}–${to}`, from, to, text: piece });
		}
		buf = [];
	};
	let size = 0;
	lines.forEach((line, i) => {
		const blank = line.trim() === "";
		if (buf.length > 0 && size + line.length + 1 > MAX_PASSAGE_CHARS) flush();
		if (buf.length === 0) {
			if (blank) return;
			from = i + 1;
			size = 0;
		}
		buf.push(line);
		size += line.length + 1;
		if (!blank) to = i + 1;
		else if (size >= TEXT_WINDOW_CHARS) flush();
	});
	flush();
	// A trailing newline ends the last line; it doesn't start another.
	const count = lines.at(-1) === "" ? lines.length - 1 : lines.length;
	return { chunks, extent: `${count} ${count === 1 ? "line" : "lines"}` };
}

/** Which passage(s) read_passage opens: one by id, or every passage of a
 *  file at a place ("p. 12", "12:30", "lines 40"), e.g. a whole page. */
export type PassageRef = { passageId: string } | { fileId: string; range: string };

/** A point inside a file as the agent names it: "p. 12" / "12" → 12,
 *  "12:30" → 750 s, "lines 40–80" → 40. null when it has no number. */
export function rangePoint(range: string): number | null {
	const time = /(\d+(?::\d{1,2}){1,2})/.exec(range);
	if (time) return cueSeconds(time[1]!);
	const n = /\d+/.exec(range);
	return n ? Number(n[0]) : null;
}

// ─── ranking ────────────────────────────────────────────────────────────────

/** A keyword index over (id, text) pairs. */
export function keywordIndex(docs: readonly { id: string; text: string }[]): MiniSearch {
	const index = new MiniSearch({ fields: ["text"], idField: "id" });
	index.addAll(docs);
	return index;
}

/** Ids in BM25+ order for the query's words (any word may match). */
export function keywordRanking(index: MiniSearch, query: string, n: number): string[] {
	return index
		.search(query, { combineWith: "OR" })
		.slice(0, n)
		.map((hit) => String(hit.id));
}

/**
 * Rows of `vectors` (row-major, `dims` floats each, normalized) by their
 * best cosine against any of `queries` (also normalized), best first, at
 * most `n`.
 */
export function vectorRanking(queries: readonly Float32Array[], vectors: Float32Array, dims: number, n: number): number[] {
	const rows = vectors.length / dims;
	const scores = new Float32Array(rows);
	for (let r = 0; r < rows; r++) {
		let best = -Infinity;
		for (const q of queries) {
			let dot = 0;
			for (let d = 0; d < dims; d++) dot += q[d]! * vectors[r * dims + d]!;
			if (dot > best) best = dot;
		}
		scores[r] = best;
	}
	return Array.from({ length: rows }, (_, r) => r)
		.sort((a, b) => scores[b]! - scores[a]!)
		.slice(0, n);
}

/** The constant of reciprocal-rank fusion. */
const RRF_K = 60;

/** Reciprocal-rank fusion: each ranking adds weight / (60 + rank) to an
 *  id. Best first. */
export function fuseRankings(rankings: readonly { ids: readonly string[]; weight: number }[]): string[] {
	const score = new Map<string, number>();
	for (const { ids, weight } of rankings) {
		ids.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + weight / (RRF_K + rank + 1)));
	}
	return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** The embedding ranking counts double the keyword one: equal weights
 *  did worse on questions worded unlike the material. */
export const VECTOR_WEIGHT = 1;
export const KEYWORD_WEIGHT = 0.5;

/** About two lines of a passage around the first query word it holds
 *  (its start when none), whitespace collapsed. */
export function snippetOf(text: string, query: string, max = 200): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= max) return flat;
	const lower = flat.toLowerCase();
	const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
	const hits = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
	const at = hits.length ? Math.min(...hits) : 0;
	const start = Math.max(0, Math.min(at - Math.floor(max / 4), flat.length - max));
	return `${start > 0 ? "…" : ""}${flat.slice(start, start + max).trim()}${start + max < flat.length ? "…" : ""}`;
}
