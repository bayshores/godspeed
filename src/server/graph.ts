import * as fs from "node:fs";
import { graphFilesIn } from "../config.ts";
import type { ClassScope, GraphSnapshot } from "../core/contracts.ts";
import type { GraphCostSummary } from "../core/cost-summary.ts";
import { graphCostSummary } from "../core/cost-summary.ts";
import { graphSnapshot } from "../core/graph.ts";
import {
	deleteNodeTraces,
	type NodeDeletionStats,
} from "../core/graph-deletion.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { graphDirFor, graphStoreFor, stores } from "./stores.ts";

/**
 * Server-side graph entry for the home view (GET /api/graph). A PURE READ:
 * the extraction pipeline (the sole graph writer) is triggered by quiz
 * answers in sessions (turn-service), never from here — the home view
 * reflects whatever the pipeline has merged so far.
 */
export function graphView(scope: ClassScope = null): GraphSnapshot {
	return graphSnapshot({ chatStore: stores.chatStore, graphStore: graphStoreFor(scope) });
}

/** The graph view's cost surface (GET /api/graph/costs): a pure read of
 *  the chat records (chat-front-door runs) and the notes sources
 *  (notes-front-door runs), folded into stage totals + recent runs. */
export function graphCosts(scope: ClassScope = null): GraphCostSummary {
	const chats = stores.chatStore
		.listChats()
		// A graph's costs are its own class's lessons only.
		.filter((summary) => (summary.classId ?? null) === scope)
		.flatMap((summary) => {
			const record = stores.chatStore.getChat(summary.id);
			return record?.extractions?.length
				? [{ title: record.title ?? summary.id, extractions: record.extractions }]
				: [];
		});
	const sources = graphStoreFor(scope)
		.readSources()
		.filter((s) => s.extractions?.length)
		.map((s) => ({ filePath: s.filePath, extractions: s.extractions! }));
	return graphCostSummary({ chats, sources });
}

/** The graph's version stamp: the max mtime
 * across every graph data file (the ledgers). Moves on ANY graph write
 * (merge append or a deletion's atomic rewrite),
 * never moves on reads, and needs no bookkeeping of its own: the fs
 * IS the counter. The DELETE responses return it so the graph
 *  knows to refetch — the "graph changed underneath me" signal. */
export function graphRevision(scope: ClassScope = null): number {
	let revision = 0;
	const files = graphFilesIn(graphDirFor(scope));
	for (const file of [files.nodes, files.chains, files.sessions, files.coverage, files.topics]) {
		try {
			revision = Math.max(revision, fs.statSync(file).mtimeMs);
		} catch {
			/* absent — nothing has ever written it */
		}
	}
	return revision;
}

// ─── single-node deletion (full death) ───────────────────────────────────────

/** What deleteGraphNode did — the route maps it straight to HTTP. */
type NodeDeleteOutcome =
	| { ok: false; status: 404; code: "not_found"; error: string }
	| { ok: false; status: 409; code: "extraction_running"; error: string }
	| { ok: true; stats: NodeDeletionStats; graphRevision: number };

/**
 * Delete one node by id — FULL DEATH (core/graph-deletion.ts for the
 * ledger semantics). The guard family is deliberately NOT the chat
 * one, and the reasoning is worth writing down:
 *
 *   - No turn/jobs gates. Turns and background jobs never write the
 *     graph ledgers; a turn's follow-up extraction registers as a run,
 *     and every code path here is synchronous — nothing can register
 *     or merge between the gate and the ledger rewrite (the event loop
 *     never yields inside this function).
 *   - THE EXTRACTION GATE — 409 while ANY pipeline run is registered,
 *     anywhere. A mid-flight run holds findings extracted from
 *     transcripts that predate the deletion; its merges could re-add
 *     aliases, provenance, or events to the dying node. Unlike chat deletion we
 *     do NOT abort the run: it belongs to some session, and killing
 *     that session's spend is outside this deletion's blast radius —
 *     the UI retries once the dock drains. A run that starts AFTER
 *     the deletion is legitimate re-learning: it reads post-deletion
 *     ledgers, mints a fresh node for a re-taught topic, and
 *     mergeFindings ignores linkTo ids that no longer exist (the
 *     existingIds guard) — no dangling edges, no resurrection.
 */
export function deleteGraphNode(nodeId: string, scope: ClassScope = null): NodeDeleteOutcome {
	// Topic-grouping runs only read facts and write topics.jsonl — they
	// never block a deletion (readers drop members that are gone).
	if (extractionStatuses().some((run) => run.kind !== "topics")) {
		return {
			ok: false,
			status: 409,
			code: "extraction_running",
			error: "An extraction is running. Try again when it finishes",
		};
	}
	// THE SYNC BLOCK — no awaits below (the doc above): the gate and the
	// rewrite are one atomic stretch of the event loop.
	const stats = deleteNodeTraces(graphStoreFor(scope), nodeId);
	if (stats === null) {
		return { ok: false, status: 404, code: "not_found", error: "No such node" };
	}
	return { ok: true, stats, graphRevision: graphRevision(scope) };
}

