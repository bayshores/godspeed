/**
 * Places to stop: the end of a Study topic and the end of a long problem.
 * A stop rides the result details of the call that made it (a conclude or
 * topic_done); Keep going is a UI-only marker naming that call; the next
 * topic's opener rides topic_done. Everything here is derived from the
 * record. The server keeps a Rust copy (crates/core/src/study/topic_end.rs);
 * both replay crates/core/tests/golden/topic_end.json. Pure and
 * browser-safe.
 */
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { TOPIC_DONE_TOOL, type KeepGoingDetails, type OpenerAnswerDetails, type StopDetails, type TopicDoneDetails } from "./contracts/chat.ts";
import { derivePlanStatusesLh, orderedPlanNodes, TAGGING_TOOLS, type PlanTree } from "./contracts/plan.ts";
import { PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL, type LhMessage } from "./native-messages.ts";
import type { QuestionAnswerData } from "./question-core.ts";

/** The stop a lesson is at: its newest stop, with what comes next.
 *  `kind` "end" is a topic stop with no topic left. `nodeId` is the topic
 *  (for a problem stop, the problem's topic when it names one). `next` is
 *  the next topic's title (Study topic stop), the current plan step's
 *  title (Study problem stop), "problem {n}" (homework) or null
 *  (practice). */
export interface LessonStop {
	kind: "topic" | "problem" | "end";
	at: string;
	nodeId: string | null;
	/** The call carrying the stop: what Keep going names. */
	stopOf: string;
	next: string | null;
	activeMinutes: number;
	keptGoing: boolean;
}

/** A homework problem as lessonStop reads it. */
interface HomeworkMark {
	number: string;
	done: boolean;
}

/** The lesson's stop, or null when it never stopped (every lesson from
 *  before stops existed). `tree` is a Study lesson's plan (null for
 *  practice and homework); `homework` is a homework lesson's problems, and
 *  with none left undone there is no stop (the done bar shows instead). */
export function lessonStop(messages: readonly LhMessage[], tree: PlanTree | null | undefined, homework?: readonly HomeworkMark[]): LessonStop | null {
	const stops = recordStops(messages);
	const last = stops.at(-1);
	if (!last) return null;
	let kind: LessonStop["kind"] = last.stop.kind;
	let next: string | null = null;
	if (homework) {
		const open = homework.find((p) => !p.done);
		if (!open) return null;
		next = `problem ${open.number}`;
	} else if (tree && tree.nodes.length > 0) {
		if (last.stop.kind === "topic") {
			next = nextTopic(tree, last.stop.nodeId, new Set(stops.flatMap((s) => (s.stop.kind === "topic" ? [s.stop.nodeId] : []))));
			if (next === null) kind = "end";
		} else {
			const current = derivePlanStatusesLh(tree, messages).current;
			next = tree.nodes.find((n) => n.id === current)?.title ?? null;
		}
	}
	return {
		kind,
		at: last.stop.at,
		nodeId: last.nodeId,
		stopOf: last.stopOf,
		next,
		activeMinutes: last.stop.activeMinutes,
		keptGoing: keepGoingMarkers(messages).some((k) => k.stopOf === last.stopOf) || movedPast(messages, last),
	};
}

/** Whether the teacher went on past a stop with no Keep going (he typed
 *  instead): a later tagging call, not refused, names another topic. A
 *  stop with no topic (practice, homework) is passed only by Keep going. */
function movedPast(messages: readonly LhMessage[], stop: RecordStop): boolean {
	if (stop.nodeId === null) return false;
	const after = messages.slice(stop.index + 1);
	const refused = new Set(after.flatMap((m) => (m.role === "toolResult" && m.isError ? [m.toolCallId] : [])));
	return after.some(
		(m) =>
			m.role === "assistant" &&
			m.content.some((b) => {
				if (b.type !== "toolCall" || !TAGGING_TOOLS.has(b.name) || refused.has(b.id)) return false;
				const nodeId = (b.arguments as { nodeId?: unknown } | undefined)?.nodeId;
				return typeof nodeId === "string" && nodeId !== stop.nodeId;
			}),
	);
}

/** The first topic after `nodeId` in learning order that has not ended,
 *  then the first one before it (a topic left for later comes back before
 *  the session ends); null when every topic has ended. */
function nextTopic(tree: PlanTree, nodeId: string, ended: ReadonlySet<string>): string | null {
	const order = orderedPlanNodes(tree);
	const at = order.findIndex((n) => n.id === nodeId);
	const open = (n: PlanTree["nodes"][number]) => n.id !== nodeId && !ended.has(n.id);
	return (order.slice(at + 1).find(open) ?? order.slice(0, Math.max(at, 0)).find(open))?.title ?? null;
}

/** An opener on screen: its topic_done is stored and its stop was kept
 *  going. `answer` is set once he answered (null answer: skipped). */
export interface ShownOpener {
	topicDoneCallId: string;
	/** The lead as topic_done's result stored it (marks checked). */
	lead?: string;
	/** The opener's question: quiz arguments with its nodeId. */
	quiz: Record<string, unknown>;
	answer?: { answer: QuestionAnswerData | null; timestamp: number };
}

/** Every shown opener, by its topic_done call id. */
export function shownOpeners(messages: readonly LhMessage[]): Map<string, ShownOpener> {
	const out = new Map<string, ShownOpener>();
	const stops = recordStops(messages);
	const kept = new Set(keepGoingMarkers(messages).map((k) => k.stopOf));
	const calls = callArgs(messages);
	messages.forEach((m, index) => {
		if (m.role !== "toolResult" || m.toolName !== TOPIC_DONE_TOOL || m.isError || !isTopicDoneDetails(m.details)) return;
		const args = calls.get(m.toolCallId);
		const quiz = (args?.opener as { quiz?: unknown } | undefined)?.quiz;
		if (!isObject(quiz)) return;
		// Its stop: its own (a quiz ended the topic) or the conclude that ended it.
		const stopOf = m.details.stop
			? m.toolCallId
			: stops.findLast((s) => s.index < index && s.stop.kind === "topic" && s.stop.nodeId === args?.nodeId)?.stopOf;
		if (stopOf === undefined || !kept.has(stopOf)) return;
		out.set(m.toolCallId, { topicDoneCallId: m.toolCallId, ...(typeof m.details.lead === "string" ? { lead: m.details.lead } : {}), quiz });
	});
	for (const m of messages) {
		if (m.role !== "custom" || m.customType !== "opener-answer") continue;
		const details = m.details as OpenerAnswerDetails | null | undefined;
		const opener = details ? out.get(details.topicDoneCallId) : undefined;
		if (details && opener && !opener.answer) opener.answer = { answer: details.answer, timestamp: m.timestamp };
	}
	return out;
}

// ─── record scans ────────────────────────────────────────────────────────────

interface RecordStop {
	stopOf: string;
	stop: StopDetails;
	nodeId: string | null;
	/** The index of the result that carries it. */
	index: number;
}

/** Every stop in the record, in order: clean conclude and topic_done
 *  results whose details carry one. */
function recordStops(messages: readonly LhMessage[]): RecordStop[] {
	const calls = callArgs(messages);
	const out: RecordStop[] = [];
	let problemNode: string | null = null;
	messages.forEach((m, index) => {
		if (m.role !== "toolResult" || m.isError) return;
		if (m.toolName === PRACTICE_PROBLEM_TOOL) {
			const nodeId = calls.get(m.toolCallId)?.nodeId;
			problemNode = typeof nodeId === "string" ? nodeId : null;
			return;
		}
		if (m.toolName !== PRACTICE_CONCLUDE_TOOL && m.toolName !== TOPIC_DONE_TOOL) return;
		const stop = stopIn(m);
		if (stop) out.push({ stopOf: m.toolCallId, stop, nodeId: stop.kind === "topic" ? stop.nodeId : problemNode, index });
		if (m.toolName === PRACTICE_CONCLUDE_TOOL) problemNode = null;
	});
	return out;
}

function stopIn(result: ToolResultMessage): StopDetails | null {
	const stop = (result.details as { stop?: unknown } | null | undefined)?.stop;
	if (!isObject(stop) || typeof stop.at !== "string" || typeof stop.activeMinutes !== "number") return null;
	if (stop.kind === "problem") return stop as StopDetails;
	return stop.kind === "topic" && typeof stop.nodeId === "string" ? (stop as StopDetails) : null;
}

/** Every call's arguments, by call id. */
function callArgs(messages: readonly LhMessage[]): Map<string, Record<string, unknown>> {
	const out = new Map<string, Record<string, unknown>>();
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const block of m.content) if (block.type === "toolCall") out.set(block.id, (block.arguments ?? {}) as Record<string, unknown>);
	}
	return out;
}

/** The keep-going markers' details, wherever they sit (one written during
 *  a turn sits before that turn's messages). */
function keepGoingMarkers(messages: readonly LhMessage[]): KeepGoingDetails[] {
	return messages.flatMap((m) => {
		const details = m.role === "custom" && m.customType === "keep-going" ? (m.details as KeepGoingDetails | null | undefined) : null;
		return details ? [details] : [];
	});
}

function isTopicDoneDetails(details: unknown): details is TopicDoneDetails {
	return isObject(details) && details.part === "topic_done";
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
