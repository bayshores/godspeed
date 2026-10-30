import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file is at <root>/src/config.ts — one level up). */
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * LH_DATA_DIR moves every mutable record (chats, graph ledgers, the
 * embedding model cache). The desktop app points it at userData because the
 * .app bundle is read-only. Unset, it is the repo's data/. Read-only assets
 * (prompts) stay under ROOT because they ship inside the bundle.
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
	/** One folder per class:
	 *  classes/<id>/class.json (the record), files/ (copied class files),
	 *  graph/ (that class's own graph family, same files as PATHS.graph). */
	classes: path.join(DATA_ROOT, "classes"),
} as const;

// ─── Models ────────────────────────────────────────────────────────────────
// There are no model settings: every engine is the outside agent (MCP),
// which picks its own model in its own harness.

/** Every helper job role (each one's work goes to the outside agent). */
export type ModelRole =
	| "researcher"
	| "demoBuilder"
	| "visualMaker"
	| "pdfReader"
	| "extractor";

/**
 * The LIVE graph store (src/store/graph.ts) — owned by the app's extraction
 * pipeline. Line shapes: src/core/contracts.ts. Chains are the stored
 * truth: edges are a derived view, never stored.
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

/** Every file of one graph family rooted at `dir`: the "No class" graph lives at PATHS.graph, each class's
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

/** The graph-family format stamp sidecar: one version for the whole family — the JSONL ledgers and
 *  sources.json. LAZY v1: absent = v1; the first graph-family write
 *  creates it. */
export const GRAPH_FORMAT_FILE = NO_CLASS_GRAPH.format;

/**
 * The user settings record: a versioned JSON delta holding only the
 * learner's explicit choices. Absent keys resolve to FACTORY_SETTINGS
 * (src/core/settings.ts), so an update that adds a setting needs no
 * migration. The version field counts breaking shape changes only, not app
 * releases. Secrets never live here.
 */
export const SETTINGS_FILE = path.join(DATA_ROOT, "settings.json");

/**
 * User prompt-override files, mirroring the source layout
 * (src/agent/prompts/). A file that exists is the learner's version and is
 * used. The segment list is always derived from source at runtime
 * (src/store/prompt-overrides.ts), so an override for a removed segment
 * stops applying but stays on disk.
 */
export const PROMPTS_OVERRIDE_DIR = path.join(DATA_ROOT, "prompts");
