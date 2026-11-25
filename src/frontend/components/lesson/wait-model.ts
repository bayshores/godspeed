import { isQuestionTool, PRACTICE_PROBLEM_TOOL, type DeskReading, type LessonWork, type LhViewMessage } from "@/shared/core";

/**
 * The lesson while the teacher works on a reply: the desk in the lesson text's newest sheet, which
 * says in one sentence what the teacher is doing, lists its steps in the server's words and lays
 * the files it works from on the desk as paper. Pure.
 */

/** The desk's one sentence: what the teacher does, by why the turn runs. Null for the moment
 *  between the learner's send and the server's first word on the turn. */
export function deskHead(name: string, work: LessonWork): string | null {
	if (!work.live) return null;
	switch (work.cause) {
		case "first":
			return `${name} is getting your first step ready.`;
		case "answer":
			return `${name} is reading your answer.`;
		case "problem":
			return `${name} is checking your work.`;
		case "ask":
			return `${name} is answering your question.`;
		case "retry":
			return `${name} is trying again.`;
		case "open_problem":
			return `${name} is getting the problem ready.`;
		case "next":
		case "job":
		case "talk":
		case null:
			return `${name} is writing the next step.`;
	}
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

/** The most rows the desk shows. */
const DESK_ROWS = 6;

/** One row of the desk: a plan item or a step, or the count of the done ones folded. A row with no
 *  words is the pencil writing before the teacher's first step. */
export type DeskRow = { key: string; text: string | null; state: "done" | "now" | "next" } | { key: "done"; count: number; state: "folded" };

/** The plan's rows: each item, or, for a plan longer than the desk holds, its done items folded
 *  into one row with their count, and the rows after the current one cut where the desk ends. */
function planLines({ items, done }: { items: readonly string[]; done: number }): DeskRow[] {
	const lines: DeskRow[] = items.map((text, i) => ({ key: `${i}:${text}`, text, state: i < done ? "done" : i === done ? "now" : "next" }));
	if (lines.length <= DESK_ROWS) return lines;
	const folded: DeskRow[] = done > 0 ? [{ key: "done", count: done, state: "folded" }, ...lines.slice(done)] : lines;
	return folded.slice(0, DESK_ROWS);
}

/** The desk's rows and the step under the current one. With a plan, its items, the newest step
 *  under the current item (or, all done, the newest step its own row). Without one, the steps, the
 *  newest current and the oldest folded past what the desk holds. */
export function deskRows({ plan, steps }: Pick<LessonWork, "plan" | "steps">): { rows: DeskRow[]; under: string | null } {
	const newest = steps.at(-1);
	const now = (): DeskRow => ({ key: newest?.id ?? "start", text: newest?.text ?? null, state: "now" });
	if (plan) {
		const rows = planLines(plan);
		return rows.some((row) => row.state === "now") ? { rows, under: newest?.text ?? null } : { rows: [...rows, now()], under: null };
	}
	if (!newest) return { rows: [now()], under: null };
	const rows: DeskRow[] = steps.map((step) => ({ key: step.id, text: step.text, state: step === newest ? "now" : "done" }));
	if (rows.length <= DESK_ROWS) return { rows, under: null };
	const shown = rows.slice(-(DESK_ROWS - 1));
	return { rows: [{ key: "done", count: rows.length - shown.length, state: "folded" }, ...shown], under: null };
}

/** The page on the desk: the place the teacher read last in a file that has pages to show, or
 *  before that the first of its files that has them, lying still (Word, PowerPoint and EPUB files
 *  have none). */
export function deskPaper(work: Pick<LessonWork, "steps" | "files">): { reading: DeskReading; still: boolean } | null {
	const read = work.steps.findLast((step) => step.reads !== null && step.reads.kind !== "other")?.reads;
	if (read) return { reading: read, still: false };
	const first = work.files.find((file) => file.kind !== "other");
	return first ? { reading: { ...first, from: null, to: null, page: null }, still: true } : null;
}

/** The tool calls the desk's steps stand for: their cards stay out of the lesson text while it shows. */
export function deskCalls(work: Pick<LessonWork, "steps">): ReadonlySet<string> {
	return new Set(work.steps.flatMap((step) => (step.call ? [step.call] : [])));
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

/** How much the teacher has written since `mark` (the lesson as it stood when the turn began),
 *  in letters: its words, and its thinking, which counts even while empty. 0 while it has written
 *  nothing. It grows as the reply is written, also when the reply grows the message an answered
 *  question is in. */
export function wordsSince(messages: readonly LhViewMessage[], mark: DeskMark): number {
	let letters = 0;
	messages.forEach((m, i) => {
		if (m.role !== "assistant" || i < mark.count - 1) return;
		m.parts.forEach((part, pi) => {
			const old = i === mark.count - 1 && pi < mark.parts;
			if (old && !(pi === mark.parts - 1 && mark.text !== null)) return;
			const text = part.text ?? "";
			if (part.type === "reasoning") letters += 1 + text.length;
			else if (part.type === "text" && text.trim() !== "") letters += old ? Math.max(0, text.length - (mark.text ?? 0)) : text.length;
		});
	});
	return letters;
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
