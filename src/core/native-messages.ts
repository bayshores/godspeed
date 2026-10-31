/**
 * THE NATIVE MESSAGE RECORD: chat records store pi's own message shapes —
 * the exact history the agent loop builds. Provider, model, usage,
 * stopReason, and thinking signatures are stamped by pi itself; replay is
 * `state.messages = record.messages` + `continue()` — the record IS the
 * agent state.
 *
 * WHY pi MESSAGES LACK OUR `id`: pi's session format gives every ENTRY an
 * id, never the message. This app needs a per-message id for client
 * identity (React keys, append-only adoption, the continuation seam), so
 * every record message carries ONE extra field — `id` — alongside the
 * native shape. `toLlmMessages` strips it at the wire: the provider never
 * sees it (verified single site, below).
 *
 * UI-ONLY CONTENT: the probe→teach handoff, sub-agent steers,
 * and plan blocks are LhMarkerMessage — this app's declaration-merged
 * member of pi-agent-core's CustomAgentMessages extension point, shaped
 * exactly like pi's own CustomMessage ({role:"custom", customType,
 * content, display, details}). ONE seam — toLlmMessages, wired as the
 * agent's convertToLlm — owns every model-facing decision: markers
 * flatten to their canonical user text (single-sourced in
 * core/contracts), plan blocks are UI-only and filtered, and dangling
 * tool calls (an aborted turn) get the interrupted-result synthesis the
 * provider protocol demands.
 *
 * Answers: the learner's answer IS the tool call's ToolResultMessage —
 * appended natively at answer time. The synthetic "question posed"
 * placeholder is an in-memory loop device (terminate) and is never
 * persisted: the record ends at the
 * unanswered call in the pose→answer window, where no turn can run (the
 * question gate holds steers; a POST would 409).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { QUESTION_TOOLS } from "./pending.ts";
import {
	CONCLUDE_ACK_TEXT,
	HANDOFF_TEXT,
	NEXT_PROBLEM_TEXT,
	THINKING_LABEL,
} from "./contracts/chat.ts";
import type { ClassFileStatus } from "./contracts/class.ts";
import { compactAnswerForModel, type QuestionAnswerData } from "./question-core.ts";
import { activeCompactionOf, keptIndexFor } from "./compaction.ts";
import { newMessageId } from "./message-id.ts";
import type { AttachmentPart } from "./attachments.ts";

/** The hard-invariant wording for an aborted turn's unanswered calls.
 *  Keep it verbatim so the model's view never drifts. */
const INTERRUPTED_TEXT =
	"The question was interrupted — the learner never answered; continue without holding a result for it.";

// ─── The record's message type ───────────────────────────────────────────────

/**
 * The app's custom message (declaration-merged into pi-agent-core's
 * CustomAgentMessages below). Shaped like pi's own CustomMessage —
 * `content` is the MODEL-facing text (single-sourced in core/contracts,
 * never fake human speech), `details` is the UI payload (never
 * model-visible), `display` marks messages the UI renders (our projection
 * keys rendering on customType; the flag documents intent).
 */
export interface LhMarkerMessage {
	/** Record identity (pi messages carry no id — see the file header). */
	id: string;
	role: "custom";
	customType:
		| "graph-context"
		| "class-context"
		| "today-context"
		| "probe-handoff"
		| "subagent-steer"
		| "subagent-abort"
		| "plan-block"
		| "practice-thinking"
		| "practice-next"
		| "problem-dismissed"
		| "compaction";
	/** The model-facing text ("" for plan blocks — UI-only). */
	content: string;
	/** Model-facing files after the text: a thinking submission's pictures and PDF notes. */
	attachments?: AttachmentPart[];
	display: boolean;
	/** The UI payload — per-customType, never model-visible. */
	details: unknown;
	timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		lhMarker: LhMarkerMessage;
	}
}

/** A record message: a native pi message (or our marker) plus the record id. */
export type LhMessage = (UserMessage | AssistantMessage | ToolResultMessage | LhMarkerMessage) & { id: string };

/** A record message list is assignable to the agent's context — that IS
 *  the replay (ui-stream/chat-handler assign it to initialState.messages). */
export function asAgentMessages(messages: readonly LhMessage[]): AgentMessage[] {
	return messages as unknown as AgentMessage[];
}

// ─── explicit learner-facing output ─────────────────────────────────────────

export const SEND_TO_USER_TOOL = "send_to_user";

/** Read the output tool's message without changing the native call. Also
 * accepts partial arguments while streaming; malformed/empty inputs carry
 * no prose. This projection is independent of the currently selected model. */
export function sendToUserText(block: unknown): string | undefined {
	if (!block || typeof block !== "object") return undefined;
	const call = block as { type?: unknown; name?: unknown; arguments?: unknown };
	if (call.type !== "toolCall" || call.name !== SEND_TO_USER_TOOL) return undefined;
	if (!call.arguments || typeof call.arguments !== "object") return undefined;
	const message = (call.arguments as { message?: unknown }).message;
	return typeof message === "string" && message.trim() ? message : undefined;
}

/** Learner-facing prose, in content order. Only the explicit output tool
 * joins ordinary text here — thinking and all other tool inputs stay out.
 * Shared by coverage/extraction and Markdown; native history stays intact. */
export function userFacingTextOf(content: unknown, failedOutputCalls?: ReadonlySet<string>): string[] {
	if (typeof content === "string") return content.trim() ? [content] : [];
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "toolCall" && failedOutputCalls?.has(block.id)) continue;
		const text = block.type === "text" ? block.text : sendToUserText(block);
		if (typeof text === "string" && text.trim()) out.push(text);
	}
	return out;
}

/** Failed output calls remain retry context, not delivered teaching.
 * Truncated calls can have valid-looking partial arguments. Failed/aborted
 * generations do not execute their calls at all, so may have no result. */
export function failedOutputCallIds(messages: readonly LhMessage[]): ReadonlySet<string> {
	const failed = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult" && message.toolName === SEND_TO_USER_TOOL && message.isError) {
			failed.add(message.toolCallId);
		} else if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
			for (const block of message.content) {
				if (block.type === "toolCall" && block.name === SEND_TO_USER_TOOL) failed.add(block.id);
			}
		}
	}
	return failed;
}

// ─── constructors (the input-event → native append mapping lives in
//     core/input-events.ts; steers in core/contracts/jobs.ts) ─────────────────

/** A learner-authored user message (text input, verdict note). Files ride
 *  as content parts after the text; a message with files may have no text. */
export function newUserMessage(text: string, attachments: readonly AttachmentPart[] = []): LhMessage & UserMessage {
	return {
		id: newMessageId(),
		role: "user",
		content: attachments.length === 0 ? text : [...(text.trim() ? [{ type: "text" as const, text }] : []), ...attachments],
		timestamp: Date.now(),
	};
}

/** A steered user message (mid-turn composer steering):
 *  a plain user message with the CLIENT-minted steer id — the same object
 *  rides agent.steer(), the live stream's message events, and the settled
 *  record, so the optimistic queued indicator and the transcript card
 *  upsert by one identity. */
export function newUserSteer(text: string, id: string): LhMessage & UserMessage {
	return { id, role: "user", content: text, timestamp: Date.now() };
}

/** The learner's answer — the question call's tool result.
 *  TWO AUDIENCES: the MODEL sees the
 *  compact learner-only record (compactAnswerForModel — the call's own
 *  arguments already carry the question/options/explanation/commitment;
 *  restating them would double every answer's tokens), while `details` keeps
 *  the FULL graded QuestionAnswerData for the record and the UI. */
export function newAnswerResult(
	toolCallId: string,
	toolName: string,
	answer: unknown,
): LhMessage & ToolResultMessage {
	return {
		id: newMessageId(),
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: JSON.stringify(compactAnswerForModel(answer as QuestionAnswerData)) }],
		// ToolResultMessage.details is JsonRepresentation —
		// our payloads are JSON-safe answer structures, so the cast is honest.
		details: answer as ToolResultMessage["details"],
		isError: false,
		timestamp: Date.now(),
	};
}

/** The probe→teach handoff wake: scaffolding, not speech — the model reads
 *  HANDOFF_TEXT, the UI renders the quiet system line. */
export function newHandoffMessage(chatId: string): LhMarkerMessage {
	return {
		id: `steer_probe_${chatId}`,
		role: "custom",
		customType: "probe-handoff",
		content: HANDOFF_TEXT,
		display: true,
		details: { chatId },
		timestamp: Date.now(),
	};
}

/** The plan presentation block: pure UI history (a frozen snapshot), no
 *  model face — toLlmMessages filters it. `planCallId` keys idempotent
 *  emission (one block per successful plan_init call). */
export function newPlanBlockMessage(
	planCallId: string,
	block: unknown,
): LhMarkerMessage {
	return {
		id: `pb_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		role: "custom",
		customType: "plan-block",
		content: "",
		display: true,
		details: { planCallId, block },
		timestamp: Date.now(),
	};
}

// ─── practice sessions ───────────────────────────────────────────────────────

/** The practice agent's two tools (the conclude-before-next-problem gate's
 *  vocabulary — the tool-execute layer owns the tools themselves). */
export const PRACTICE_PROBLEM_TOOL = "problem";
export const PRACTICE_CONCLUDE_TOOL = "conclude";

/** One picked proposition of the graph-context marker (the learner's map
 *  pick — name + statement as the learner SAW them at pick time). */
export interface GraphContextPick {
	id: string;
	name: string;
	statement: string;
}

/** The session's map context: a SEPARATE custom
 *  message BEFORE the learner's first user message — the picked
 *  propositions plus the reasoning chains among them (pre-formatted
 *  lines, formatChainLine shape). The model reads `content` (flattened
 *  to a user message by toLlmMessages like every marker); `details`
 *  feeds the transcript's collapsible GraphContextCard. */
export function newGraphContextMessage(picks: readonly GraphContextPick[], chains: readonly string[]): LhMarkerMessage {
	// IDS FIRST (the mastery-trace contract):
	// each proposition is introduced ONCE with its id, name, and statement;
	// the problem tool's `target` field takes these ids (names normalize to
	// ids at the seam). Chains below stay NAMES — they are comprehension
	// context, not tags; names read, ids reference.
	const lines = [
		// PREAMBLE LAW: custom markers flatten to
		// USER-role messages on the wire (toLlmMessages) — this text arrives
		// in the learner's voice channel, so it must not read like a system
		// broadcast. The bracket convention (NEXT_PROBLEM_TEXT's kin) marks
		// it honestly as injected session context, not learner speech.
		"[Session context] — picked from the learner's knowledge map when starting this session:",
		"",
		"Propositions (id — name: statement; the problem tool's target field uses these ids):",
		...picks.map((p) => `- [${p.id}] ${p.name}: ${p.statement}`),
	];
	if (chains.length > 0) {
		lines.push("", "Reasoning chains among them (premises → conclusion):", ...chains.map((c) => `- ${c}`));
	}
	return {
		id: newMessageId(),
		role: "custom",
		customType: "graph-context",
		content: lines.join("\n"),
		display: true,
		details: { propositions: picks, chains },
		timestamp: Date.now(),
	};
}

// ─── classes ─────────────────────────────────────────────────────────────────

/** One file line of the class card. `path` is where the teacher can read
 *  it (a recording's transcript once it exists; null when not readable). */
export interface ClassCardFile {
	name: string;
	kind: "study" | "info";
	path: string | null;
	/** Once indexed for search: "98 pages", "52 min", "420 lines". */
	size?: string;
	/** Shown when not "ready" (still being read, failed…). */
	status?: ClassFileStatus;
}

/** The class card's UI payload (the transcript's collapsible card). */
export interface ClassCardDetails {
	classId: string;
	name: string;
	description: string;
	files: ClassCardFile[];
	/** The class graph's topics with their fact counts. */
	topics?: { name: string; facts: number }[];
}

/** The model-facing class card text. Bracket-labelled like the graph
 *  context (PREAMBLE LAW: markers flatten to user-role messages, so the
 *  card must read as injected context, never learner speech). Data only:
 *  how to use it is doctrine (prompts/shared/12-class-context.md). */
export function classCardText(card: ClassCardDetails): string {
	const lines = [
		"[Class context] — this lesson belongs to a course the learner is taking:",
		"",
		`Class: ${card.name}`,
	];
	if (card.description.trim()) lines.push("", "About the class (the learner's own words):", card.description.trim());
	const readable = card.files.filter((f) => f.path !== null);
	if (readable.length > 0) {
		lines.push("", "Class files (study material = turned into the class's knowledge graph; course info = syllabus, assignments, logistics):");
		for (const f of readable) {
			const about = [f.size, f.status && f.status !== "ready" ? f.status : undefined].filter(Boolean).join(", ");
			lines.push(`- [${f.kind === "study" ? "study material" : "course info"}] ${f.name}${about ? ` (${about})` : ""} — ${f.path}`);
		}
	}
	if (card.topics?.length) {
		lines.push("", "Topics in the class's knowledge graph (facts in each):", card.topics.map((t) => `${t.name} (${t.facts})`).join(", "));
	}
	return lines.join("\n");
}

export function newClassContextMessage(card: ClassCardDetails): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "class-context",
		content: classCardText(card),
		display: true,
		details: card,
		timestamp: Date.now(),
	};
}

/** The [Today] note: today's date and the class's open
 *  deadlines, for the model only (`display: false`; the view renders
 *  nothing). Bracket-labelled per the PREAMBLE LAW. `details.day` is the
 *  local day it was written for (core/today-note.ts decides when a new one
 *  is due). */
export function newTodayContextMessage(text: string, day: string): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "today-context",
		content: text,
		display: false,
		details: { day },
		timestamp: Date.now(),
	};
}

/** The learner's thinking submission (ONE send lane): no button declares
 *  the register — the model READS the text to tell working traces from
 *  claimed answers. The
 *  content label is the single "Your thinking"; `details` keeps the raw
 *  payload for the transcript card. One problem may carry many
 *  submissions. */
export function newThinkingMessage(problemCallId: string, text: string, attachments: readonly AttachmentPart[] = []): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-thinking",
		content: `${THINKING_LABEL}:\n${text}`,
		...(attachments.length > 0 ? { attachments: [...attachments] } : {}),
		display: true,
		details: { problemCallId, text },
		timestamp: Date.now(),
	};
}

/** The learner's explicit move-on signal: appended by
 *  the next input (the composer band's chip, or Enter on an empty
 *  composer during the between-problems pause). The content is the
 *  single-sourced NEXT_PROBLEM_TEXT — the model's unambiguous go-ahead;
 *  the transcript renders its own compact line off the marker (never
 *  the content). */
export function newNextMessage(): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-next",
		content: NEXT_PROBLEM_TEXT,
		display: true,
		details: {},
		timestamp: Date.now(),
	};
}

/** The problem-dismissal marker (ask-style discard):
 *  UI-ONLY — toLlmMessages filters it. The model's face arrives later, at
 *  the user's next input, as the synthesized conclude pair
 *  (concludedByDismissalPair below) — the agent sees the dismissal as a
 *  conclude call it "made" with outcome "dismissed", so the slot-freed
 *  state and the dismissal read through the one vocabulary it owns. */
export function newProblemDismissedMarker(problemCallId: string): LhMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "problem-dismissed",
		content: "",
		display: true,
		details: { problemCallId },
		timestamp: Date.now(),
	};
}

/** The dismissal's deferred conclude: the pair
 *  prepended to the user's NEXT input — a synthetic assistant message
 *  carrying a conclude call (outcome "dismissed") plus its ack result, so
 *  both the record and the model context read the problem as concluded
 *  by dismissal, slot freed. Pure; ids are deterministic off the problem
 *  call id (idempotent shape — the pending-dismissal gate guarantees the
 *  pair appends at most once per marker). */
export function concludedByDismissalPair(
	problemCallId: string,
): [LhMessage & AssistantMessage, LhMessage & ToolResultMessage] {
	const callId = `call_conc_${problemCallId}`;
	const now = Date.now();
	// The stamps are placeholders by design: history serialization reads
	// ONLY the content blocks (verified in pi-ai's converters), and usage
	// lives in the parallel turns log, never message objects — so
	// "synthetic" never corrupts a wire view or a usage fold.
	const syntheticStamps = {
		api: "faux",
		provider: "synthetic",
		model: "synthetic-conclude",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
	} as const;
	return [
		{
			id: newMessageId(),
			role: "assistant",
			content: [{ type: "toolCall", id: callId, name: PRACTICE_CONCLUDE_TOOL, arguments: { outcome: "dismissed" } }],
			timestamp: now,
			...syntheticStamps,
		},
		{
			id: newMessageId(),
			role: "toolResult",
			toolCallId: callId,
			toolName: PRACTICE_CONCLUDE_TOOL,
			content: [{ type: "text", text: CONCLUDE_ACK_TEXT }],
			details: { outcome: "dismissed", problemCallId },
			isError: false,
			timestamp: now,
		},
	];
}

/** The ids of tool calls whose results are CLEAN (not errored) — the only
 *  calls that ever happened (HONEST ACTIVATION, see activeProblemOf). */
function cleanToolCallIds(messages: readonly LhMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const result = m as ToolResultMessage;
		if (!result.isError) ids.add(result.toolCallId);
	}
	return ids;
}

/** The conclusion's reveal: the hero of a
 *  conclude card is the modelSolution committed at POSE time — the newest
 *  cleanly-posed problem BEFORE this conclude call. The reveal is never
 *  re-authored (the conclude schema has no solutionReveal); stored conclude
 *  inputs that still carry their own solutionReveal fall back to it at the
 *  card. Undefined when the pose carries no string solution. */
export function modelSolutionForConclude(
	messages: readonly LhMessage[],
	concludeCallId: string,
): string | undefined {
	const input = problemInputForConclude(messages, concludeCallId);
	return typeof input?.modelSolution === "string" ? input.modelSolution : undefined;
}

/** The full pose-side fold:
 * EVERYTHING the agent filled into the problem call — mode, target ids,
 * statement, the committed solution — joined onto the conclude part so
 * the card's collapsible "agent's data" drawer renders pure. Same walk
 * and refusal law as the reveal: a pose the record never acked (a
 * refused call) folds nothing. */
export function problemInputForConclude(
	messages: readonly LhMessage[],
	concludeCallId: string,
): { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown } | undefined {
	let mi = messages.findIndex(
		(m) =>
			(m as { role?: string }).role === "assistant" &&
			(m as AssistantMessage).content.some(
				(b) => b.type === "toolCall" && b.id === concludeCallId,
			),
	);
	if (mi < 0) return undefined;
	const clean = cleanToolCallIds(messages);
	for (; mi >= 0; mi--) {
		const m = messages[mi]!;
		if ((m as { role?: string }).role !== "assistant") continue;
		const assistant = m as AssistantMessage;
		for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
			const block = assistant.content[bi]!;
			if (block.type !== "toolCall" || block.name !== PRACTICE_PROBLEM_TOOL) continue;
			if (!clean.has(block.id)) continue; // a refused pose revealed nothing
			return (block.arguments ?? undefined) as
				| { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown }
				| undefined;
		}
	}
	return undefined;
}

/** The active-problem fold (the conclude-before-next-problem gate): the
 *  NEWEST problem tool call with nothing concluding after it — either a
 *  conclude call or a dismissal marker deactivates. The ack result at pose
 *  time does NOT (the problem stays on screen through nudges; the dock's
 *  subject is the call, not a dangling result). */
export function activeProblemOf(
	messages: readonly LhMessage[],
): { toolCallId: string; input: unknown } | null {
	// HONEST ACTIVATION:
	// calls count only through their RESULTS — a problem activates on its
	// clean ack, a conclude frees on its clean ack; errored and dangling
	// calls are skipped ("either it goes through or it doesn't").
	const cleanCallIds = cleanToolCallIds(messages);
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as LhMarkerMessage;
			if (marker.customType === "problem-dismissed") return null;
			continue;
		}
		if (role === "assistant") {
			const assistant = m as AssistantMessage & { id: string };
			for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
				const block = assistant.content[bi]!;
				if (block.type !== "toolCall") continue;
				if (block.name === PRACTICE_CONCLUDE_TOOL) {
					if (cleanCallIds.has(block.id)) return null; // a CLEAN conclude frees
					continue; // errored/dangling conclude: the free never happened
				}
				if (block.name !== PRACTICE_PROBLEM_TOOL) continue;
				if (cleanCallIds.has(block.id)) return { toolCallId: block.id, input: block.arguments };
				// errored/dangling pose — it did not go through; keep scanning
			}
			continue;
		}
	}
	return null;
}

/** Is a problem-dismissal marker waiting for its conclude synthesis? The
 *  text/continue appends read this: the pair rides the user's next input
 *  (input-events). Newest-marker-wins scan: the first dismissal marker or
 *  conclude call from the end decides. */
export function pendingProblemDismissalOf(messages: readonly LhMessage[]): string | null {
	const cleanCallIds = cleanToolCallIds(messages);
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as LhMarkerMessage;
			if (marker.customType === "problem-dismissed") {
				return (marker.details as { problemCallId?: unknown }).problemCallId as string;
			}
			continue;
		}
		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
				const block = assistant.content[bi]!;
				if (block.type !== "toolCall" && block.type !== "text") continue;
				if (block.type === "toolCall" && block.name === PRACTICE_CONCLUDE_TOOL) {
					if (cleanCallIds.has(block.id)) return null; // a CLEAN conclude settles it
					continue; // errored/dangling: it never happened
				}
				if (block.type === "toolCall" && block.name === PRACTICE_PROBLEM_TOOL) {
					if (cleanCallIds.has(block.id)) return null; // a CLEAN pose supersedes it
					continue;
				}
			}
			continue;
		}
	}
	return null;
}

// ─── the one model-facing seam (the agent's convertToLlm) ────────────────────

/** The ids of every toolResult in the tail (for the dangling-call scan). */
function resultIdsFrom(messages: readonly AgentMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role === "toolResult") {
			ids.add((m as ToolResultMessage).toolCallId);
		}
	}
	return ids;
}

/**
 * AgentMessage[] → the provider wire (the agent's convertToLlm — required
 * by pi-agent-core's loop config, the ONE place model-facing decisions
 * live):
 *
 * - user / assistant / toolResult pass through VERBATIM — signatures,
 *   usage, provider stamps all native — minus our record-`id` field.
 * - markers flatten to a user message carrying their content (the
 *   canonical text single-sourced in core/contracts); plan blocks are
 *   UI-only and filtered.
 * - dangling tool calls (an aborted turn's unanswered questions) get the
 *   synthesized interrupted result — the provider protocol's hard
 *   invariant: a tool call must be followed by its result.
 *
 * Contract (pi-agent-core): never throws — an unknown shape passes
 * through untouched rather than killing the loop.
 */
export function toLlmMessages(messages: readonly AgentMessage[]): Message[] {
	// THE COMPACTION CUT: the ACTIVE marker
	// (the newest — chained compactions rule last) names the first kept
	// message; everything before it is replaced by the marker's content
	// (header + summary) rendered ONCE, up top. The marker itself is then
	// skipped in place — it must never render twice. A cut naming a
	// missing id degrades honestly (everything renders — never throw).
	const lhMessages = messages as readonly LhMessage[];
	const active = activeCompactionOf(lhMessages);
	let start = 0;
	let head: Message | null = null;
	if (active) {
		const kept = keptIndexFor(lhMessages, active);
		if (kept > 0) {
			start = kept;
			head = {
				role: "user",
				content: [{ type: "text", text: active.content }],
				timestamp: active.timestamp,
			};
		}
	}
	// THE LEADING SYSTEM MESSAGE IS REQUEST CHROME, NEVER COMPACTABLE
	// PAYLOAD:
	// pi-agent-core's Agent seeds a SystemMessage carrying the system
	// prompt AND the tool declarations at state.messages[0]
	// (createInitialSystemMessage — "messages declare the provider-visible
	// loadout"). The record never persists it (ui-stream's settleWith
	// filters the role), so RECORD-path callers never see it — but the
	// Agent's convertToLlm DOES. The cut slices the RECORD's history;
	// when [0] is the chrome it must carry through AHEAD of the
	// compaction head, exactly as pi's own prepareRequest re-applies
	// context.systemPrompt + context.tools around its projection.
	const leading =
		(messages[0] as { role?: string } | undefined)?.role === "system" ? (messages[0] as Message) : null;
	const out: Message[] = [];
	if (leading) out.push(leading);
	if (head) out.push(head);
	for (let i = leading ? Math.max(start, 1) : start; i < messages.length; i++) {
		const m = messages[i]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as LhMarkerMessage;
			// UI-only markers: plan blocks, and problem dismissals (the
			// synthesized conclude pair carries the model's face).
			if (marker.customType === "plan-block" || marker.customType === "problem-dismissed") continue;
			// The ACTIVE compaction marker already rendered as the head —
			// never twice. (Stale markers before the cut are unreachable; a
			// marker whose cut could not resolve has no head and renders as
			// its user text — honest degradation.)
			if (marker.customType === "compaction" && head !== null && marker.id === active!.id) continue;
			out.push({
				role: "user",
				content: [{ type: "text", text: marker.content }, ...(marker.attachments ?? [])],
				timestamp: marker.timestamp,
			});
			continue;
		}
		// Strip the record id: the wire carries the native shape only.
		const { id: _id, ...native } = m as LhMessage;
		out.push(native as Message);
		// Dangling-call synthesis: an assistant message whose toolCalls have
		// no results in the remaining tail (abort mid-question) — the
		// provider rejects unanswered calls outright.
		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			const calls = assistant.content.filter((b) => b.type === "toolCall");
			if (calls.length === 0) continue;
			const answered = resultIdsFrom(messages.slice(i + 1));
			for (const call of calls) {
				if (answered.has(call.id)) continue;
				out.push({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [{ type: "text", text: INTERRUPTED_TEXT }],
					isError: false,
					timestamp: assistant.timestamp,
				});
			}
		}
	}
	return out;
}

// ─── native scans ────────────────────────────────────────────────────────────

/** The pending-question gate (findPendingToolCall's native twin): the
 *  NEWEST assistant message's FIRST question-tool call with no result in
 *  the tail — one question at a time, the dock's subject. */
export function danglingQuestionOf(
	messages: readonly LhMessage[],
): { toolCallId: string; tool: string; input: unknown } | null {
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		if ((m as { role?: string }).role !== "assistant") continue;
		const assistant = m as AssistantMessage & { id: string };
		const answered = resultIdsFrom(messages.slice(mi + 1));
		for (const block of assistant.content) {
			if (block.type !== "toolCall") continue;
			if (!(QUESTION_TOOLS as readonly string[]).includes(block.name)) continue;
			if (answered.has(block.id)) continue;
			return { toolCallId: block.id, tool: block.name, input: block.arguments };
		}
		return null; // the newest assistant message's questions are all answered
	}
	return null;
}

/** The probe→teach construction seam (chat-handler): a probe_done call
 *  whose result is neither an error nor a refusal means the probe is
 *  concluded: teach. Anything else keeps probing, as phaseAt3Lh does. */
export function hasProbeDone(messages: readonly LhMessage[]): boolean {
	return messages.some(
		(m) => m.role === "toolResult" && m.toolName === "probe_done" && !m.isError && (m.details as { ok?: unknown } | undefined)?.ok !== false,
	);
}

/** Every toolResult id in the record — answer-event validation (the call
 *  must be a DANGLING question call, not an already-answered one). */
export function answeredCallIds(messages: readonly LhMessage[]): Set<string> {
	return resultIdsFrom(messages);
}

// ─── the continuation fold ───────────────────────────────────────────────────

/** Is this record message a user-dismissed question result? The full
 *  answer rides the toolResult's `details` (newAnswerResult) — the
 *  dismissal pause and the continuation fold both read it. */
function isDismissedResult(m: LhMessage): boolean {
	if ((m as { role?: string }).role !== "toolResult") return false;
	const details = (m as { details?: unknown }).details as { dismissed?: unknown } | undefined;
	return details?.dismissed === true;
}

/** The dismissal pause: the record ends
 *  in user dismissal — the session waits for the USER. While paused,
 *  nothing auto-wakes: the continuation fold demands nothing (below) and
 *  the wake pipeline holds job deliveries in the steer queue until the
 *  next send. Derived from the tail — no latch to persist or clear; any
 *  user message flips it off by changing the record. */
export function endsInDismissal(messages: readonly LhMessage[]): boolean {
	const last = messages[messages.length - 1];
	return last !== undefined && isDismissedResult(last);
}

/** The record a continue runs from: everything before a trailing failed or
 *  stopped reply. pi can't continue from an assistant message, and the
 *  providers skip those replies anyway. The saved record keeps them. */
export function retryContext(messages: readonly LhMessage[]): LhMessage[] {
	let end = messages.length;
	while (end > 0) {
		const m = messages[end - 1] as { role?: string; stopReason?: string };
		if (m.role !== "assistant" || (m.stopReason !== "error" && m.stopReason !== "aborted")) break;
		end--;
	}
	return messages.slice(0, end);
}

/**
 * Does the record END on un-consumed tool results — a turn that stopped
 * after its tools ran (a job dispatch's ack, an aborted answer turn),
 * leaving the agent owing a continuation? This is the mount/sync
 * continuation seam's gate (chat.tsx): when true and nothing runs, the
 * client sends {type:"continue"} and the teacher picks up from the record.
 *
 * The fold: the last message is a toolResult, and the results' OWNING
 * assistant message has at least one call, ALL of them answered (a
 * dangling question — the dock's domain — fails the all-answered rule and
 * never fires a turn).
 */
export function needsContinuation(record: readonly LhMessage[]): boolean {
	// Compaction can append its marker between a question call and its
	// answer; it is not part of the turn, so the fold reads past it.
	const messages = record.filter(
		(m) => !((m as { role?: string }).role === "custom" && (m as LhMarkerMessage).customType === "compaction"),
	);
	const last = messages[messages.length - 1];
	if (!last || (last as { role?: string }).role !== "toolResult") return false;
	// The trailing results batch (contiguous by construction — the agent
	// appends its batch; the question gate keeps a quiz call and its
	// learner answer adjacent).
	let start = messages.length - 1;
	while (
		start > 0 &&
		(messages[start - 1] as { role?: string } | undefined)?.role === "toolResult"
	) {
		start--;
	}
	// The dismissal rule:
	// the batch's LAST resolution decides. Ending on a dismissal = the
	// user signaled STOP — no wake, no reaction owed now; the answers'
	// reactions ride the user's next plain message. Ending on a real
	// answer = the reaction is owed. One law with the pump's pause
	// (endsInDismissal reads the same last result), so continuation,
	// delivery-holding, and the pause can never disagree.
	if (isDismissedResult(messages[messages.length - 1]!)) {
		return false;
	}
	const owner = messages[start - 1];
	if (!owner || (owner as { role?: string }).role !== "assistant") return false;
	const content = (owner as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	const results = messages.slice(start) as ToolResultMessage[];
	// PRACTICE: a batch acking a problem POSE
	// owes nothing — terminate:true ended that turn DELIBERATELY (the
	// learner's next thinking submission is the next turn), and unlike a
	// question's placeholder this ack PERSISTS (the model reads its own
	// "Problem posed" result later). Without this fold a reload after a
	// pose would wake a phantom continuation turn.
	const posedProblem = results.some(
		(m) => m.toolName === PRACTICE_PROBLEM_TOOL && !m.isError && m.details == null,
	);
	if (posedProblem) return false;
	const answered = new Set(results.map((m) => m.toolCallId));
	const calls = (content as Array<{ type?: string; id?: string }>).filter(
		(b) => b.type === "toolCall" && typeof b.id === "string",
	);
	return calls.length > 0 && calls.every((b) => answered.has(b.id!));
}
