/**
 * THE PRACTICE TOOLS: the session runs on `problem`
 * (pose: terminates the turn; the commitment rides the call's arguments,
 * hidden from the learner UI) and `conclude` (end the problem: normal
 * result, so closing words may follow; the next pose waits for the
 * learner's go-ahead). The rarely-used extras join in practiceTools. The gating law: an agent cannot pose while a problem is active
 * and cannot conclude with nothing active — activeProblemOf is the single
 * fold both gates read.
 *
 * Mechanics-only descriptions: the tool descriptions carry WHAT to pass
 * and WHAT happens — the theory, the commit-before-pose law, the hint
 * ladder all live in the system prompt (prompts/practice/10-doctrine.md).
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { resolveTargetId } from "../../../shared/core/chains.ts";
import { readTool } from "./read.ts";
import { lsTool } from "./ls.ts";
import { findTool } from "./find.ts";
import { grepTool } from "./grep.ts";
import { jobTools, type JobToolContext } from "./jobs.ts";
import { proberGraphTools, type GraphToolContext } from "./graph.ts";
import { classTools, type ClassToolContext } from "./class.ts";
import { ruleTools, type SaveRule } from "./rules.ts";
import { activeProblemOf } from "../../../shared/core/native-messages.ts";
import { filterEnabledTools, type EnabledTools } from "../../../shared/core/tool-switches.ts";
import type { LhMessage } from "../../../shared/core/native-messages.ts";
import { concludeResult, invalidInputResult, problemResult } from "../tool-execute.ts";
import { healEncodedArguments, healToolRecord } from "./heal.ts";


/** The record-reading context the gates need (the plan-tools idiom). */
export interface PracticeToolContext {
	chatId: string;
	chatStore: { getChat(id: string): { messages: LhMessage[]; kind?: string } | null };
	/** The WHOLE-graph node list, read fresh per pose (the mastery-trace
	 *  contract): targets validate against every proposition,
	 *  not just the session's picks, so pickless sessions and future
	 *  graph-tools poses stay valid. Absent (tests) = no validation. */
	graphNodes?: () => ReadonlyArray<Pick<import("../../../shared/core/contracts/graph.ts").GraphNode, "id" | "name">>;
	/** THE RARELY-NEEDED SET: the map readers
	 *  behind the SAME settings gate as the prober's (graphToolsEnabled at
	 *  the composition root); the research + pdf jobs.
	 *  Each absent context (tests) = absent from the registry. */
	graph?: GraphToolContext;
	jobs?: JobToolContext;
	/** The lesson's class card reader: present = read_class. */
	classCard?: ClassToolContext["classCard"];
	todayNote?: ClassToolContext["todayNote"];
	classSearch?: ClassToolContext["search"];
	classNote?: ClassToolContext["setNote"];
	/** save_rule: present = the teacher can save a teaching rule. */
	saveRule?: SaveRule;
}

/** TURN-SCOPED GATE STATE: the gates can't read the STORED record — it
 *  freezes at the turn's write-ahead (persistTurn lands only at turn END),
 *  so a mid-turn conclude → pose pair would never see each other and every
 *  pose after a conclude would fail with "a problem is already active".
 *  (The prompt forbids conclude → pose in one turn; the gate only keeps a
 *  slip from failing confusingly.) The gate seeds ONCE from the record at construction
 *  (one practiceTools per turn — chat-handler builds the agent per
 *  request, so there is no cross-turn leakage), and the executes flip
 *  this closure — the intra-turn truth the record cannot hold yet. */
interface PracticeGate {
	problemActive: boolean;
}

/** Seed the turn's gate from the record (result-aware activeProblemOf —
 *  only a cleanly-posed problem counts). */
export function createPracticeGate(ctx: Pick<PracticeToolContext, "chatId" | "chatStore">): PracticeGate {
	const record = ctx.chatStore.getChat(ctx.chatId);
	return { problemActive: record ? activeProblemOf(record.messages) !== null : false };
}

// ─── problem: the pose ───────────────────────────────────────────────────────

export const problemInputObject = Type.Object({
	statement: Type.String({
		description:
			"REQUIRED — the problem as the learner sees it (markdown + LaTeX). Must be self-contained and " +
			"solvable from the session's material. NEVER announces the target proposition.",
	}),
	mode: Type.Union([Type.Literal("recall"), Type.Literal("discrimination"), Type.Literal("composition")], {
		description: "REQUIRED — the demand mode: recall, discrimination, or composition (bare words, no quotes).",
	}),
	target: Type.Optional(
		Type.Array(Type.String(), {
			minItems: 1,
			description:
				"The proposition id(s) this problem exercises, from the session context's [id] list — include when " +
				"the material is in the map (the outcome counts toward the learner's readiness for them); OMIT entirely " +
				"when it is not (a topic session poses untagged problems). " +
				"Names are normalized to ids at the seam; an unknown proposition is rejected.",
		}),
	),
	modelSolution: Type.String({
		description: "REQUIRED — the full solution, moves in order, committed BEFORE the learner sees the problem. This IS the reveal — conclude shows it verbatim; never re-author it.",
	}),
});

export function problemTool(
	gate: PracticeGate,
	graphNodes?: PracticeToolContext["graphNodes"],
): AgentTool<typeof problemInputObject> {
	return {
		name: "problem",
		label: "problem",
		description:
			"Pose one practice problem. Ends the turn — the learner works in the thinking field; their thinking " +
			"traces and answer commits arrive back as labeled messages. The modelSolution rides this call's " +
			"arguments and stays hidden from the learner until you conclude (conclude shows it verbatim — the " +
			"reveal needs no new field). Only one problem may be active — conclude it before posing the next.",
		parameters: problemInputObject,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => {
			const healed = healEncodedArguments(args, problemInputObject);
			// TARGET NORMALIZATION: names silently become ids —
			// the RECORD carries canonical ids (the mastery trace groups on
			// them); unresolvable strings pass through for execute to reject.
			// UNTAGGED PROBLEMS: an explicit empty list is
			// the model saying "no targets" — healed AWAY, so the record's
			// canonical form is tagged-or-absent, never [].
			if (!graphNodes) {
				const bare = (healed as { target?: unknown }).target;
				return Array.isArray(bare) && bare.length === 0
					? ({ ...(healed as Record<string, unknown>), target: undefined } as never)
					: (healed as never);
			}
			const target = (healed as { target?: unknown }).target;
			if (!Array.isArray(target) || target.length === 0) {
				return { ...(healed as Record<string, unknown>), target: undefined } as never;
			}
			const list = graphNodes();
			const normalized = target.map((t) =>
				typeof t === "string" ? (resolveTargetId(t, list) ?? t) : t,
			);
			if (normalized.every((t, i) => t === target[i])) return healed as never;
			return { ...(healed as Record<string, unknown>), target: normalized } as never;
		},
		execute: async (_toolCallId, input) => {
			if (gate.problemActive) {
				return invalidInputResult("problem", [
					"a problem is already active — call conclude on it before posing the next one",
				]);
			}
			// TARGET VALIDATION: against the WHOLE graph, and ONLY when
			// targets are present — absent means an untagged problem (topic
			// sessions), which poses freely. A one-line rejection — the proposition list already
			// sits in the agent's context (the [id] marker); no re-listing.
			// The message teaches the exit: omitting always works.
			if (graphNodes && input.target && input.target.length > 0) {
				const list = graphNodes();
				const unknown = input.target.filter((t) => resolveTargetId(t, list) === null);
				if (unknown.length > 0) {
					return invalidInputResult("problem", [
						`target ${JSON.stringify(unknown)} is not a known proposition — targets must be proposition ids from the session context; if the material is not in the map, omit target entirely`,
					]);
				}
			}
			gate.problemActive = true;
			return problemResult();
		},
	};
}

/** A study session's problem also names the plan node it is about, so
 *  the step bar follows problems the way it follows quizzes. */
const studyProblemInputObject = Type.Object({
	...problemInputObject.properties,
	nodeId: Type.String({ description: "REQUIRED — the topic this problem is about: a node id from the [Study plan]." }),
});

function studyProblemTool(
	gate: PracticeGate,
	graphNodes: PracticeToolContext["graphNodes"],
	nodeIdProblem: (nodeId: string) => string | null,
): AgentTool<typeof studyProblemInputObject> {
	const pose = problemTool(gate, graphNodes);
	return {
		...pose,
		parameters: studyProblemInputObject,
		// The pose's target normalization passes nodeId through untouched.
		prepareArguments: pose.prepareArguments as AgentTool<typeof studyProblemInputObject>["prepareArguments"],
		execute: async (toolCallId, input, signal, onUpdate) => {
			const problem = nodeIdProblem(input.nodeId);
			if (problem) return invalidInputResult("problem", [problem]);
			return pose.execute(toolCallId, input, signal, onUpdate);
		},
	};
}

/** A study session's problem and conclude, sharing one turn gate. */
export function studyProblemTools(
	ctx: Pick<PracticeToolContext, "chatId" | "chatStore" | "graphNodes">,
	nodeIdProblem: (nodeId: string) => string | null,
): Record<string, AgentTool<any>> {
	const gate = createPracticeGate(ctx);
	return { problem: studyProblemTool(gate, ctx.graphNodes, nodeIdProblem), conclude: concludeTool(gate) };
}

// ─── conclude: the end of a problem ──────────────────────────────────────────

export const concludeInputObject = Type.Object({
	outcome: Type.Union(
		[
			Type.Literal("solved"),
			Type.Literal("solvedWithHints"),
			Type.Literal("movedOn"),
			Type.Literal("surrendered"),
			Type.Literal("dismissed"),
		],
		{ description: "REQUIRED — the outcome: solved, solvedWithHints, movedOn, or surrendered — bare words, no quotes (dismissed is synthesized, never yours)." },
	),
	verdict: Type.String({
		description: "REQUIRED — the plain-language verdict: what was credited, where it broke. On a wrong answer: localize the break, do NOT give the correction.",
	}),
	rung: Type.Union(
		[Type.Literal("R0"), Type.Literal("R1"), Type.Literal("R2"), Type.Literal("R3"), Type.Literal("R4"), Type.Literal("R5"), Type.Null()],
		{ description: "REQUIRED — the hint-ladder rung the problem needed: R0 through R5, or null = no hint was given (bare, no quotes)." },
	),
	missClass: Type.Union(
		[
			Type.Literal("cue"),
			Type.Literal("discrimination"),
			Type.Literal("execution"),
			Type.Literal("careless"),
			Type.Literal("structural"),
			Type.Null(),
		],
		{ description: "REQUIRED — the miss classification: cue, discrimination, execution, careless, or structural — or null = no miss (bare, no quotes)." },
	),
	retest: Type.Boolean({ description: "REQUIRED — true marks the problem for a fresh-surface retest before the session ends." }),
});

export function concludeTool(gate: PracticeGate): AgentTool<typeof concludeInputObject> {
	return {
		name: "conclude",
		label: "conclude",
		description:
			"Conclude the active problem: records the outcome + verdict, reveals the committed solution, and frees " +
			"the learner's composer. After the result, say your closing words about the learner's work if useful, then " +
			"END YOUR TURN — no further tool calls. The next problem is NEVER posed here: it waits for the learner's " +
			"explicit go-ahead (a *Next problem* message, or their own words asking for the next one). Between problems, " +
			"answer their questions about the concluded one. Nothing may conclude unless a problem is active.",
		parameters: concludeInputObject,
		prepareArguments: (args: unknown) => healEncodedArguments(args, concludeInputObject) as never,
		executionMode: "sequential",
		execute: async (_toolCallId, _input) => {
			if (!gate.problemActive) {
				return invalidInputResult("conclude", ["no active problem to conclude — pose one first"]);
			}
			gate.problemActive = false;
			return concludeResult();
		},
	};
}

/** The practice toolset (the practice agent's whole registry). Any side
 *  tool `enabled` sets explicitly false is dropped; problem/conclude are
 *  the session, so they never are. */
export function practiceTools(ctx: PracticeToolContext, enabled?: EnabledTools): Record<string, AgentTool<any>> {
	// ONE gate per turn, shared by both tools — the intra-turn truth.
	const gate = createPracticeGate(ctx);
	// THE RARELY-NEEDED SET: read/ls/find/grep over the
	// learner's files (always — the same read-only set the teacher and
	// prober carry), the research + pdf jobs (demo/visual stay
	// teach-only), and
	// the prober's map readers when the settings gate opened. The same
	// Settings switches as the teacher's apply to them.
	const jobs = ctx.jobs ? jobTools(ctx.jobs) : null;
	// healToolRecord: the standard argument heal over the WHOLE registry.
	// problem/conclude keep their own (target-normalizing) prepareArguments as the composed
	// inner pass; the double heal is idempotent by construction.
	return healToolRecord({
		problem: problemTool(gate, ctx.graphNodes),
		conclude: concludeTool(gate),
		...filterEnabledTools<AgentTool<any>>(
			{
				read: readTool,
				ls: lsTool,
				find: findTool,
				grep: grepTool,
				...(jobs ? { research: jobs.research, pdf: jobs.pdf } : {}),
				...(ctx.graph ? proberGraphTools(ctx.graph) : {}),
				...(ctx.classCard ? classTools({ classCard: ctx.classCard, todayNote: ctx.todayNote, search: ctx.classSearch, setNote: ctx.classNote }) : {}),
				...(ctx.saveRule ? ruleTools(ctx.saveRule) : {}),
			},
			enabled,
		),
	});
}
