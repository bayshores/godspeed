import { isQuestionTool, PRACTICE_PROBLEM_TOOL, type LhViewMessage } from "@/shared/core";
import type { AgentWork, CardFile } from "./agent-at-work-model";

/**
 * The lesson while the teacher works on a reply: the desk at the foot of the lesson text,
 * which shows the teacher's plan and the file it reads, never words the strip already says.
 * Pure.
 */

/** "waiting": no agent has taken the turn; "working": one has. */
export type DeskState = "waiting" | "working";

/** Whether the desk shows: from the teacher's first plan or step in this reply until the reply's
 *  text lands. Before that, the pencil shows and the strip says the teacher works. */
export function deskState({ busy, waitingForAgent, work }: { busy: boolean; waitingForAgent: boolean; work: AgentWork | null }): DeskState | null {
	if (!busy || !work || work.replied || (work.plan === null && work.steps.length === 0)) return null;
	return waitingForAgent ? "waiting" : "working";
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const textOf = (m: LhViewMessage) =>
	m.parts
		.filter((p) => p.type === "text")
		.map((p) => p.text ?? "")
		.join("\n");

/** What ends a title the server cut short. */
export const TITLE_CUT = "…";

/** The index of the learner's first message when its words only repeat the lesson's title (a
 *  new lesson sends its title as its first message, and a long one is saved cut), else -1. */
export function titleEcho(messages: readonly LhViewMessage[], title: string): number {
	const first = messages.findIndex((m) => m.role === "user" && m.parts.some((p) => p.type === "text"));
	const name = flat(title);
	if (first === -1 || name === "") return -1;
	const said = flat(textOf(messages[first]!));
	const cut = name.endsWith(TITLE_CUT) && said.startsWith(name.slice(0, -TITLE_CUT.length));
	return said === name || cut ? first : -1;
}

/** The space's files, from its card: the lesson's first message. */
export function cardFiles(messages: readonly LhViewMessage[]): readonly CardFile[] {
	const card = messages[0]?.parts.find((p) => p.type === "data-space-context");
	return (card?.data as { files?: CardFile[] } | undefined)?.files ?? [];
}

/** The most rows the plan shows beside the paper. */
const PLAN_ROWS = 6;

export type PlanLine = { key: string; text: string; state: "done" | "now" | "next" } | { key: "done"; count: number; state: "folded" };

/** The plan's rows: each item, or, for a plan longer than the desk holds, its done items folded
 *  into one row with their count, and the rows after the current one cut where the desk ends. */
export function planLines({ items, done }: { items: readonly string[]; done: number }): PlanLine[] {
	const lines: PlanLine[] = items.map((text, i) => ({ key: `${i}:${text}`, text, state: i < done ? "done" : i === done ? "now" : "next" }));
	if (lines.length <= PLAN_ROWS) return lines;
	const folded: PlanLine[] = done > 0 ? [{ key: "done", count: done, state: "folded" }, ...lines.slice(done)] : lines;
	return folded.slice(0, PLAN_ROWS);
}

/** Where a desk that is leaving held the lesson: its message count, the newest message's part
 *  count and, when that message ends in text, how long the text was (an answered question's reply
 *  grows the same message, and its text can start as an empty part). */
export type DeskMark = { count: number; parts: number; text: number | null };

/** The lesson's mark as it stands. */
export function deskMark(messages: readonly LhViewMessage[]): DeskMark {
	const last = messages.at(-1)?.parts.at(-1);
	return { count: messages.length, parts: messages.at(-1)?.parts.length ?? 0, text: last?.type === "text" ? (last.text ?? "").length : null };
}

/** The messages as they stood at `mark`, so a reply that just landed stays out of the page while
 *  the desk leaves, and the two never stack. */
export function heldBack(messages: readonly LhViewMessage[], mark: DeskMark): readonly LhViewMessage[] {
	const kept = messages.slice(0, mark.count);
	const last = kept.at(-1);
	if (!last) return kept;
	const parts = last.parts.slice(0, mark.parts);
	const end = parts.at(-1);
	if (mark.text !== null && end?.type === "text" && (end.text ?? "").length > mark.text) parts[parts.length - 1] = { ...end, text: (end.text ?? "").slice(0, mark.text) };
	else if (parts.length === last.parts.length) return kept;
	return [...kept.slice(0, -1), { ...last, parts }];
}

/** The learner has written and the teacher wrote nothing back: no words, no question and no
 *  problem (its first reply was stopped before it began). */
export function nothingWritten(messages: readonly LhViewMessage[]): boolean {
	const learner = messages.some((m) => m.role === "user" && m.parts.some((p) => p.type === "text"));
	const asks = (tool: string) => isQuestionTool(tool) || tool === PRACTICE_PROBLEM_TOOL;
	const wrote = messages.some((m) => m.role === "assistant" && m.parts.some((p) => (p.type === "text" ? !!p.text?.trim() : p.type.startsWith("tool-") && asks(p.type.slice("tool-".length)))));
	return learner && !wrote;
}
