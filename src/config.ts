import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file is at <root>/src/config.ts — one level up). */
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * THE data-location seam (the Electron contract, 2026-09-17): LH_DATA_DIR
 * relocates every MUTABLE record — chat sessions, graph ledgers, the
 * embedding model cache — when set. The desktop shell points it at
 * userData so nothing is written inside the read-only .app bundle
 * (macOS translocation guarantees the bundle is read-only anyway).
 * Unset (plain web dev / repo work) it resolves to the repo's data/,
 * byte-for-byte as before. Read-only assets (prompts) stay ROOT-anchored
 * on purpose: they ship inside the app bundle by design.
 */
const DATA_ROOT = process.env.LH_DATA_DIR
	? path.resolve(process.env.LH_DATA_DIR)
	: path.join(ROOT, "data");

export const PATHS = {
	root: ROOT,
	/** Teacher system prompt — the agent's instructions (src/agent/). */
	teacherPrompt: path.join(ROOT, "src", "agent", "system-prompt.md"),
	data: DATA_ROOT,
	/** Chat sessions (AI SDK UIMessage transcripts, one JSON file per chat). */
	chats: path.join(DATA_ROOT, "chats"),
	graph: path.join(DATA_ROOT, "graph"),
	/** Classes (classes wave, 2026-10-26): one folder per class —
	 *  classes/<id>/class.json (the record), files/ (copied class files),
	 *  graph/ (that class's own graph family, same files as PATHS.graph). */
	classes: path.join(DATA_ROOT, "classes"),
	/** Debug artifacts (env-gated). */
	debug: path.join(DATA_ROOT, "debug"),
} as const;

// ─── Models ────────────────────────────────────────────────────────────────
// There are no model settings: every engine is the outside agent (MCP),
// which picks its own model in its own harness (owner, 2026-10-27).

/** Every agent role in the app (each one's work goes to the outside agent). */
export type ModelRole =
	| "prober"
	| "teacher"
	| "researcher"
	| "demoBuilder"
	| "visualMaker"
	| "pdfReader"
	| "extractor"
	| "topicGrouper";

/**
 * The LIVE graph store (src/store/graph.ts) — owned by the app's extraction
 * pipeline. Line shapes: src/core/contracts.ts. CHAINS ARE THE STORED
 * TRUTH (owner, 2026-09-30): edges are a derived view, never stored.
 */
export interface GraphFiles {
	nodes: string;
	chains: string;
	sessions: string;
	/** Per-message extraction coverage (contracts/graph.ts CoverageEntry;
	 *  the checkpoint's replacement for chat extractions — notes keep
	 *  sessions.jsonl, whole-file as they are). */
	coverage: string;
	/** Notes-import bookkeeping (NOT a ledger): one JSON map, src-id →
	 *  NotesSource record (contracts/graph.ts) — the file path + import time
	 *  + the run's usage log. Read-modify-write like a chat file. */
	sources: string;
	/** The graph-family FORMAT STAMP sidecar (see GRAPH_FORMAT_FILE). */
	format: string;
	/** The topic grouper's ledger (contracts/graph.ts TopicSnapshot):
	 *  append-only, each line a full snapshot; readers take the last. */
	topics: string;
}

/** Every file of one graph family rooted at `dir` (classes wave,
 *  2026-10-26): the "No class" graph lives at PATHS.graph, each class's
 *  graph at PATHS.classes/<id>/graph — same layout, same adapter. */
export function graphFilesIn(dir: string): GraphFiles {
	return {
		nodes: path.join(dir, "nodes.jsonl"),
		chains: path.join(dir, "chains.jsonl"),
		sessions: path.join(dir, "sessions.jsonl"),
		coverage: path.join(dir, "coverage.jsonl"),
		sources: path.join(dir, "sources.json"),
		format: path.join(dir, "format.json"),
		topics: path.join(dir, "topics.jsonl"),
	};
}

const NO_CLASS_GRAPH = graphFilesIn(PATHS.graph);

export const LEDGER_FILES = {
	nodes: NO_CLASS_GRAPH.nodes,
	chains: NO_CLASS_GRAPH.chains,
	sessions: NO_CLASS_GRAPH.sessions,
	coverage: NO_CLASS_GRAPH.coverage,
	topics: NO_CLASS_GRAPH.topics,
} as const;

export const SOURCES_FILE = NO_CLASS_GRAPH.sources;

/** The graph-family FORMAT STAMP sidecar (schema-versioning wave,
 *  2026-10-10): one version for the whole family — the JSONL ledgers and
 *  sources.json. LAZY v1: absent = v1; the first graph-family write
 *  creates it. */
export const GRAPH_FORMAT_FILE = NO_CLASS_GRAPH.format;

/**
 * THE USER SETTINGS RECORD (settings-storage wave, 2026-09-19): one
 * versioned, DELTA-shaped JSON blob at the data-dir seam holding every
 * non-secret product preference — general, agent (tool toggles +
 * prompt-override switches), appearance, graph. Explicit user choices only: ABSENT keys resolve to the
 * factory defaults compiled into src/core/settings.ts (FACTORY_SETTINGS), so
 * a software update that adds a knob (new tool, new role, new appearance
 * field) needs no migration — old records simply lack the new keys. The
 * version field is a PRIVATE schema counter for breaking shape changes
 * only (field renamed/meaning changed), unrelated to the app release
 * version. Secrets NEVER live here. (The `chat` and `models` sections
 * died with the built-in sign-ins, owner 2026-10-27.)
 */
export const SETTINGS_FILE = path.join(DATA_ROOT, "settings.json");

/**
 * User prompt-override files (settings-storage wave, 2026-09-19): the
 * per-segment system-prompt overrides mirroring the SOURCE layout
 * (src/agent/prompts/) — the shared base as prompts/system-prompt.md,
 * fragments as prompts/teacher/<file> / prompts/prober/<file>. A file
 * that exists is the learner's version and is used. The segment list itself is ALWAYS derived from source at runtime (the
 * loader in src/store/prompt-overrides.ts) — code updates that add,
 * remove, or reorder fragments adapt automatically; an override keyed to
 * a vanished segment stops composing but stays on disk.
 */
export const PROMPTS_OVERRIDE_DIR = path.join(DATA_ROOT, "prompts");
