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
}

// The tree carries structure ONLY: position and visited-ness derive from the
// transcript at render time (derivePlanStatuses below). There is no done
// ledger of any kind.

/** Derived, never stored: status of a node for the panel (vision §2). */
export type PlanNodeStatus = "current" | "visited" | "upcoming";

/** Plan nodes in learning order: prerequisites first, ties in authored order. */
export function orderedPlanNodes(tree: PlanTree): PlanTree["nodes"] {
	const index = new Map(tree.nodes.map((n, i) => [n.id, i]));
	const indegree = new Map(tree.nodes.map((n) => [n.id, 0]));
	const next = new Map<string, string[]>();
	for (const e of tree.edges) {
		if (!index.has(e.from) || !index.has(e.to)) continue;
		indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
		const list = next.get(e.from);
		if (list) list.push(e.to);
		else next.set(e.from, [e.to]);
	}
	const ready = tree.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
	const out: string[] = [];
	while (ready.length > 0) {
		ready.sort((a, b) => index.get(a)! - index.get(b)!);
		const id = ready.shift()!;
		out.push(id);
		for (const to of next.get(id) ?? []) {
			const d = indegree.get(to)! - 1;
			indegree.set(to, d);
			if (d === 0) ready.push(to);
		}
	}
	// A malformed tree (a cycle) keeps the rest in authored order.
	for (const n of tree.nodes) if (!out.includes(n.id)) out.push(n.id);
	return out.map((id) => tree.nodes[index.get(id)!]!);
}

// ─── derived statuses: position from CALLS, never from results ─────────────
//
// The teacher AUTHORS the map (plan_init, mermaid — re-callable rewrite) and never tracks progress.
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

/** The tools whose calls tag position: either quizzing tool, and a study
 *  session's problems (practice problems carry no nodeId). */
export const TAGGING_TOOLS: ReadonlySet<string> = new Set(["quiz", "explain", "problem"]);

function* partTags(messages: readonly PartsCarrier[]): Generator<unknown> {
	for (const m of messages) {
		for (const part of m.parts) {
			if (part.type.startsWith("tool-") && TAGGING_TOOLS.has(part.type.slice(5))) yield (part.input as { nodeId?: unknown } | undefined)?.nodeId;
		}
	}
}

export function derivePlanStatuses(tree: PlanTree, messages: readonly PartsCarrier[]): DerivedPlanStatuses {
	return statusesFromTags(tree, partTags(messages));
}

/** The native record's tagging CALLS, in any state: a dangling call
 *  still moves position, and results feed nothing. A topic_done whose
 *  opener is shown tags the opener's node, as the view's opener part does. */
function* nativeTags(messages: readonly LhMessage[], openerNodes: ReadonlyMap<string, string>): Generator<unknown> {
	for (const m of messages) {
		if ((m as { role?: string }).role !== "assistant") continue;
		const content = (m as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) {
			if (block.type !== "toolCall") continue;
			if (block.name !== undefined && TAGGING_TOOLS.has(block.name)) yield (block.arguments as { nodeId?: unknown } | undefined)?.nodeId;
			else if (block.id !== undefined && openerNodes.has(block.id)) yield openerNodes.get(block.id);
		}
	}
}

/** derivePlanStatuses over the native record. `openerNodes` maps each
 *  topic_done whose opener is shown to the opener question's node. */
export function derivePlanStatusesLh(tree: PlanTree, messages: readonly LhMessage[], openerNodes: ReadonlyMap<string, string> = new Map()): DerivedPlanStatuses {
	return statusesFromTags(tree, nativeTags(messages, openerNodes));
}
