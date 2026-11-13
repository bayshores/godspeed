/**
 * Chat-session contracts — records, summaries, UI extension points.
 * Pure types + protocol docs + tiny pure helpers.
 */
import type { LhMessage } from "../native-messages.ts";
import type { Phase3 } from "../phases.ts";
import type { PlanNodeStatus, PlanTree } from "./plan.ts";
import type { EmissionStats } from "./graph.ts";
import type { QuestionAnswerData } from "../question-core.ts";

// ─── Chat records (the session store's on-disk format) ───────────────────────

/** The session's kind. "study" is every new session: the teacher plus
 *  the practice tools, per topic (core/study.ts). "teach" (prober then
 *  teacher; ABSENT on old records, absence reads as teach) and "practice"
 *  (the practice agent, its two tools, no extraction) are older sessions
 *  that keep working as they were. "homework" works on one deadline's
 *  problems with hints only (core/homework.ts). "talk" is the one Talk
 *  chat in the teacher's panel (TALK_CHAT_ID), never a lesson. */
export type ChatKind = "teach" | "practice" | "study" | "homework" | "talk";

/** A lesson's kind: every kind but Talk. */
export type LessonKind = Exclude<ChatKind, "talk">;

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
	/** The space this lesson belongs to —
	 *  ABSENT = "No space" (pre-spaces records never migrate; same rule as
	 *  kind). Decides which graph the lesson's facts are written to. */
	spaceId?: string;
	/** The deadline a Study session was started from; absent for any other
	 *  start (and on records from before). Its Study button reopens it. */
	deadlineId?: string;
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
	/** SCHEMA STAMP: lazy —
	 *  existing records stay unstamped (absence reads as v1); every write
	 *  stamps the current version. v2: `classId`, the "class-context" card
	 *  and a deadline request's `className` are named for spaces. v3: no
	 *  field changes, but new markers (keep-going, opener-answer, app-note)
	 *  and stops in result details, which an older build would send to the
	 *  agent as empty messages. A record stamped NEWER than this build
	 *  (the downgrade scenario) is REFUSED on read: a read-modify-write
	 *  store must never rewrite what it doesn't understand. */
	version?: number;
}

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

// ─── Practice sessions — marker + ack texts ─────────────────────────────────
// The model-facing text of every custom marker lives in core/contracts,
// never in the flattening seam.

/** The conclude tool's ack — shared by the executed call (agent layer) and
 *  the dismissal-synthesized pair (input-events), so a concluded problem
 *  reads identically to the model however it concluded. The turn ENDS
 *  after concluding (closing words allowed, no more tool calls); the next
 *  problem waits for the learner's explicit go-ahead, which asking for a
 *  different problem or part is. */
export const CONCLUDE_ACK_TEXT =
	"Problem concluded. Say your closing words about the learner's work if useful, then END YOUR TURN — no further tool calls. The next problem waits for the learner's explicit go-ahead (a *Next problem* message, or their own words asking for the next one). The one exception: when the learner asked for a different problem or part, that ask is the go-ahead, so pose it now. Between problems, answer their questions about the concluded one.";

/** The Study tool that stores a finished topic's review question and the
 *  next topic's opener. Its result ends the agent's turn. */
export const TOPIC_DONE_TOOL = "topic_done";

/** A place to stop, carried in the result details of the call that made
 *  it: a study conclude or topic_done (a topic end), or a conclude after a
 *  long problem. `at` is ISO; `activeMinutes` counts since the last stop. */
export type StopDetails =
	| { kind: "topic"; nodeId: string; activeMinutes: number; at: string }
	| { kind: "problem"; activeMinutes: number; at: string };

/** topic_done's result details. `lead` is the opener's lead with its
 *  source marks checked; `stop` is set only for a topic a right quiz ended. */
export interface TopicDoneDetails {
	part: "topic_done";
	v: 1;
	lead?: string;
	stop?: StopDetails;
}

/** The keep-going marker's details: the call carrying the stop it answers. */
export interface KeepGoingDetails {
	stopOf: string;
	at: string;
}

/** The opener-answer marker's details. A null answer is a skip. */
export interface OpenerAnswerDetails {
	topicDoneCallId: string;
	answer: QuestionAnswerData | null;
}

/** The quiz call a question from earlier was first asked by. */
export interface ReviewOf {
	chatId: string;
	toolCallId: string;
}

/** A question from earlier as POST /api/chats/{id}/review serves it: its
 *  source, its topic and a copy of the quiz. */
export interface ReviewQuestion {
	of: ReviewOf & { messageId?: string };
	nodeId: string;
	topic: string;
	quiz: { question: string } & Record<string, unknown>;
}

/** The review marker's details: the question, his graded answer and the
 *  start of the sitting it was answered in. */
export interface ReviewDetails extends ReviewQuestion {
	answer: QuestionAnswerData;
	sitting: string;
}

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
 *  Phase semantics (three phases, event-driven): probe ends at a concluded
 *  probe_done (clean result, not ok:false); plan ends at the first
 *  quiz/explain call tagged with a nodeId; derived from the native
 *  transcript (core/phases.ts phaseAt3Lh).
 */
interface ChatSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	/** Normalized kind (absent record field reads as teach). The Talk chat
	 *  is never listed. */
	kind: LessonKind;
	/** The lesson's space — absent = "No space". */
	spaceId?: string;
	/** The deadline a Study session was started from. */
	deadlineId?: string;
	messageCount: number;
	/** The session's current phase, derived from the native transcript (phaseAt3Lh). */
	phase: Phase3;
	/** An unanswered quiz/ask question is waiting for the learner. */
	pendingQuestion: boolean;
	/** A posed problem with no conclude is waiting for the learner. */
	pendingProblem: boolean;
}

/** The lesson list's row: a summary + live liveness. The chats list
 *  route attaches `busy` from the turn-liveness registry ONLY: a running
 *  teach turn (background jobs show on the transcript's dispatch cards,
 *  so the row's busy mark means exactly "a turn is in flight"). The store itself
 *  can't see liveness (import law: store never imports server), hence the
 *  split at exactly the record/liveness seam. */
export interface ChatListItem extends ChatSummary {
	busy: boolean;
}

// ─── Artifact renderer registry (client extension point) ────────────────────

/**
 * src/frontend/components/chat.tsx renders any tool part it doesn't specially handle via
 * src/frontend/components/artifacts/index.ts's registry, keyed by tool name ("research",
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
