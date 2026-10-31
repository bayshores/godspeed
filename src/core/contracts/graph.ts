/**
 * Knowledge-graph contracts — nodes, ledgers, extraction findings
 *
 * The graph vision (docs/vision.md §1): every node is a TRUE proposition;
 * provenance is message-granular; extraction is post-hoc, decoupled from
 * the session's plan tree. The graph holds the reasoning chains from all
 * lessons (and imported notes) and nothing else: no quiz outcomes, no
 * understanding assessments.
 *
 * Pure types + protocol docs + tiny pure helpers.
 */
// ─── Knowledge graph (vision §1 — global, cross-session) ────────────────────

import type { ExtractionRunUsage } from "./chat.ts";

/** One relation of the DERIVED view. Chains are the stored truth, and
 *  the snapshot derives UNTYPED arrows from them: every premise → the
 *  chain's implication node, the implication node → the conclusion.
 *  Nothing stores or mutates these — they are rebuilt after every change
 *  and never converted back. */
export interface GraphEdge {
	from: string;
	to: string;
}

/** One stored REASONING CHAIN — an argument: premises that JOINTLY entail
 *  the conclusion. Independent arguments
 *  for the same conclusion are separate chains (they may share `conclusion`);
 *  co-premises within one chain are used TOGETHER. The snapshot derives an
 *  implication NODE per chain (id = the chain id — the arg_ namespace is its
 *  own, collision-free with n_) plus untyped edges premises → imp →
 *  conclusion. A chain referencing a dead node dies with it (full death
 *  cascades through every referencing chain). */
export interface GraphChain {
	/** "arg_" + nanoid-like (store-assigned, the node-minting pattern). */
	id: string;
	/** Node ids of the argument's premises — at least one, jointly
	 *  sufficient. Extractor-local at the wire; node ids after resolution. */
	premises: string[];
	/** The node id the premises jointly imply. */
	conclusion: string;
	/** Every (chat, message) point where this argument was asserted —
	 *  unioned across assertion lines at read time. */
	provenance: ProvenancePoint[];
	createdAt: string;
}

/** What one extraction run merged into the graph ledgers — the merger's
 *  output, also persisted in extraction-run usage records (contracts/chat).
 *  `chains` is OPTIONAL IN OLD RECORDS ONLY: usage history from the
 *  pre-chains era carries `edges` instead — tolerated at read, never
 *  written again. */
export interface EmissionStats {
	/** New graph nodes appended. */
	nodes: number;
	/** New reasoning chains appended. */
	chains?: number;
	/** Chains the simplification pass removed in this merge
	 *  (already derivable through the kept chains). Maintenance, not extraction: appends are counted in `chains`
	 *  regardless. Undefined when nothing dropped (pre-simplification
	 *  records read as zero). */
	droppedChains?: number;
}

/** One provenance point — message-granular: nodes and
 *  edges record every (chat, message) where they came up, deep-linkable to
 *  the exact transcript point. */
export interface ProvenancePoint {
	/** The chat this point anchors to — or a notes source id ("src_…"):
	 *  imports carry no message anchors (provenance is the file itself,
	 *  recorded through the mapping line + the source record). */
	chatId: string;
	messageId: string;
}

/** One imported notes file — the format-agnostic front door's bookkeeping:
 *  personal notes in ARBITRARY formats run through the
 *  same extractor → merger pipeline, with the file itself as the
 *  provenance anchor. There is no chat: the detail card shows the file path
 *  as a STATIC entry (not a link). The run's usage log lives here,
 *  mirroring ChatRecord.extractions. Ids are "src_" + hash of the file
 *  path — deterministic, so re-importing the same file re-runs extraction
 *  against the same source id (mappings dedupe by it). */
export interface NotesSource {
	id: string;
	filePath: string;
	/** ISO — when this file was imported (the checkpoint's foldedAt). */
	importedAt: string;
	/** Legacy content fingerprint. Accepted when reading old records, but
	 * ignored: every explicit notes import processes the whole file. New
	 * imports do not compute or write this field. No migration is needed. */
	contentFp?: string;
	/** The run's usage log — same append-only discipline as
	 *  ChatRecord.extractions, idempotent per startedAt. */
	extractions?: ExtractionRunUsage[];
}

/** One topic: a named group of a graph's facts. Named by the topic grouper (a background model
 *  job) in the course's own terms. */
export interface GraphTopic {
	/** "tpc_" + 10 hex — stable across regroupings (the grouper keeps ids). */
	id: string;
	/** 1–4 words: "Expected value", "Conditional probability". */
	name: string;
	/** Fact (GraphNode) ids. */
	members: string[];
}

/** One line of topics.jsonl — append-only, each line a FULL snapshot of the
 *  graph's topics. Readers take the last valid line, drop members that are
 *  no longer facts, and treat facts in no topic as "Ungrouped". */
export interface TopicSnapshot {
	/** ISO — when the grouper wrote it. */
	at: string;
	topics: GraphTopic[];
}

/** The graph-family format version this build writes and understands
 *  (the format.json sidecar — src/store/graph-format.ts). */
export const CURRENT_GRAPH_FORMAT_VERSION = 1;


export interface GraphNode {
	/** Opaque stable id, store-assigned: "n_" + nanoid-like. */
	id: string;
	/** A very short label for the node — a compact handle like a glossary
	 *  headword ("Will to power", "Divine command theory"): what the graph
	 *  shows at a glance. Presentational only — not unique, not an identity
	 *  key, never precise: the statement carries the precision. Set at
	 *  creation (first line defines); a link-append never changes it. */
	name: string;
	/** The minimal proposition — one true, self-contained statement, at
	 *  full precision. The extractor recognizes a re-taught idea by
	 *  judgment against this, not by string matching. Shown in the detail
	 *  card; the canvas label is the name. */
	statement: string;
	/** Verbatim phrasings sessions used for this proposition (the identity
	 *  audit trail — how the world said what the node says). */
	aliases: string[];
	createdAt: string;
	/** Every (chat, message) point where this proposition came up. */
	provenance: ProvenancePoint[];
}

/** sessions.jsonl line — the emission checkpoint for one chat (which chats
 *  have been folded, and through which updatedAt — never fold twice). */
export interface SessionCheckpoint {
	chatId: string;
	/** The chat record's `updatedAt` at the time of the fold. */
	foldedAt: string;
}

/** coverage.jsonl line: ONE MESSAGE of one chat has been extracted — by content fingerprint over
 *  exactly what the extraction view sees. The MESSAGE is the unit of
 *  coverage; "uncovered" is derived (fingerprint the current transcript,
 *  diff) — never dual-tracked. Only a change to the message's teacher
 *  prose changes its fingerprint and re-opens it, and only it. Chat extractions write these instead of whole-chat checkpoints;
 *  notes imports keep the checkpoint (a file is one shot). */
export interface CoverageEntry {
	chatId: string;
	/** sha256 of the message's view lines — "covered" means exactly this. */
	fp: string;
	/** chars/4 estimate of the message's view — display + budgeting. */
	tokens: number;
	/** ISO — when this message's last extraction run merged. */
	foldedAt: string;
}

/**
 * Store format (src/store/graph.ts): JSONL ledgers at config.LEDGER_FILES
 * (nodes/chains/sessions/coverage/topics), all append-only. Edges are NEVER stored — the
 * derived view (implication nodes + untyped arrows) is rebuilt from chains
 * on every read.
 *
 *   nodes.jsonl    one line per node — the FIRST line for an id defines
 *                  name/statement/createdAt; later lines for the
 *                  same id are link-appends (a session's re-encounter):
 *                  their statements/aliases join `aliases`, their
 *                  provenance unions; the name stays the first line's.
 *                  getGraph merges by id.
 *   chains.jsonl   one line per chain ASSERTION; readers merge by
 *                  (premises, conclusion), unioning provenance — the
 *                  first line's arg_ id is the chain's identity.
 *
 * The derived graph is rebuilt by reading the ledgers — store events,
 * derive state. sessions.jsonl is the extraction checkpoint: which chats
 * the extraction pipeline has processed, and through which updatedAt
 * (never extract the same turns twice).
 *
 * The EXTRACTION PIPELINE is the sole graph writer (extractor → merger):
 * the extractor reads one stretch of a source next to that source's
 * earlier findings and the related ideas the graph already holds, and
 * submits new ideas, chains and the existing ideas it re-teaches; the
 * merger (core/graph.ts, deterministic) appends them.
 */

// ─── Extraction findings (extractor output → merger input) ───────────────────

/** One proposed proposition — a node candidate (or a re-encounter of one). */
export interface ExtractedProposition {
	/** Extractor-local id ("p1", …) referenced by edges. */
	id: string;
	/** A very short label — a few words, a compact handle like a glossary
	 *  headword. Not a sentence, needn't be unique or self-contained: the
	 *  statement carries the precision. Becomes the node's name on create;
	 *  on link, the existing node keeps its name. */
	name: string;
	/** The minimal proposition — a true, self-contained, world-facing
	 *  statement, at full precision. No learner / teacher / session
	 *  references: misconceptions are stated as the true correction, and
	 *  wrongness is never recorded in the graph. */
	statement: string;
	/** Verbatim phrasings the session used. */
	aliases: string[];
	/** OPTIONAL, SESSION PATH ONLY: the message id of
	 *  the ONE teacher passage this proposition came from — the extractor
	 *  copies it from the view's "TEACHER [id]" label (core/coverage.ts
	 *  messageViewLines) and the submit seam validates it against the
	 *  CURRENT batch. The merger stamps it into the node's provenance
	 *  point {chatId, messageId} (new nodes AND link-appends); chains
	 *  stay chat-level. Notes imports have none: undefined → messageId ""
	 *  (chat-level). */
	messageId?: string;
}

/** One proposed argument. Endpoints are
 *  extractor-local proposition ids ("p1", …) — the extractor is the ONLY
 *  stage that ever proposes chains; the merger resolves them to node ids. */
export interface ExtractedChain {
	/** Proposition ids that JOINTLY entail the conclusion. */
	premises: string[];
	/** The proposition id the premises jointly imply. */
	conclusion: string;
}

/** The extractor's output shape: the raw reasoning chains, plus the
 *  existing graph ideas this stretch also teaches (`reteaches` — the merge
 *  credits the source for them, so re-taught ideas never duplicate). */
export interface SessionFindings {
	propositions: ExtractedProposition[];
	chains: ExtractedChain[];
	reteaches: string[];
}

/** The GET /api/graph payload — everything the home view's PURE renderer needs. */

/** One rendered cluster in the snapshot payload (vision §1). Members are
 * node ids; the renderer draws the hull from member positions at draw
 * time and gates the label inversely on the node-label zoom control. */
export interface Cluster {
	/** The labeling record id when claimed; unlabeled clusters still
	 * appear (hull, no name) with a member-hash id. */
	id: string;
	/** null until the naming call has minted/claimed a labeling. */
	label: string | null;
	/** Node ids, sorted. Hull + centroid are renderer concerns. */
	members: string[];
}

export interface GraphSnapshot {
	/** Proposition nodes + the DERIVED implication nodes (one per chain,
	 *  id = chain id) — what the canvas renders. */
	nodes: GraphNode[];
	/** The STORED proposition nodes alone (no derived implication nodes)
	 *  — the stored truth, like `chains`: consumers that read the world
	 *  (the chain table) take this list, never the canvas image. */
	propositions: GraphNode[];
	/** DERIVED untyped arrows: premise → imp → conclusion. A lossy image
	 *  of the stored chains — rebuilt after every change, never stored. */
	edges: GraphEdge[];
	/** DERIVED LOGICAL arrows: every chain contracted to direct premise→
	 *  conclusion over PROPOSITION ids only (the imp hop collapsed). The
	 *  depth pass consumes these — inference depth is a property of
	 *  propositions, never of the geometry point. */
	logicalEdges: GraphEdge[];
	/** DERIVED imp linkage (one per MULTI-premise live chain): the depth
	 *  pass anchors each junction at the average of the highest premise
	 *  row and the conclusion's row — strictly
	 *  above the premises, strictly below the conclusion. */
	impLinks: Array<{ id: string; premises: string[]; conclusion: string }>;
	/** The STORED reasoning chains (merged by (premises, conclusion) at
	 *  read): the chain table's and the practice pipeline's input — they
	 * read the truth, never the derived fan-out. */
	chains: GraphChain[];
	/** chatId → title, for every chat that touched the graph. */
	sessions: Record<string, string>;
	/** srcId → file path, for every IMPORTED NOTES file that touched the
	 *  graph (the format-agnostic front door): a static provenance entry —
	 *  the detail card shows the path as plain text, not a link. */
	fileSources: Record<string, string>;
	/** nodeId → chatIds that touched the node (click-through provenance). */
	nodeSessions: Record<string, string[]>;
	/** Birth-session communities (core/session-clusters.ts: each
	 * proposition joins the cluster of the session that birthed it —
	 * session provenance, no Louvain, no embeddings), MIN_CLUSTER_SIZE
	 * ≥ 3 as the hull presentation rule. Propositions only — implication
	 * nodes are never partitioned. Purely provenance-derived — never
	 * depends on layout. */
	clusters: Cluster[];
}

/** The auto-title's character cap: long enough to stay informative in
 *  the sidebar and the top bar, short enough that a first message never
 *  reads as a paragraph. */
export const TITLE_MAX_CHARS = 72;

/** Derive a short chat title from the learner's first message (pure).
 *  The cut snaps to a word boundary
 *  AT OR UNDER the cap — a title never ends mid-word. The one exception
 *  is a single word longer than the cap (rare, but real: identifiers,
 *  URLs): it cuts at the cap, splitting the word. Whitespace collapses to
 *  single spaces first, so boundaries are always single-space boundaries.
 *  Used on chat creation; deterministic so tests can pin it. */
export function titleFromPrompt(prompt: string): string {
	const oneLine = prompt.replace(/\s+/g, " ").trim();
	if (oneLine.length <= TITLE_MAX_CHARS) return oneLine;
	// Last space among the first TITLE_MAX_CHARS characters; the cut sits
	// before it so no trailing space rides into the title.
	let cut = -1;
	for (let i = TITLE_MAX_CHARS; i > 0; i--) {
		if (oneLine[i - 1] === " ") {
			cut = i - 1;
			break;
		}
	}
	// One long word: no boundary exists under the cap — split it. This also lands correctly when the first word exactly
	// fills the cap: cutting at the cap IS the boundary.
	if (cut < 0) cut = TITLE_MAX_CHARS;
	return `${oneLine.slice(0, cut)}…`;
}
