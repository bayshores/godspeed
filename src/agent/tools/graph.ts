import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { graphSessionIndex, graphSessionPropositions } from "../../core/graph.ts";
import type { ChatStore, GraphStore } from "../../core/ports.ts";

/**
 * THE PROBER'S GRAPH TOOLS (wave 7, owner-locked 2026-09-23): context
 * injection is dead — zero configuration beyond chat models. The prober
 * reads the learner's persistent knowledge map through two tools instead,
 * replacing the old injected block with on-demand eyes.
 *
 * Names + levels + dating ONLY — no statement text, no session contents
 * (owner ruling: the map's ORGANIZATION is the prober's business, its
 * prose is not). The data comes from Platform's pure core seams
 * (graphSessionIndex / graphSessionPropositions) over the same ports the
 * snapshot reads, so the prober and the learner's graph view can never
 * disagree.
 *
 * Registered on the prober ONLY when the settings gate opens
 * (graphToolsEnabled — the graph master switch AND the agent.graphTools
 * toggle); the composition root decides, the factory just receives the
 * store (absent = the gate is closed, no map tools — tests drive this).
 */

/** What the graph tools close over: the stores the session views read. */
export interface GraphToolContext {
	chatStore: ChatStore;
	graphStore: GraphStore;
	/** CROSS-CLASS READS (classes wave, owner ruling 2026-10-26): every
	 *  class graph plus "No class", each named, `own` marking the lesson's
	 *  class. Present = the map tools read across all of them (a strand
	 *  held solid in another class needs no re-probing); absent = the one
	 *  graphStore above, exactly as before. Read-only: nothing here writes. */
	graphs?: () => ScopedGraph[];
}

export interface ScopedGraph {
	className: string;
	graphStore: GraphStore;
	own: boolean;
}

const listSessionsInput = Type.Object({});

const listPropositionsInput = Type.Object({
	session: Type.String({
		minLength: 1,
		description: "The session's id exactly as list_sessions reported it (a chat id or a notes source id)",
	}),
});

export function proberGraphTools(ctx: GraphToolContext): Record<string, AgentTool<any>> {
	const deps = { chatStore: ctx.chatStore, graphStore: ctx.graphStore };
	return {
		list_sessions: {
			name: "list_sessions",
			label: "list_sessions",
			description:
				"List the sessions of the learner's persistent knowledge graph — every chat or imported-notes file that ever contributed a proposition, most recent first. The map is organized into birth-session clusters (propositions grouped by the session they were first learned in), and session names are those clusters' labels. " +
				"Each line: the session's name, kind (chat/file), how many propositions were born in it, its dates, and its id — use that id with list_propositions. " +
				"Reading this first shows what he has already covered and when, before you probe anything.",
			parameters: listSessionsInput,
			execute: serverExecute("list_sessions", listSessionsInput, async (): Promise<string> => {
				if (ctx.graphs) return listAcrossClasses(ctx.chatStore, ctx.graphs());
				const sessions = graphSessionIndex(deps);
				if (sessions.length === 0) return "The knowledge graph is empty — no session has contributed propositions yet.";
				const lines = sessions.map((s, i) =>
					`${i + 1}. ${s.name} (${s.kind}, ${s.propositions} proposition${s.propositions === 1 ? "" : "s"}, ` +
					`born ${s.createdAt ?? "unknown date"}${s.updatedAt ? `, last active ${s.updatedAt}` : ""}) — id: ${s.id}`,
				);
				return `${sessions.length} session(s) in the knowledge graph, most recent first:\n${lines.join("\n")}`;
			}),
		},
		list_propositions: {
			name: "list_propositions",
			label: "list_propositions",
			description:
				"List the propositions BORN in one knowledge-graph session — what was covered there. " +
				"Names only — no statement text, no session contents (the map's ORGANIZATION is your business, its prose is not).",
			parameters: listPropositionsInput,
			execute: serverExecute("list_propositions", listPropositionsInput, async ({ session }): Promise<string> => {
				// Cross-class: the session lives in exactly one class graph.
				const scoped = ctx.graphs?.().find((g) => graphSessionPropositions({ chatStore: ctx.chatStore, graphStore: g.graphStore }, session).length > 0);
				const propositions = graphSessionPropositions(scoped ? { chatStore: ctx.chatStore, graphStore: scoped.graphStore } : deps, session);
				if (propositions.length === 0) {
					return `No propositions born in session "${session}". Call list_sessions for the current ids.`;
				}
				const lines = propositions.map((p) => `- ${p.name}`);
				return `${propositions.length} proposition(s) covered in this session:\n${lines.join("\n")}`;
			}),
		},
	};
}

/** list_sessions across classes: the lesson's own class first, then the
 *  others, each line tagged with its class. */
function listAcrossClasses(chatStore: ChatStore, graphs: ScopedGraph[]): string {
	const ordered = [...graphs.filter((g) => g.own), ...graphs.filter((g) => !g.own)];
	const lines: string[] = [];
	for (const g of ordered) {
		for (const s of graphSessionIndex({ chatStore, graphStore: g.graphStore })) {
			lines.push(
				`${lines.length + 1}. ${s.name} (${s.kind}, ${s.propositions} proposition${s.propositions === 1 ? "" : "s"}, ` +
					`born ${s.createdAt ?? "unknown date"}${s.updatedAt ? `, last active ${s.updatedAt}` : ""}) — class: ${g.className}${g.own ? " (this lesson's class)" : ""} — id: ${s.id}`,
			);
		}
	}
	if (lines.length === 0) return "The knowledge graph is empty — no session has contributed propositions yet.";
	return `${lines.length} session(s) across the learner's classes (this lesson's class first, then the others; most recent first within each):\n${lines.join("\n")}`;
}
