/**
 * Knowledge-graph contracts — nodes, ledgers, extraction findings
 *
 * The graph: every node is a TRUE proposition;
 * provenance is message-granular; extraction is post-hoc, decoupled from
 * the session's plan tree. The graph holds the reasoning chains from all
 * lessons (and imported notes) and nothing else: no quiz outcomes, no
 * understanding assessments.
 *
 * Pure types + protocol docs + tiny pure helpers.
 */
// ─── Knowledge graph (vision §1 — global, cross-session) ────────────────────


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
 *  chains record every (chat, message) where they came up, deep-linkable to
 *  the exact transcript point. */
export interface ProvenancePoint {
	/** The chat this point anchors to — or a notes source id ("src_…"):
	 *  imports carry no message anchors (provenance is the file itself,
	 *  recorded through the source record). */
	chatId: string;
	messageId: string;
}

/** The main work a topic asks of a learner; Study picks its opening move by it. */
export const TOPIC_MATERIALS = ["term", "procedure", "concept", "proof"] as const;
export type TopicMaterial = (typeof TOPIC_MATERIALS)[number];

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

/** The GET /api/graph payload — everything the home view's PURE renderer needs. */

/** One rendered cluster in the snapshot payload (vision §1). Members are
 * node ids; the renderer draws the hull from member positions at draw
 * time and gates the label inversely on the node-label zoom control. */
export interface Cluster {
	/** The birth session's id: a chatId, or a notes source id ("src_…"). */
	id: string;
	/** The session's name (chat title or imported file path); null when
	 * that session's record is gone. */
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
	/** Birth-session communities (each
	 * proposition joins the cluster of the session that birthed it —
	 * session provenance, no Louvain, no embeddings), MIN_CLUSTER_SIZE
	 * ≥ 3 as the hull presentation rule. Propositions only — implication
	 * nodes are never partitioned. Purely provenance-derived — never
	 * depends on layout. */
	clusters: Cluster[];
}

/** The auto-title's character cap: long enough to stay informative in
 *  the lesson list and the top bar, short enough that a first message never
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
	// Last space at or before the cap. A space at index TITLE_MAX_CHARS means the first TITLE_MAX_CHARS chars are whole words.
	const space = oneLine.lastIndexOf(" ", TITLE_MAX_CHARS);
	let cut = space > 0 ? space : TITLE_MAX_CHARS;
	// One long word: don't split a surrogate pair.
	if (space <= 0 && /[\uD800-\uDBFF]/.test(oneLine[cut - 1]!)) cut--;
	return `${oneLine.slice(0, cut)}…`;
}
