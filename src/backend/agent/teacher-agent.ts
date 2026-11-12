import { agentCore } from "./engine-load.ts";
import type { AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult, questionResult } from "./tool-execute.ts";
import type { Usage } from "@earendil-works/pi-ai";
import { APP_IDENTITY, agentEngine, type PiEngine } from "./models.ts";
import { effectivePromptSegments } from "./prompt-segments.ts";
import {
	askUserQuestionTool,
	createProberTools,
	createStudyTools,
	createTeacherTools,
	type ProberToolContext,
	type TeacherToolContext,
} from "./tools.ts";
import { practiceTools, type PracticeToolContext } from "./tools/practice.ts";

/** What a study session's tools close over: the teacher's context plus the
 *  graph the problem targets validate against. */
type StudyToolContext = TeacherToolContext & Pick<PracticeToolContext, "graphNodes">;
import { talkTools } from "./tools/talk.ts";
import { homeworkTools, type HomeworkToolContext } from "./tools/homework.ts";
import type { SpaceActions } from "../../shared/core/space-tools.ts";
import { healToolRecord } from "./tools/heal.ts";
import { quizInputObject, quizInputProblems } from "../../shared/core/question-core.ts";
import { isQuestionTool } from "../../shared/core/pending.ts";
import { switchedOffToolsNote, TOGGLEABLE_TOOLS, type EnabledTools, type ToggleableTool } from "../../shared/core/tool-switches.ts";
import { toLlmMessages, PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL } from "../../shared/core/native-messages.ts";

/**
 * The agents: STUDY (every new session), the PROBER and the TEACHER (older
 * teach lessons), PRACTICE (older practice sessions) and TALK (the
 * teacher's panel, outside lessons). A teach lesson's
 * prober and teacher share one transcript with different prompts and tool
 * sets; the chat-handler constructs ONE per request off the transcript's
 * seam (probe_done = teacher), and study and practice sessions build their
 * agent from turn 1. The engine is stateless per turn: the persisted record is the
 * source of truth, the agent is rebuilt from it every POST and discarded at
 * turn end.
 *
 * Engines are injectable so tests can pass a scripted faux engine and drive
 * deterministic lessons (see tests/backend/chat-flow.test.ts).
 *
 * System prompts are COMPOSED per agent: the base src/backend/agent/system-prompt.md
 * (the agent and its philosophy) + every numeric-prefix fragment in that
 * agent's directory (src/backend/agent/prompts/prober/ or
 * src/backend/agent/prompts/teacher/), in sorted filename order, then the shared/
 * fragments as a trailing appendix (voice, accuracy, question tools,
 * learner files, formatting): the agent's job and method lead, the
 * mechanics trail. Practice skips the base (prompts/practice/00-base.md
 * takes its place) and gets only a curated shared set
 * (PRACTICE_SHARED_FRAGMENTS). Joined with `---` separators.
 *
 * ONLY numeric-prefix files load — the loader enforces the convention, so
 * non-fragment documentation (README.md, …) can live in the directories
 * without ever leaking into the model's prompt.
 */

/** Which agent's prompt directory to compose. Practice composes its own
 *  directory plus a curated shared set (see prompt-segments.ts). */
export type AgentKind = "prober" | "teacher" | "practice" | "study" | "homework" | "talk";

/** The switchable tools each agent's factory carries (tools.ts,
 *  tools/practice.ts): demos and figures are teacher-only. */
const AGENT_SWITCHES: Record<AgentKind, readonly ToggleableTool[]> = {
	prober: ["research", "pdf"],
	teacher: TOGGLEABLE_TOOLS,
	practice: ["research", "pdf"],
	study: TOGGLEABLE_TOOLS,
	homework: ["research", "pdf"],
	talk: [],
};

/** Exported for tests: assert what composes into the model's prompt.
 *  Composition order: the shared base (not for practice) → the agent's own fragments → shared/
 *  fragments (effectivePromptSegments). A part the learner saved their
 *  own version of composes that version; files are read fresh per call so
 *  a save applies on the next turn. */
export function composeInstructions(kind: AgentKind): string {
	return effectivePromptSegments(kind)
		.map((s) => (s.overrideText ?? s.sourceText).trim())
		.filter(Boolean)
		.join("\n\n---\n\n");
}

// The chat-handler passes a per-turn collector; every model call's token
// usage lands in the chat record's turns log (ChatStore.appendTurnUsage).
type StepUsageCollector = (usage: Usage) => void;

/** Per-request construction options (the handler wires all of these). */
export interface AgentBuildOptions {
	/** Model + stream function — tests inject a scripted faux engine. */
	engine?: PiEngine;
	/** The initial transcript, as pi messages (the record IS agent state). */
	messages?: AgentMessage[];
	/** Token usage: one call per model request. */
	onUsage?: StepUsageCollector;
	/** Tests may pass a bare tool registry to drive deterministic flows.
	 *  An explicit registry is NEVER toggle-filtered — the caller owns it. */
	tools?: Record<string, AgentTool<any>>;
	/** The resolved per-user tool toggles (core/tool-switches EnabledTools);
	 *  the factories drop any tool explicitly false, and the system prompt
	 *  names the ones that are off. The toggleable set is TOGGLEABLE_TOOLS
	 *  (job tools only). */
	toolToggles?: EnabledTools;
	/** The learner's rules section (core learnerRulesSection), appended
	 *  after the instructions; "" or absent = none. */
	learnerRules?: string;
	/** Native conversation identity: the existing persisted chat id, reused
	 * across reconstructed prober, teacher, and practice Agents. */
	chatId?: string;
	/** The turn answers a side question: a question is already waiting, so
	 *  the question and problem tools refuse (sideTurnTools). */
	sideTurn?: boolean;
}

/**
 * The turn's question-stop rule: a question
 * tool call (quiz / ask_user_question) that resolved cleanly ends the
 * run; the learner's answer arrives as the next POST. A call that failed
 * authoring validation must NOT stop the run, so the model can retry
 * within the same turn.
 *
 * Question results also carry terminate: true, so single-question batches
 * stop natively; this finishTurn hook covers the mixed batch (a question +
 * other calls in one message). The learner cannot answer while a turn is
 * in flight (per-chat 409), so a cleanly-posed question MUST always end
 * the turn. Practice's problem pose
 * has the same wait-for-the-learner contract, including mixed batches;
 * failed poses must still retry. There is no maximum-turns net on the
 * teaching turn.
 */
function makeQuestionStopper(kind: AgentKind) {
	return (context: {
		message: { content: Array<{ type: string; id?: string; name?: string }> };
		toolResults: Array<{ toolCallId: string; isError?: boolean }>;
	}): boolean => {
		const called = new Set(
			context.message.content
				.filter((c) => c.type === "toolCall" && c.name !== undefined && (
					isQuestionTool(c.name) ||
					((kind === "practice" || kind === "study" || kind === "homework") && c.name === PRACTICE_PROBLEM_TOOL)
				))
				.map((c) => c.id!),
		);
		if (called.size === 0) return false;
		// Stop only when every question/problem pose resolved cleanly.
		for (const result of context.toolResults) {
			if (called.has(result.toolCallId) && result.isError) return false;
		}
		return true;
	};
}

/** A side turn keeps the question tools, problem and conclude but refuses
 *  them: an unchanged tool list keeps the outside agent's conversation a
 *  cheap delta instead of a full resend. */
function sideTurnTools(tools: AgentTool<any, any>[]): AgentTool<any, any>[] {
	return tools.map((t) =>
		isQuestionTool(t.name) || t.name === PRACTICE_PROBLEM_TOOL || t.name === PRACTICE_CONCLUDE_TOOL
			? { ...t, execute: async () => ({ content: [{ type: "text" as const, text: SIDE_TURN_REFUSAL }], isError: true, details: undefined }) }
			: t,
	);
}

const SIDE_TURN_REFUSAL = "A question is already waiting for the learner. Answer the side question in text instead.";

function baseAgentOptions(kind: AgentKind, opts: AgentBuildOptions, tools: AgentTool<any, any>[]) {
	// The handler always injects the engine; the outside agent is the fallback.
	const engine = opts.engine ?? agentEngine();
	const stopper = makeQuestionStopper(kind);
	// The doctrine still mentions switched-off tools; the note tells the model they're gone.
	const toolsNote = switchedOffToolsNote(opts.toolToggles, AGENT_SWITCHES[kind]);
	const systemPrompt = [composeInstructions(kind), toolsNote, opts.learnerRules].filter(Boolean).join("\n\n---\n\n");
	const agent = new (agentCore().Agent)({
		identity: APP_IDENTITY,
		sessionId: opts.chatId,
		initialState: {
			systemPrompt,
			model: engine.model,
			tools: opts.sideTurn ? sideTurnTools(tools) : tools,
			messages: opts.messages ?? [],
		},
		streamFn: engine.streamFn,
		// Runs after tool results attach, before turn_end; `{ action: "end" }`
		// exits BEFORE the steering poll, which the registerLiveAgent-before-
		// runPiTurn design depends on. undefined keeps normal scheduling.
		finishTurn: (turn) => (stopper(turn) ? { action: "end" } : undefined),
		// Markers handed to a live run drain from pi's STEERING queue: the
		// lesson loop is one continuous teach→quiz→teach run, so delivery
		// must inject at turn boundaries inside the run. "all" joins every
		// handed marker at one boundary (the default "one-at-a-time" would
		// spend one teacher turn per marker).
		steeringMode: "all",
		// The model-facing conversion: markers flatten to their user text,
		// UI-only markers (plan-block) drop, the app's id fields strip, and
		// an abort's dangling question call gets its INTERRUPTED result. It
		// must never throw (pi's convertToLlm contract).
		convertToLlm: toLlmMessages,
	});
	if (opts.onUsage) {
		agent.subscribe((event: AgentEvent) => {
			if (event.type === "message_end" && event.message.role === "assistant" && "usage" in event.message) {
				// Skip cancelled calls: usage on an aborted message is only
				// partial or estimated.
				if (event.message.stopReason === "aborted") return;
				opts.onUsage!(event.message.usage);
			}
		});
	}
	return agent;
}

/**
 * The PROBER (agent A): one quizzing tool (probe, or recall under free
 * recall; no nodeId either way) + ask + probe_done, lean on
 * probing doctrine. Its whole job is bracketing the learner's edge and
 * concluding with the assessment (probe_done) — which also queues the
 * handoff wake (see tools/probe.ts) and is the transcript seam the
 * handler keys teacher construction on.
 */
export function createProberAgent(ctx: ProberToolContext, opts: AgentBuildOptions = {}) {
	return baseAgentOptions("prober", opts, Object.values(createProberTools(ctx, opts.toolToggles)));
}

/**
 * The TEACHER (agent B): enters at planning (the probe is already
 * concluded — its assessment is in the transcript), owns plan_init and the
 * full toolset (teach questions with validated nodeId, the map, research,
 * demos).
 */
export function createTeacherAgent(
	// Optional so tests can construct a bare mock-driven agent (no storage
	// wiring): without ctx the tools fall back to the validation-free
	// question set. The handler ALWAYS passes ctx (the composition root).
	ctx?: TeacherToolContext,
	opts: AgentBuildOptions = {},
) {
	const tools = opts.tools ?? (ctx ? createTeacherTools(ctx, opts.toolToggles) : bareQuestionTools());
	return baseAgentOptions("teacher", opts, Object.values(tools));
}

/** The bare teach question set (tests, bare agents): quiz with the shared
 *  authoring refinement (quizInputProblems) but NO per-session nodeId
 *  check (no record to read), plus ask. */
export function bareQuestionTools(): Record<string, AgentTool<any>> {
	// A typed const (not an inline literal): the specific AgentTool typing
	// gives execute its precise Static input; heterogeneous records take
	// AgentTool<any>, whose loose Static would smudge it to unknown.
	const quiz: AgentTool<typeof quizInputObject> = {
		name: "quiz",
		label: "quiz",
		description: "Ask the learner a graded question.",
		parameters: quizInputObject,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = quizInputProblems(input);
			if (problems.length > 0) return invalidInputResult("quiz", problems);
			return questionResult();
		},
	};
	return healToolRecord({
		quiz,
		ask_user_question: askUserQuestionTool,
	});
}

/**
 * The PRACTITIONER (practice sessions): built
 * from turn 1 of a kind:"practice" session, with no prober→teacher split.
 * The session runs on problem + conclude, plus the rarely-used read-only
 * file tools, research/pdf, map readers, space tools and save_rule
 * (tools/practice.ts); no plan or question tools. The doctrine prompt
 * (prompts/practice/) carries the method. A successful problem pose ends
 * the run, natively for a problem-only batch and via the shared stop hook
 * for a mixed batch.
 */
export function createPracticeAgent(ctx: PracticeToolContext, opts: AgentBuildOptions = {}) {
	const tools = opts.tools ?? practiceTools(ctx, opts.toolToggles);
	return baseAgentOptions("practice", opts, Object.values(tools));
}

/**
 * STUDY (every new session): the teacher from turn 1, with no prober (the
 * app writes the plan and the study context at birth), plus practice's
 * problem and conclude. The tool list is the same every turn, so the
 * outside agent keeps getting small deltas. A clean problem pose ends the
 * run, as in practice.
 */
export function createStudyAgent(ctx: StudyToolContext, opts: AgentBuildOptions = {}) {
	return baseAgentOptions("study", opts, Object.values(opts.tools ?? createStudyTools(ctx, opts.toolToggles)));
}

/**
 * HOMEWORK: one deadline's problems, one at a time, hints only. Runs on
 * post_problems, problem and conclude plus practice's side tools
 * (tools/homework.ts). A clean problem opening ends the run, as in practice.
 */
export function createHomeworkAgent(ctx: HomeworkToolContext, opts: AgentBuildOptions = {}) {
	return baseAgentOptions("homework", opts, Object.values(opts.tools ?? homeworkTools(ctx, opts.toolToggles)));
}

/**
 * TALK (the teacher's panel): one ongoing chat outside any lesson, for
 * setting up spaces, files and deadlines and quick questions. Its tools
 * are the space actions (tools/talk.ts); no question or teaching tools.
 */
export function createTalkAgent(actions: SpaceActions, opts: AgentBuildOptions = {}) {
	return baseAgentOptions("talk", opts, Object.values(opts.tools ?? talkTools(actions)));
}

type ProberAgent = ReturnType<typeof createProberAgent>;
type TeacherAgent = ReturnType<typeof createTeacherAgent>;
type PracticeAgent = ReturnType<typeof createPracticeAgent>;
type StudyAgent = ReturnType<typeof createStudyAgent>;
type TalkAgent = ReturnType<typeof createTalkAgent>;
export type TeachingAgent = ProberAgent | TeacherAgent | PracticeAgent | StudyAgent | TalkAgent;

