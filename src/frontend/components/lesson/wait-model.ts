import { isQuestionTool, type LhViewMessage } from "@/shared/core";
import type { AgentWork } from "./agent-at-work-model";

/**
 * The lesson while the teacher works on a reply: the desk at the foot of the lesson text,
 * which shows paper and the teacher's plan, never words the top bar's pill already says.
 * Pure.
 */

/** "waiting": no agent has taken the turn; "working": one has. */
export type DeskState = "waiting" | "working";

/** Whether the desk shows and whether it is split into the plan beside the paper. It shows from
 *  the moment a turn runs until the reply's text lands. */
export function waitView({ busy, waitingForAgent, work }: { busy: boolean; waitingForAgent: boolean; work: AgentWork | null }): { desk: DeskState | null; split: boolean } {
	if (!busy || work?.replied) return { desk: null, split: false };
	return { desk: waitingForAgent ? "waiting" : "working", split: work !== null && (work.plan !== null || work.steps.length > 0) };
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

const textOf = (m: LhViewMessage) =>
	m.parts
		.filter((p) => p.type === "text")
		.map((p) => p.text ?? "")
		.join("\n");

/** The index of the learner's first message when its words only repeat the lesson's title (a
 *  new lesson sends its title as its first message), else -1. */
export function titleEcho(messages: readonly LhViewMessage[], title: string): number {
	const first = messages.findIndex((m) => m.role === "user" && m.parts.some((p) => p.type === "text"));
	return first !== -1 && flat(title) !== "" && flat(textOf(messages[first]!)) === flat(title) ? first : -1;
}

/** The paper on the desk: the homework's assignment as the top sheet (`path`), or blank paper
 *  (null), over one edge for a space with a file, two from 5 files and three from 20. The space's
 *  files are read from its card, the lesson's first message. */
export function deskPaper(messages: readonly LhViewMessage[], assignment: { path: string | null } | null): { path: string | null; edges: number } {
	const card = messages[0]?.parts.find((p) => p.type === "data-space-context");
	const files = (card?.data as { files?: unknown[] } | undefined)?.files?.length ?? 0;
	return { path: assignment?.path ?? null, edges: files >= 20 ? 3 : files >= 5 ? 2 : files >= 1 ? 1 : 0 };
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

/** Where a desk that is leaving held the lesson: its message count and the newest message's part
 *  count. */
type DeskMark = { count: number; parts: number };

/** The messages as they stood at `mark`, so a reply that just landed stays out of the page while
 *  the desk leaves, and the two never stack. */
export function heldBack(messages: readonly LhViewMessage[], mark: DeskMark): readonly LhViewMessage[] {
	const kept = messages.slice(0, mark.count);
	const last = kept.at(-1);
	if (!last || last.parts.length <= mark.parts) return kept;
	return [...kept.slice(0, -1), { ...last, parts: last.parts.slice(0, mark.parts) }];
}

/** The learner has written and the teacher wrote nothing back: no words and no question (its
 *  first reply was stopped before it began). */
export function nothingWritten(messages: readonly LhViewMessage[]): boolean {
	const learner = messages.some((m) => m.role === "user" && m.parts.some((p) => p.type === "text"));
	const wrote = messages.some(
		(m) => m.role === "assistant" && m.parts.some((p) => (p.type === "text" ? !!p.text?.trim() : p.type.startsWith("tool-") && isQuestionTool(p.type.slice("tool-".length)))),
	);
	return learner && !wrote;
}
