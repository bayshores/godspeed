/**
 * Plan-tree contracts — the session-scoped dependency tree.
 * Pure types + protocol docs + tiny pure helpers.
 */
import type { LhMessage } from "../native-messages.ts";

// ─── Plan tree (vision §2 "formal plan tree") ────────────────────────────────
// A session-scoped dependency tree authored by the teacher via plan tools.
// One substrate with the global graph: tree nodes fold into graph nodes.

export interface PlanNode {
	/** Opaque, agent-chosen slug, stable across edits: "chain-rule-intuition". */
	id: string;
	/** Short label for the tree panel. */
	title: string;
	/** 1-2 sentences: what this node covers. */
	summary?: string;
}

export interface PlanEdge {
	/** Prerequisite node id. */
	from: string;
	/** Node that depends on `from`. */
	to: string;
}

export interface PlanTree {
	nodes: PlanNode[];
	edges: PlanEdge[];
	/** Increments on every mutation — lets the UI animate/react to changes. */
	version: number;
}

// The tree carries structure ONLY: position and visited-ness derive from the
// transcript at render time (derivePlanStatuses below). There is no done
// ledger of any kind.

/** Derived, never stored: status of a node for the panel (vision §2). */
export type PlanNodeStatus = "current" | "visited" | "upcoming";

// ─── derived statuses: position from CALLS, never from results ─────────────
//
// (docs/archive/probe-teach-split.md §3.) The teacher AUTHORS the
// map (plan_init, mermaid — re-callable rewrite) and never tracks progress.
// The quiz `nodeId` means "this question is ABOUT this node" — a position
// signal, never a completion signal. Derivation reads CALLS only:
//   current — the node of the most RECENT tagged quiz call (any state)
//   visited — every node referenced by an EARLIER tagged call
// Consequences: a node spans multiple turns/checks naturally (several
// questions may tag the same node — the map holds still); moving to a new
// node is the teacher's judgment the previous one is finished, regardless of
// check outcomes (a failed check then a move-on is still visited); results
// feed nothing; there is NO fallback current (before the first tagged check
// nothing is current). nodeId is required on the teach quiz. NodeIds missing from the
// current tree are ignored (a rewrite may have dropped the node).

/** Minimal structural message slice — anything with typed parts (mirrors
 * phases.ts: pure, no runtime deps, safe on server, client, and in tests). */
interface PartsCarrier {
	parts: Array<{ type: string; state?: string; input?: unknown; output?: unknown }>;
}

interface DerivedPlanStatuses {
	/** The node the most recent tagged quiz call is about; null before any. */
	current: string | null;
	/** Nodes referenced by earlier tagged calls — been there, monotonic. */
	visited: ReadonlySet<string>;
}

/** Statuses of a node: the derived view the plan panel should render. */
export function derivedNodeStatus(statuses: DerivedPlanStatuses, nodeId: string): PlanNodeStatus {
	if (statuses.current === nodeId) return "current";
	if (statuses.visited.has(nodeId)) return "visited";
	return "upcoming";
}

/** Position from the tagged calls, in call order. A tag that isn't a node of
 *  the current tree moves nothing (untagged, or a rewrite dropped it).
 *  Consecutive repeats collapse into one stay (several checks on one node).
 *  The last stay is current and every earlier stay is visited, so a revisit
 *  (a→b→a) puts a in both; current wins at render (derivedNodeStatus). */
function statusesFromTags(tree: PlanTree, tags: Iterable<unknown>): DerivedPlanStatuses {
	const ids = new Set(tree.nodes.map((n) => n.id));
	const runs: string[] = [];
	for (const nodeId of tags) {
		if (typeof nodeId !== "string" || !ids.has(nodeId)) continue;
		if (runs.at(-1) !== nodeId) runs.push(nodeId);
	}
	return { current: runs.at(-1) ?? null, visited: new Set(runs.slice(0, -1)) };
}

/** Either quizzing tool (quiz/explain) tags position. */
function* partTags(messages: readonly PartsCarrier[]): Generator<unknown> {
	for (const m of messages) {
		for (const part of m.parts) {
			if (part.type === "tool-quiz" || part.type === "tool-explain") yield (part.input as { nodeId?: unknown } | undefined)?.nodeId;
		}
	}
}

export function derivePlanStatuses(tree: PlanTree, messages: readonly PartsCarrier[]): DerivedPlanStatuses {
	return statusesFromTags(tree, partTags(messages));
}

/** The native record's quiz/explain CALLS, in any state: a dangling call
 *  still moves position, and results feed nothing. */
function* nativeTags(messages: readonly LhMessage[]): Generator<unknown> {
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content as Array<{ type?: string; name?: string; arguments?: unknown }>) {
			if (block.type === "toolCall" && (block.name === "quiz" || block.name === "explain")) yield (block.arguments as { nodeId?: unknown } | undefined)?.nodeId;
		}
	}
}

/** derivePlanStatuses over the native record. */
export function derivePlanStatusesLh(tree: PlanTree, messages: readonly LhMessage[]): DerivedPlanStatuses {
	return statusesFromTags(tree, nativeTags(messages));
}
