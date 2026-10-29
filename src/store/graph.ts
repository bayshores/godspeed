/**
 * GraphStore — the fs JSONL adapter: the append-only ledgers at
 * config.LEDGER_FILES (contracts.ts "v1 emission").
 *   nodes.jsonl     GraphNode        — one line per node write: the FIRST
 *                                      line for an id defines it; a later
 *                                      line with a REPEATED id is a
 *                                      link-append (session phrasings join
 *                                      aliases, provenance unions); reads
 *                                      merge by id (core/graph.ts getGraph)
 *   chains.jsonl    GraphChain       — one line per chain ASSERTION (a second
 *                                      session asserting the same
 *                                      (premises, conclusion) appends
 *                                      another line; readers merge)
 *   sessions.jsonl  SessionCheckpoint— emission checkpoints (foldedAt)
 *   coverage.jsonl  CoverageEntry    — per-message extraction coverage
 *   topics.jsonl    TopicSnapshot    — the topic grouper's full snapshots
 *                                      (redesign 2026-10-27); readers take
 *                                      the LAST valid line
 *
 * CHAINS-PRIMARY (owner, 2026-09-30): there is NO edges ledger — the edge
 * view (implication nodes + untyped arrows) is derived in core/graph.ts on
 * every read and never persisted. A stale edges.jsonl left by a pre-chains
 * build is deleted once, here, at adapter load (same doctrine as the
 * events-ledger purge below).
 *
 * Plus config.SOURCES_FILE (sources.json): the imported-notes bookkeeping
 * (NOT a ledger) — one JSON map, src-id → NotesSource, read-modify-write
 * like a chat file. The format-agnostic front door (2026-09-13).
 *
 * Implements core/ports.ts GraphStore. data/graph/* is exclusively this
 * adapter's. Reads are strict against the contracts.ts shapes (the 2026-09-02
 * graph redesign): corrupt lines are skipped, never guessed at — the ledgers
 * are the source of truth and everything else is derived (core/graph.ts,
 * which takes this port as a parameter). Same idioms as src/store/chats.ts:
 * sync fs, no framework.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { LEDGER_FILES, PATHS, graphFilesIn, type GraphFiles } from "../config.ts";
import { assertGraphFormat, ensureGraphFormat } from "./graph-format.ts";
import { isRecord, isString } from "./guards.ts";
import type {
	GraphChain,
	GraphNode,
	ExtractionRunUsage,
	NotesSource,
	ProvenancePoint,
	CoverageEntry,
	SessionCheckpoint,
	GraphTopic,
	TopicSnapshot,
} from "../core/contracts.ts";
import type { GraphStore } from "../core/ports.ts";

// ─── JSONL primitives ────────────────────────────────────────────────────────

function appendLine<T>(files: GraphFiles, file: string, record: T): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	ensureGraphFormat(files.format); // the lazy format stamp (graph-format.ts)
	ledgerCache.delete(file);
	fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf-8");
}

/** Parsed ledgers kept in memory (speed plan, owner 2026-10-27): every graph
 *  read re-parsed whole JSONL files. A cached parse is reused while the
 *  file's size and modified-time are unchanged; this module's own writes
 *  also drop it. Cached records are SHARED — callers must never mutate
 *  them (frozen under tests so a mutation fails loudly). */
const ledgerCache = new Map<string, { mtimeMs: number; size: number; lines: readonly unknown[] }>();

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
}

function readRawLines(file: string): readonly unknown[] {
	let st: fs.Stats;
	try {
		st = fs.statSync(file);
	} catch {
		ledgerCache.delete(file);
		return []; // no ledger yet — nothing has ever been emitted
	}
	const hit = ledgerCache.get(file);
	if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.lines;
	const lines = parseRawLines(file);
	if (process.env.NODE_ENV === "test") deepFreeze(lines);
	ledgerCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, lines });
	return lines;
}

function parseRawLines(file: string): unknown[] {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf-8");
	} catch {
		return []; // no ledger yet — nothing has ever been emitted
	}
	const out: unknown[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			out.push(JSON.parse(trimmed));
		} catch {
			// Corrupt line: skip rather than fail the whole read — a torn
			// append must never take the home graph down with it.
		}
	}
	return out;
}

/** Strict shape guards — anything not matching a W4 ledger shape is skipped. */
function readValid<T>(files: GraphFiles, file: string, isValid: (v: unknown) => v is T): T[] {
	assertGraphFormat(files.format); // honest refusal on a newer-stamped data dir
	return readRawLines(file).filter(isValid);
}

/** Provenance points are (chatId, messageId) pairs — message-granular. */
const isProvenancePoint = (v: unknown): v is ProvenancePoint =>
	isRecord(v) && isString(v.chatId) && isString(v.messageId);


const isGraphNode = (v: unknown): v is GraphNode =>
	isRecord(v) &&
	isString(v.id) &&
	isString(v.name) &&
	isString(v.statement) &&
	Array.isArray(v.aliases) &&
	v.aliases.every(isString) &&
	isString(v.createdAt) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint);

/** A chain line: premises ≥ 1 (a chain IS an argument — bare propositions
 *  ride the node ledger alone), every member a string, conclusion a string.
 *  Endpoint EXISTENCE is the derivation's concern (it drops dangling
 *  chains); the store only shapes. */
const isGraphChain = (v: unknown): v is GraphChain =>
	isRecord(v) &&
	isString(v.id) &&
	Array.isArray(v.premises) &&
	v.premises.length > 0 &&
	v.premises.every(isString) &&
	isString(v.conclusion) &&
	Array.isArray(v.provenance) &&
	v.provenance.every(isProvenancePoint) &&
	isString(v.createdAt);

const isCheckpoint = (v: unknown): v is SessionCheckpoint =>
	isRecord(v) && isString(v.chatId) && isString(v.foldedAt);

const isTopic = (v: unknown): v is GraphTopic =>
	isRecord(v) && isString(v.id) && isString(v.name) && Array.isArray(v.members) && v.members.every(isString);

const isTopicSnapshot = (v: unknown): v is TopicSnapshot =>
	isRecord(v) && isString(v.at) && Array.isArray(v.topics) && v.topics.every(isTopic);

const isCoverageEntry = (v: unknown): v is CoverageEntry =>
	isRecord(v) && isString(v.chatId) && isString(v.fp) && typeof v.tokens === "number" && isString(v.foldedAt);

// ─── the port implementation ────────────────────────────────────────────────

/** One graph family's store, rooted at `files` (classes wave, 2026-10-26:
 *  the "No class" graph and every class graph share this adapter — only
 *  the folder differs). */
export function createGraphStore(files: GraphFiles): GraphStore {
	return {
		appendNode(node: GraphNode): void {
			appendLine(files, files.nodes, node);
		},
		/** Raw node lines in append order. A node id may appear on more than
		 *  one line (a later session's LINK-append: phrasings + provenance); the
		 *  derivation (core/graph.ts getGraph) merges lines by id. */
		readNodes(): GraphNode[] {
			return readValid(files, files.nodes, isGraphNode);
		},

		/** Append one chain ASSERTION; readers merge lines by (premises,
		 *  conclusion). */
		appendChain(assertion: GraphChain): void {
			appendLine(files, files.chains, assertion);
		},
		readChains(): GraphChain[] {
			return readValid(files, files.chains, isGraphChain);
		},

		appendCheckpoint(checkpoint: SessionCheckpoint): void {
			appendLine(files, files.sessions, checkpoint);
		},
		readCheckpoints(): SessionCheckpoint[] {
			return readValid(files, files.sessions, isCheckpoint);
		},

		appendCoverage(entry: CoverageEntry): void {
			appendLine(files, files.coverage, entry);
		},
		readCoverage(): CoverageEntry[] {
			return readValid(files, files.coverage, isCoverageEntry);
		},

		readTopics(): TopicSnapshot | null {
			const lines = readValid(files, files.topics, isTopicSnapshot);
			return lines.at(-1) ?? null;
		},
		appendTopics(snapshot: TopicSnapshot): void {
			appendLine(files, files.topics, snapshot);
		},

		// ── imported-notes bookkeeping (config.SOURCES_FILE — a JSON map) ──

		/** Upsert: keeps the existing record's usage log when re-importing. */
		upsertSource(source: NotesSource): void {
			const all = readSourceMap(files);
			const prev = all[source.id];
			all[source.id] = prev ? { ...source, extractions: prev.extractions } : source;
			writeSourceMap(files, all);
		},
		readSources(): NotesSource[] {
			return Object.values(readSourceMap(files));
		},
		removeSource(id: string): boolean {
			const all = readSourceMap(files);
			if (!(id in all)) return false;
			delete all[id];
			writeSourceMap(files, all);
			return true;
		},
		/** Idempotent per startedAt — same discipline as chats.appendExtractionUsage. */
		appendSourceUsage(id: string, entry: ExtractionRunUsage): void {
			const all = readSourceMap(files);
			const source = all[id];
			if (!source) return; // no such source — nothing to bill against
			source.extractions = source.extractions?.some((r) => r.startedAt === entry.startedAt)
				? source.extractions
				: [...(source.extractions ?? []), entry];
			writeSourceMap(files, all);
		},

		/** THE DESTRUCTIVE SEAM (wave 6 session deletion): atomic full-content
		 *  replacement per provided ledger — write a uniquely-named temp file
		 *  beside the ledger, then rename over it (POSIX-atomic: a crash mid-
		 *  write leaves the original ledger and an orphan .tmp-*, never a torn
		 *  ledger). Empty arrays write an empty file — a purged ledger reads
		 *  as "nothing yet", same as never-emitted. */
		rewriteLedgers(next: {
			nodes?: GraphNode[];
			chains?: GraphChain[];
			coverage?: CoverageEntry[];
			checkpoints?: SessionCheckpoint[];
		}): void {
			const ledgers = {
				nodes: files.nodes,
				chains: files.chains,
				coverage: files.coverage,
				checkpoints: files.sessions,
			} as const;
			for (const [key, records] of Object.entries(next) as [keyof typeof ledgers, unknown[]][]) {
				const file = ledgers[key];
				fs.mkdirSync(path.dirname(file), { recursive: true });
				const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
				ledgerCache.delete(file);
				try {
					// JSONL: one record per line, trailing newline — a reader
					// must see exactly what appendLine would have written.
					const body = records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : "");
					fs.writeFileSync(tmp, body, "utf-8");
					fs.renameSync(tmp, file);
				} catch (err) {
					try {
						fs.unlinkSync(tmp);
					} catch {
						/* the rename either already happened or the tmp never existed */
					}
					throw err;
				}
			}
		},
	};
}

/** The "No class" graph (data/graph) — today's graph, untouched. */
export const graphStore: GraphStore = createGraphStore(graphFilesIn(PATHS.graph));

/** sources.json — { id: NotesSource }. Read-modify-write, NOT append-only:
 *  the usage log lives inside the record (like a chat's JSON file). */
function readSourceMap(files: GraphFiles): Record<string, NotesSource> {
	assertGraphFormat(files.format); // honest refusal on a newer-stamped data dir
	let raw: string;
	try {
		raw = fs.readFileSync(files.sources, "utf-8");
	} catch {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return {};
		const out: Record<string, NotesSource> = {};
		for (const [id, value] of Object.entries(parsed)) {
			if (isNotesSource(value)) out[id] = value;
		}
		return out;
	} catch {
		return {};
	}
}

function writeSourceMap(files: GraphFiles, map: Record<string, NotesSource>): void {
	fs.mkdirSync(path.dirname(files.sources), { recursive: true });
	ensureGraphFormat(files.format); // the lazy format stamp (graph-format.ts)
	fs.writeFileSync(files.sources, JSON.stringify(map, null, "\t"), "utf-8");
}

// ─── one-way purges at adapter load: dead ledgers are exactly the confusion
// the cleanup removes (owner doctrine — nothing reads them, nothing writes
// them, a stale file lying around is a lie). ────────────────────────────────
{
	const graphDir = path.dirname(LEDGER_FILES.nodes);
	for (const legacy of ["edges.jsonl", "events.jsonl"]) {
		const file = path.join(graphDir, legacy);
		try {
			if (fs.existsSync(file)) {
				fs.rmSync(file);
				console.info(`[graph-store] purged legacy ledger: ${file}`);
			}
		} catch (err) {
			console.warn(`[graph-store] could not purge legacy ledger ${file}:`, err);
		}
	}
}

const isNotesSource = (v: unknown): v is NotesSource =>
	isRecord(v) && isString(v.id) && isString(v.filePath) && isString(v.importedAt);
