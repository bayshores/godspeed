/**
 * Chat-session contracts — records, summaries, UI extension points.
 * Pure types + protocol docs + tiny pure helpers.
 */
import type { LhMessage } from "../native-messages.ts";
import type { Phase3 } from "../phases.ts";
import type { PlanNodeStatus, PlanTree } from "./plan.ts";
import type { EmissionStats } from "./graph.ts";

// ─── Chat records (the session store's on-disk format) ───────────────────────

/** The session's kind: "teach" is
 *  the default and ABSENT on pre-practice records (no migration — absence
 *  reads as teach); "practice" marks an adaptive-practice session — the
 *  practice agent, its two tools, no extraction, no graph writes. */
export type ChatKind = "teach" | "practice";

/** Every lesson id starts with this (store/chats.ts makes them). The
 *  outside-agent bridge uses it to tell lesson work from background jobs. */
export const CHAT_ID_PREFIX = "chat_";

/** One persisted session: data/chats/<id>.json. The stored messages are
 *  pi-NATIVE history (LhMessage), so the record IS the agent state and
 *  replay is `state.messages = record.messages` + continue(). The client
 *  view is a fold over it (core/view.ts); a pending quiz is an unanswered
 *  tool call, which makes resume-mid-question free. */
export interface ChatRecord {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: LhMessage[];
	/** The session's kind — absent = teach (pre-practice records). */
	kind?: ChatKind;
	/** The class this lesson belongs to —
	 *  ABSENT = "No class" (pre-classes records never migrate; same rule as
	 *  kind). Decides which graph the lesson's facts are written to. */
	classId?: string;
	/** The session's plan tree (vision §2) — written by plan tools via saveTree. */
	tree?: PlanTree;
	/** Append-only usage log: one entry per model
	 * turn. DELIBERATELY a parallel log, not per-message metadata — the client
	 * re-POSTs its message list every turn and its copies never carry
	 * server-stamped fields, so anything inside message objects gets clobbered
	 * by the next persist. Keyed by messageId so the transcript view can fold
	 * each entry onto its message; aggregates are folds over this log
	 * (core/prices.ts). */
	turns?: TurnUsage[];
	/** Append-only background-extraction usage log: one entry per finished
	 *  pipeline run on THIS chat. Same parallel-log discipline as `turns` (nothing rides
	 *  inside messages). Keyed by startedAt; idempotent appends. */
	extractions?: ExtractionRunUsage[];
	/** SCHEMA STAMP: LAZY v1 —
	 *  existing records stay unstamped (absence reads as v1); every write
	 *  stamps the current version. A record stamped NEWER than this build
	 *  (the downgrade scenario) is REFUSED on read: a read-modify-write
	 *  store must never rewrite what it doesn't understand. */
	version?: number;
}

/** The chat record format this build writes and understands. */
export const CURRENT_CHAT_VERSION = 1;


// ─── Background-extraction usage ─────────────────────────────────────────────

/** One pipeline stage's model usage — the stage's model + every step it
 *  ran (CallUsage per agent step). Steps, not a sum: usage and context
 *  folds happen at read time (core/prices.ts). */
export interface ExtractionStageUsage {
	/** The model that ran this stage, provider-qualified ("provider:id")
	 * for Pi catalog lookup at read time. */
	model: string;
	steps: CallUsage[];
}

/** One finished (or failed mid-flight) extraction run's usage record.
 *  Appended to the chat's `extractions` log when the run ends — success or
 *  failure, because tokens were used either way; `stats` is present only
 *  when the merger actually ran. */
export interface ExtractionRunUsage {
	/** The run's registry startedAt (ms) — the idempotency key. */
	startedAt: number;
	at: string;
	durationMs: number;
	/** What the run merged into the graph; absent when it failed first. */
	stats?: EmissionStats;
	/** Model usage per stage (merger is deterministic — no model call, no
	 *  entry). `auditor` only appears on records from before the linking
	 *  stage was folded into the extractor. */
	stages: {
		extractor: ExtractionStageUsage;
		auditor?: ExtractionStageUsage;
	};
}

// ─── Usage accounting ─────────────────────────────────────────────────────────

/** One model call's token accounting (undefined = provider didn't report;
 * renderers show absent, never zero). */
export interface CallUsage {
	/** Pi-normalized fresh input tokens; cache buckets are disjoint. */
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	/** Cached input tokens READ. */
	cacheReadTokens: number | undefined;
	/** Input tokens written to the cache this call (undefined = not
	 * reported). */
	cacheWriteTokens: number | undefined;
	/** Subset of cacheWriteTokens written with one-hour retention. Missing
	 * on older logs; new native captures explicitly record zero if absent. */
	cacheWrite1hTokens?: number;
	/** The reasoning portion of the output tokens. */
	reasoningTokens: number | undefined;
}

/** One usage turn: one full invocation of the teacher (a client turn or a
 * wake turn — same handler, same log). A turn with tool calls spans several
 * agent steps, each recorded separately. Capture lands at the persist seam
 * (server); totals are folded at read time (core/prices.ts). */
export interface TurnUsage {
	/** Unique per REQUEST (turn): one invocation of the handler — the
	 *  idempotency key for the append-only log. Continuation turns share a
	 *  response message id (the SDK coalesces them); keying on messageId
	 *  would swallow their usage. */
	id: string;
	/** The assistant message the turn produced — provenance, keys this
	 *  entry to the transcript (the block this turn "belongs" to). */
	messageId: string;
	at: string;
	/** The model that ran the turn, provider-qualified ("provider:id")
	 * for Pi catalog lookup at read time. */
	model: string;
	/** One entry per agent step (model call) in this turn. */
	steps: CallUsage[];
}

/** The model-facing text of the probe→teach handoff wake (the custom-message
 *  scheme): the wake message carries only the data-probe-handoff part, and
 *  the adapter flattens it to THIS. Single-sourced so the prober's seam, the
 *  tests, and reality can't drift apart.
 *
 *  The wake paces the launch turn: a bare "author now" cue made the
 *  teacher skip the deliberation, so it asks to reason out the optimal
 *  way to teach BEFORE plan_init. Presenting the plan ends the turn; the
 *  learner's next message is a change request or the go-ahead. */
export const HANDOFF_TEXT =
	"Next: plan the full teaching arc from my current understanding to the goal understanding. " +
	"Apply the teaching methodology in your system prompt, and find the optimal way to teach me this. " +
	"Find the unconditional truths, plan the motivated derivations/discoveries, so every reasoning step has to land as obviously true. " +
	"Take your time here and really think this through. " +
	"When it's genuinely reasoned out, call plan_init and present the plan; I'll accept it or ask for changes.";

// ─── Practice sessions — marker + ack texts ─────────────────────────────────
// The model-facing text of every custom marker lives in core/contracts,
// never in the flattening seam.

/** The label newThinkingMessage prefixes a practice submission with. One
 *  send lane: whether a submission claims an answer is read from the
 *  text, not declared by a button. */
export const THINKING_LABEL = "Your thinking";

/** The conclude tool's ack — shared by the executed call (agent layer) and
 *  the dismissal-synthesized pair (input-events), so a concluded problem
 *  reads identically to the model however it concluded. The turn ENDS
 *  after concluding (closing words allowed, no more tool calls); the next
 *  problem waits for the learner's explicit go-ahead. */
export const CONCLUDE_ACK_TEXT =
	"Problem concluded. Say your closing words about the learner's work if useful, then END YOUR TURN — no further tool calls. The next problem is NEVER posed here: it waits for the learner's explicit go-ahead (a *Next problem* message, or their own words asking for the next one). Between problems, answer their questions about the concluded one.";

/** The learner's explicit move-on signal: the model-facing text of the
 *  practice-next marker. */
export const NEXT_PROBLEM_TEXT =
	"[NEXT PROBLEM] — the learner's explicit go-ahead: pose the next problem now per the selection rules, or wrap the session in text if the arc is complete.";

/** The compaction marker's model-facing header. The marker's content is
 *  this header + the summary, in place of the dropped span. It tells the
 *  model the cut is routine, the summary replaces everything before it,
 *  and what follows is verbatim, so it neither re-asks covered ground nor
 *  distrusts the seam. */
export const COMPACTED_HISTORY_HEADER =
	"[SESSION HISTORY COMPACTED] The transcript before this point was summarized to fit the context window; the summary below replaces it. Everything after this message is the verbatim recent transcript.";


/** A SNAPSHOT of the plan at plan_init, rendered as a block in the chat
 *  flow. It never reaches the model; it reappears identically on reload
 *  because it lives in the record. */
export interface PlanBlockData {
	/** The plan renders IN FLOW once, at authoring; position derives live
	 *  from the transcript. */
	kind: "full";
	at: string;
	/** The current node at snapshot time (the glow target; null = none). */
	current: string | null;
	/** All nodes of the authored tree. Statuses are the snapshot's,
	 * derived at emission time — the block never re-derives at render. */
	nodes: Array<{ id: string; title: string; status: PlanNodeStatus }>;
	edges: Array<{ from: string; to: string }>;
}

/** The list view's shape (messageCount instead of full messages) + the
 *  per-session status the picker renders. `phase` and `pendingQuestion`
 *  derive from the stored record's native messages; the store computes
 *  them in listChats. Liveness (`busy`) is NOT record-derived — the API
 *  route merges it in (see ChatListItem).
 *
 *  Phase semantics (three phases, event-driven —
 *  docs/archive/probe-teach-split.md §4): probe ends at a concluded
 *  probe_done (clean result, not ok:false); plan ends at the first
 *  quiz/explain call tagged with a nodeId; derived from the native
 *  transcript (core/phases.ts phaseAt3Lh).
 */
export interface ChatSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	/** Normalized kind (absent record field reads as teach). */
	kind: ChatKind;
	/** The lesson's class — absent = "No class". */
	classId?: string;
	messageCount: number;
	/** The session's current phase, derived from the native transcript (phaseAt3Lh). */
	phase: Phase3;
	/** An unanswered quiz/ask question is waiting for the learner. */
	pendingQuestion: boolean;
	/** Practice sessions: a posed problem with no conclude —
	 *  the sidebar meta's "Problem waiting". Absent on teaching sessions. */
	pendingProblem: boolean;
}

/** The sidebar's session row: a summary + live liveness. The chats list
 *  route attaches `busy` from the turn-liveness registry ONLY — a running
 *  teach turn (background jobs show in the sidebar's Background agents
 *  section, so the row spinner means exactly "a turn is in flight"). The store itself
 *  can't see liveness (import law: store never imports server), hence the
 *  split at exactly the record/liveness seam. */
export interface ChatListItem extends ChatSummary {
	busy: boolean;
	/** Live compaction liveness (turn-liveness's twin): true while a
	 *  background context compaction holds the chat's model gate. The
	 *  route attaches it from the compaction registry — never
	 *  record-derived (the marker persists, the RUN is ephemeral). */
	compacting: boolean;
}

// ─── Artifact renderer registry (client extension point) ────────────────────

/**
 * src/components/chat.tsx renders any tool part it doesn't specially handle via
 * src/components/artifacts/index.ts's registry, keyed by tool name ("research",
 * "demo", "visual", …). Workers add renderers there — chat.tsx is off-limits
 * to artifact work. Renderer receives the raw tool part; it typically renders
 * an activity card while state is input-available (poll /api/jobs) and the
 * artifact (iframe / svg) when output-available.
 */
export interface ArtifactPartProps {
	part: {
		type: string;
		state: string;
		toolCallId: string;
		input?: unknown;
		output?: unknown;
		/** The pose-side fold: the whole problem-call
		 * arguments joined onto the conclude part by projectView — the
		 * observability drawer's data. */
		problemInput?: unknown;
		/** The view-seam join for conclude cards:
		 *  the modelSolution committed at POSE time, folded onto the part by
		 *  projectView — the reveal is never re-authored. */
		reveal?: unknown;
	};
}
