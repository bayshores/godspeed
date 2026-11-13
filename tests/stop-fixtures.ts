/**
 * Lesson records with stops, Keep going and openers, built by hand with
 * fixed times, for the pure tests of topic ends.
 */
import type { LhMessage } from "../src/shared/core/native-messages.ts";
import type { PlanTree } from "../src/shared/core/contracts/plan.ts";
import type { StopDetails } from "../src/shared/core/contracts/chat.ts";

/** Wednesday 21:00 (local time on the test machine is irrelevant: tests
 *  compare the same clock). */
const T0 = Date.parse("2026-11-18T21:00:00.000Z");
export const at = (minutes: number): number => T0 + minutes * 60_000;
const iso = (minutes: number): string => new Date(at(minutes)).toISOString();

/** Regularization, then Cross-validation, then Model selection. */
export const TREE: PlanTree = {
	nodes: [
		{ id: "reg", title: "Regularization" },
		{ id: "cv", title: "Cross-validation" },
		{ id: "ms", title: "Model selection" },
	],
	edges: [
		{ from: "reg", to: "cv" },
		{ from: "cv", to: "ms" },
	],
};

export function call(id: string, name: string, args: Record<string, unknown>, minutes: number): LhMessage {
	return {
		id: `m_${id}`,
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: args }],
		api: "faux",
		provider: "faux",
		model: "faux",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: at(minutes),
	} as LhMessage;
}

export function text(id: string, words: string, minutes: number): LhMessage {
	return { ...(call(id, "x", {}, minutes) as object), content: [{ type: "text", text: words }], stopReason: "stop" } as LhMessage;
}

export function result(callId: string, name: string, details: unknown, minutes: number, isError = false, words = "ok"): LhMessage {
	return {
		id: `r_${callId}`,
		role: "toolResult",
		toolCallId: callId,
		toolName: name,
		content: [{ type: "text", text: words }],
		details,
		isError,
		timestamp: at(minutes),
	} as LhMessage;
}

export function marker(id: string, customType: string, details: unknown, minutes: number, content = ""): LhMessage {
	return { id, role: "custom", customType, content, display: true, details, timestamp: at(minutes) } as LhMessage;
}

export function keepGoing(stopOf: string, minutes: number): LhMessage {
	return marker(`kg_${stopOf}_${minutes}`, "keep-going", { stopOf, at: iso(minutes) }, minutes);
}

export function userText(id: string, words: string, minutes: number): LhMessage {
	return { id, role: "user", content: words, timestamp: at(minutes) } as LhMessage;
}

export const topicStop = (nodeId: string, minutes: number, activeMinutes = 30): StopDetails => ({ kind: "topic", nodeId, activeMinutes, at: iso(minutes) });
export const problemStop = (minutes: number, activeMinutes = 26): StopDetails => ({ kind: "problem", activeMinutes, at: iso(minutes) });

export const CONCLUDE_SOLVED = { outcome: "solved", verdict: "Right.", rung: null, missClass: null, retest: false };

export const OPENER_QUIZ = {
	question: "With 5 folds, how much does the score move between splits?",
	options: [{ label: "It can move a lot" }, { label: "Barely" }],
	correctAnswer: "It can move a lot",
	explanation: "Small folds are noisy.",
	type: "predict",
	nodeId: "cv",
};

/** A Study topic that ends on a solved problem at minute 48, the reading,
 *  then topic_done with the next topic's opener. */
export function regularizationEnds(): LhMessage[] {
	return [
		call("p1", "problem", { statement: "Fit lambda.", nodeId: "reg" }, 30),
		result("p1", "problem", null, 30),
		call("c1", "conclude", CONCLUDE_SOLVED, 48),
		result("c1", "conclude", { stop: topicStop("reg", 48, 48) }, 48),
		call("t1", "topic_done", { nodeId: "reg", opener: { lead: "Now split the data.", quiz: OPENER_QUIZ } }, 49),
		result("t1", "topic_done", { part: "topic_done", v: 1, lead: "Now split the data." }, 49),
	];
}
