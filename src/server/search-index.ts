/**
 * CLASS SEARCH: the stored index and the embedding model.
 *
 * Offline and free: a small embedding model (snowflake-arctic-embed-xs,
 * quantized ONNX) runs on a worker thread (workers/embed-worker.mjs) from
 * models/ (scripts/fetch-model.mjs fills it; never downloaded at run time),
 * so indexing never stalls requests. Each graph scope keeps its index
 * next to its graph, in search/:
 *   passages.json + passages.f32  every class file cut into passages
 *   facts.json + facts.f32        the graph's facts
 * The .json holds the rows (passages with their text and place, facts by id),
 * the .f32 one 384-float vector per row in the same order. A row's hash is
 * of its text, so a changed file or fact re-embeds only what changed.
 *
 * Search fuses the embedding ranking with a BM25 keyword ranking
 * (src/core/search.ts). Brute-force cosine: fine for tens of thousands of rows.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import type MiniSearch from "minisearch";
import type { ClassScope, GraphNode } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import type { GraphStore } from "../core/ports.ts";
import {
	chunkFile,
	chunkText,
	fuseRankings,
	KEYWORD_WEIGHT,
	keywordIndex,
	keywordRanking,
	rangePoint,
	snippetOf,
	VECTOR_WEIGHT,
	vectorRanking,
	type PassageChunk,
	type PassageRef,
} from "../core/search.ts";
import { graphDirFor, scopeOfGraphStore, stores } from "./stores.ts";

const MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";
const DIMS = 384;
/** The model's instruction for queries (documents get none). */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
const EMBED_BATCH = 8;
/** How deep each ranking goes before fusion. */
const CANDIDATES = 50;
/** Most characters read_passage returns. */
const READ_LIMIT_CHARS = 6000;
/** Bump when the stored rows change shape. */
const FORMAT = 1;

// ─── the model ──────────────────────────────────────────────────────────────

interface EmbedWorker {
	worker: Worker;
	pending: Map<number, { resolve: (vectors: Float32Array) => void; reject: (err: Error) => void }>;
	next: number;
}

interface SearchGlobal {
	__lhEmbedWorker?: EmbedWorker;
	__lhSearchTables?: Map<string, Table>;
	__lhSearchLocks?: Map<string, Promise<unknown>>;
}
const G = globalThis as typeof globalThis & SearchGlobal;

/** Found from the server's working directory, like the PDF worker: the
 *  repo root in dev, the standalone dir when packaged. */
function modelsDir(): string {
	return path.join(process.cwd(), "models");
}

/** The embedding worker, started on first use. It holds the process open
 *  only while a request is pending; a crashed one is restarted next call. */
function embedWorker(): EmbedWorker {
	if (G.__lhEmbedWorker) return G.__lhEmbedWorker;
	const weights = path.join(modelsDir(), MODEL_ID, "onnx", "model_quantized.onnx");
	if (!fs.existsSync(weights)) throw new Error(`The search model is missing (${weights}). Run \`node scripts/fetch-model.mjs\`.`);
	const worker = new Worker(path.join(process.cwd(), "src", "server", "workers", "embed-worker.mjs"), {
		workerData: { modelsDir: modelsDir(), model: MODEL_ID },
	});
	const state: EmbedWorker = { worker, pending: new Map(), next: 0 };
	worker.unref();
	worker.on("message", (msg: { id: number; ok: boolean; vectors?: Float32Array; error?: string }) => {
		const waiting = state.pending.get(msg.id);
		state.pending.delete(msg.id);
		if (state.pending.size === 0) worker.unref();
		if (msg.ok) waiting?.resolve(msg.vectors!);
		else waiting?.reject(new Error(msg.error));
	});
	const fail = (err: Error) => {
		if (G.__lhEmbedWorker === state) G.__lhEmbedWorker = undefined;
		for (const waiting of state.pending.values()) waiting.reject(err);
		state.pending.clear();
	};
	worker.on("error", fail);
	worker.on("exit", (code) => fail(new Error(`The search worker stopped (code ${code})`)));
	G.__lhEmbedWorker = state;
	return state;
}

function embedBatch(texts: string[]): Promise<Float32Array> {
	const state = embedWorker();
	const id = state.next++;
	state.worker.ref();
	return new Promise((resolve, reject) => {
		state.pending.set(id, { resolve, reject });
		state.worker.postMessage({ id, texts });
	});
}

/** Normalized vectors, row after row. One batch in flight per call, so a
 *  search waits behind at most one batch of an indexing run. */
async function embed(texts: readonly string[], asQuery: boolean): Promise<Float32Array> {
	const out = new Float32Array(texts.length * DIMS);
	for (let i = 0; i < texts.length; i += EMBED_BATCH) {
		const batch = texts.slice(i, i + EMBED_BATCH).map((t) => (asQuery ? QUERY_PREFIX + t : t));
		out.set(await embedBatch(batch), i * DIMS);
	}
	return out;
}

// ─── stored tables ──────────────────────────────────────────────────────────

interface StoredPassage extends PassageChunk {
	/** `<fileId>:<n>`. */
	id: string;
	fileId: string;
	hash: string;
}

interface StoredFact {
	id: string;
	hash: string;
}

interface Table {
	rows: (StoredPassage | StoredFact)[];
	vectors: Float32Array;
	/** Passages only: each indexed file's fingerprint and size. */
	files: Record<string, { fp: string; extent: string }>;
	/** Built on first search, dropped with the table. */
	keywords?: MiniSearch;
}

const tables = (G.__lhSearchTables ??= new Map());
const locks = (G.__lhSearchLocks ??= new Map());

function searchDir(scope: ClassScope): string {
	return path.join(path.dirname(graphDirFor(scope)), "search");
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** A table from disk (cached); empty when absent, unreadable, from another
 *  model, or its two files disagree. */
function readTable(file: string): Table {
	const cached = tables.get(file);
	if (cached) return cached;
	let table: Table = { rows: [], vectors: new Float32Array(0), files: {} };
	try {
		const meta = JSON.parse(fs.readFileSync(`${file}.json`, "utf-8")) as { format: number; model: string; rows: Table["rows"]; files?: Table["files"] };
		const bytes = fs.readFileSync(`${file}.f32`);
		const vectors = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
		if (meta.format === FORMAT && meta.model === MODEL_ID && vectors.length === meta.rows.length * DIMS) {
			table = { rows: meta.rows, vectors, files: meta.files ?? {} };
		}
	} catch {
		/* not indexed yet */
	}
	tables.set(file, table);
	return table;
}

function writeTable(file: string, table: Table): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const json = JSON.stringify({ format: FORMAT, model: MODEL_ID, rows: table.rows, ...(Object.keys(table.files).length ? { files: table.files } : {}) });
	fs.writeFileSync(`${file}.f32.tmp`, Buffer.from(table.vectors.buffer, table.vectors.byteOffset, table.vectors.byteLength));
	fs.writeFileSync(`${file}.json.tmp`, json, "utf-8");
	fs.renameSync(`${file}.f32.tmp`, `${file}.f32`);
	fs.renameSync(`${file}.json.tmp`, `${file}.json`);
	tables.set(file, table);
}

/** One writer per table at a time. */
function locked<T>(file: string, fn: () => Promise<T>): Promise<T> {
	const run = (locks.get(file) ?? Promise.resolve()).then(fn, fn);
	locks.set(file, run.catch(() => undefined));
	return run;
}

/** New rows with their vectors: reused by hash from `old`, the rest embedded. */
async function withVectors<R extends { hash: string }>(old: Table, rows: R[], texts: string[]): Promise<Float32Array> {
	const known = new Map(old.rows.map((r, i) => [r.hash, i]));
	const missing = rows.map((r, i) => (known.has(r.hash) ? -1 : i)).filter((i) => i >= 0);
	const fresh = await embed(missing.map((i) => texts[i]!), false);
	const vectors = new Float32Array(rows.length * DIMS);
	missing.forEach((row, k) => vectors.set(fresh.subarray(k * DIMS, (k + 1) * DIMS), row * DIMS));
	rows.forEach((r, i) => {
		const at = known.get(r.hash);
		if (at !== undefined) vectors.set(old.vectors.subarray(at * DIMS, (at + 1) * DIMS), i * DIMS);
	});
	return vectors;
}

/** `table`'s rows that pass `keep`, with their vectors. */
function keepRows(table: Table, keep: (row: Table["rows"][number]) => boolean): { rows: Table["rows"]; vectors: Float32Array } {
	const rows: Table["rows"] = [];
	const vectors = new Float32Array(table.vectors.length);
	table.rows.forEach((row, i) => {
		if (!keep(row)) return;
		vectors.set(table.vectors.subarray(i * DIMS, (i + 1) * DIMS), rows.length * DIMS);
		rows.push(row);
	});
	return { rows, vectors: vectors.slice(0, rows.length * DIMS) };
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
	const out = new Float32Array(a.length + b.length);
	out.set(a);
	out.set(b, a.length);
	return out;
}

/** A table's best `limit` row ids for queries (vectors) and keyword text. */
function rank(table: Table, queries: Float32Array[], keywordQuery: string, keywords: MiniSearch, limit: number): string[] {
	const depth = Math.max(CANDIDATES, limit);
	const byVector = vectorRanking(queries, table.vectors, DIMS, depth).map((i) => table.rows[i]!.id);
	return fuseRankings([
		{ ids: byVector, weight: VECTOR_WEIGHT },
		{ ids: keywordRanking(keywords, keywordQuery, depth), weight: KEYWORD_WEIGHT },
	]).slice(0, limit);
}

// ─── class files ────────────────────────────────────────────────────────────

const passagesFile = (classId: string) => path.join(searchDir(classId), "passages");

/** Drop a deleted class's tables from memory: nothing reads them again.
 *  Its locks stay, so an index run still in flight keeps its order. */
export function forgetClassSearch(classId: string): void {
	tables.delete(passagesFile(classId));
	tables.delete(path.join(searchDir(classId), "facts"));
}

/** True when this version of the file is in the class's index. */
export function isFileIndexed(classId: string, fileId: string, fp: string): boolean {
	return readTable(passagesFile(classId)).files[fileId]?.fp === fp;
}

/** Each indexed file's size ("98 pages", "52 min", "420 lines"). */
export function fileExtents(classId: string): Record<string, string> {
	return Object.fromEntries(Object.entries(readTable(passagesFile(classId)).files).map(([id, f]) => [id, f.extent]));
}

/** Put one version of a class file in its class's index, replacing the
 *  old one. `text` is what search reads: a PDF's page-headed text, a
 *  caption file's raw cues, or plain text. */
export function indexClassFile(classId: string, file: { id: string; name: string }, fp: string, text: string): Promise<void> {
	const at = passagesFile(classId);
	return locked(at, async () => {
		const old = readTable(at);
		if (old.files[file.id]?.fp === fp) return;
		const { chunks, extent } = chunkFile(file.name, text);
		const rows: StoredPassage[] = chunks.map((c, n) => ({ id: `${file.id}:${n + 1}`, fileId: file.id, ...c, hash: hashOf(c.text) }));
		const vectors = await withVectors(old, rows, rows.map((r) => r.text));
		// Deleted while embedding: never recreate its folder.
		if (!stores.classStore.getClass(classId)) return;
		const rest = keepRows(old, (r) => (r as StoredPassage).fileId !== file.id);
		writeTable(at, { rows: [...rest.rows, ...rows], vectors: concat(rest.vectors, vectors), files: { ...old.files, [file.id]: { fp, extent } } });
	});
}

/** Take a removed file out of its class's index. */
export function dropClassFile(classId: string, fileId: string): Promise<void> {
	const at = passagesFile(classId);
	return locked(at, async () => {
		const old = readTable(at);
		if (!old.files[fileId]) return;
		const rest = keepRows(old, (r) => (r as StoredPassage).fileId !== fileId);
		const { [fileId]: _gone, ...files } = old.files;
		writeTable(at, { ...rest, files });
	});
}

function classFiles(classId: string) {
	return stores.classStore.getClass(classId)?.files ?? [];
}

function fileNames(classId: string): Map<string, string> {
	return new Map(classFiles(classId).map((f) => [f.id, f.name]));
}

/** The best passages for a query, as compact lines: id, file, place, snippet. */
export async function searchClassFiles(classId: string, query: string, limit: number): Promise<string> {
	const table = readTable(passagesFile(classId));
	if (table.rows.length === 0) return "No class files are indexed for search yet (files are indexed once their text is read).";
	const queryVector = await embed([query], true);
	table.keywords ??= keywordIndex((table.rows as StoredPassage[]).map((r) => ({ id: r.id, text: r.text })));
	const byId = new Map((table.rows as StoredPassage[]).map((r) => [r.id, r]));
	const hits = rank(table, [queryVector], query, table.keywords, limit);
	const names = fileNames(classId);
	const files = classFiles(classId);
	const indexed = files.filter((f) => table.files[f.id]).length;
	const lines = [`Top ${hits.length} of ${table.rows.length} passages for "${query}":`];
	if (indexed < files.length) lines.unshift(`(Searching ${indexed} of the class's ${files.length} files; the others are not indexed yet.)`);
	for (const id of hits) {
		const p = byId.get(id)!;
		lines.push(`${p.id} · ${names.get(p.fileId) ?? p.fileId} · ${p.range}`, `  ${snippetOf(p.text, query)}`);
	}
	lines.push("Open one with read_passage.");
	return lines.join("\n");
}

function splitRows(vectors: Float32Array): Float32Array[] {
	return Array.from({ length: vectors.length / DIMS }, (_, i) => vectors.subarray(i * DIMS, (i + 1) * DIMS));
}

/** A passage's text (a whole page when opened by file and place) with its
 *  file, place and the ids of its neighbors. */
export function readPassage(classId: string, ref: PassageRef): string {
	const rows = readTable(passagesFile(classId)).rows as StoredPassage[];
	let picked: StoredPassage[];
	if ("passageId" in ref) {
		const one = rows.find((r) => r.id === ref.passageId);
		if (!one) return `No passage "${ref.passageId}". Ids come from search_class_files.`;
		picked = [one];
	} else {
		const point = rangePoint(ref.range);
		picked = point === null ? [] : rows.filter((r) => r.fileId === ref.fileId && r.from <= point && point <= r.to);
		if (picked.length === 0) return `No passage of file "${ref.fileId}" at "${ref.range}".`;
	}
	const inFile = rows.filter((r) => r.fileId === picked[0]!.fileId);
	const first = inFile.indexOf(picked[0]!);
	const last = inFile.indexOf(picked.at(-1)!);
	const prev = inFile[first - 1]?.id;
	const next = inFile[last + 1]?.id;
	const name = fileNames(classId).get(picked[0]!.fileId) ?? picked[0]!.fileId;
	let text = picked.map((r) => r.text).join("\n");
	if (text.length > READ_LIMIT_CHARS) text = `${text.slice(0, READ_LIMIT_CHARS)}\n[cut at ${READ_LIMIT_CHARS} characters]`;
	const ids = picked.length === 1 ? picked[0]!.id : `${picked[0]!.id} to ${picked.at(-1)!.id}`;
	const steps = [prev ? `previous: ${prev}` : "first passage of the file", next ? `next: ${next}` : "last passage of the file"].join(" · ");
	return `${name} · ${picked[0]!.range} · ${ids}\n(${steps})\n\n${text}`;
}

// ─── facts ──────────────────────────────────────────────────────────────────

const factText = (n: GraphNode) => `${n.name}: ${n.statement}`;

/** The scope's fact table brought up to date with `nodes` (new or changed
 *  facts embedded now: facts arrive between parts of one import). */
function currentFacts(scope: ClassScope, nodes: readonly GraphNode[]): Promise<Table> {
	const at = path.join(searchDir(scope), "facts");
	return locked(at, async () => {
		const old = readTable(at);
		const rows: StoredFact[] = nodes.map((n) => ({ id: n.id, hash: hashOf(`${factText(n)}\n${n.aliases.join("\n")}`) }));
		const same = rows.length === old.rows.length && rows.every((r, i) => r.hash === old.rows[i]!.hash && r.id === old.rows[i]!.id);
		const table = same ? old : { rows, vectors: await withVectors(old, rows, nodes.map(factText)), files: {} };
		if (!same) writeTable(at, table);
		table.keywords ??= keywordIndex(nodes.map((n) => ({ id: n.id, text: [n.name, n.statement, ...n.aliases].join(" ") })));
		return table;
	});
}

/** Ids of the scope's facts (`nodes`, its graph's merged nodes) best
 *  matching a query, at most `limit`. */
export async function searchFacts(scope: ClassScope, nodes: readonly GraphNode[], query: string, limit: number): Promise<string[]> {
	if (nodes.length === 0) return [];
	const [table, queryVector] = await Promise.all([currentFacts(scope, nodes), embed([query], true)]);
	return rank(table, [queryVector], query, table.keywords!, limit);
}

/**
 * The existing facts most related to a passage of new material (graph
 * building shows the extractor these). The passage is longer than the
 * model reads, so it is cut into ~300-token windows; a fact scores its best
 * window. Empty for a store this server did not build.
 */
export async function relatedFacts(graphStore: GraphStore, text: string, limit: number): Promise<string[]> {
	const scope = scopeOfGraphStore(graphStore);
	if (scope === undefined) return [];
	const nodes = getGraph(graphStore).nodes;
	if (nodes.length === 0) return [];
	const windows = chunkText(text).chunks.map((c) => c.text);
	if (windows.length === 0) return [];
	const [table, windowVectors] = await Promise.all([currentFacts(scope, nodes), embed(windows, true)]);
	return rank(table, splitRows(windowVectors), text, table.keywords!, limit);
}
