import { TAGGING_TOOLS, type LhViewMessage, type LhViewPart } from "@/shared/core";

/** A message's parts on one sheet: `parts[from]` up to, not including, `parts[to]`. */
export interface SheetRow {
	index: number;
	from: number;
	to: number;
}

/** One sheet of the lesson text: what one step of the lesson put on the page. */
interface StepSheet {
	/** The plan step or problem it holds; null while nothing on it names one. */
	step: string | null;
	/** The number on its tab: the plan step's, the problem's as its assignment numbers it, or which problem this is. */
	label: string | null;
	/** What the number counts, for a reader that hears the tab. */
	counts: "Step" | "Problem";
	rows: SheetRow[];
}

interface Tag {
	step: string;
	/** A homework problem's own number. */
	number: string | null;
	problem: boolean;
}

/** The step a part names: an opener's lead and a question name their plan node, a problem its plan
 *  node, else its assignment number, else itself. A call that failed or is still being written names none. */
function tagOf(part: LhViewPart): Tag | null {
	if (typeof part.opens === "string") return { step: part.opens, number: null, problem: false };
	if (!part.type.startsWith("tool-") || !TAGGING_TOOLS.has(part.type.slice(5))) return null;
	if (part.state === "output-error" || part.state === "input-streaming") return null;
	const input = (part.input ?? {}) as { nodeId?: unknown; number?: unknown };
	if (typeof input.nodeId === "string") return { step: input.nodeId, number: null, problem: false };
	if (part.type !== "tool-problem") return null;
	if (typeof input.number === "string") return { step: `problem ${input.number}`, number: input.number, problem: true };
	return part.toolCallId ? { step: part.toolCallId, number: null, problem: true } : null;
}

/** Where a new step's sheet starts in a reply. A problem takes the words before it in its reply,
 *  which lead into it; a question does not, since the words before it settle the step before. */
function sheetStart(parts: readonly LhViewPart[], at: number): number {
	let start = at;
	if (parts[at]!.type === "tool-problem") while (start > 0 && parts[start - 1]!.type !== "step-start") start--;
	return start > 0 && parts[start - 1]!.type === "step-start" ? start - 1 : start;
}

/**
 * The lesson text as one sheet per step. A new sheet starts where a part names a step other than
 * the sheet's own; what comes before the first named step is on the first step's sheet. A lesson
 * that names none is one sheet.
 */
export function stepSheets(messages: readonly LhViewMessage[], planNumbers: ReadonlyMap<string, number>): StepSheet[] {
	const blank = (): StepSheet => ({ step: null, label: null, counts: "Step", rows: [] });
	const sheets = [blank()];
	let problems = 0;
	const name = (sheet: StepSheet, tag: Tag) => {
		if (tag.problem) problems++;
		sheet.step = tag.step;
		sheet.counts = tag.problem ? "Problem" : "Step";
		sheet.label = tag.number ?? (tag.problem ? String(problems) : (planNumbers.get(tag.step)?.toString() ?? null));
	};
	messages.forEach((m, index) => {
		let from = 0;
		m.parts.forEach((part, at) => {
			const tag = tagOf(part);
			const sheet = sheets.at(-1)!;
			if (!tag || tag.step === sheet.step) return;
			if (sheet.step !== null) {
				const start = Math.max(from, sheetStart(m.parts, at));
				if (start > from) sheet.rows.push({ index, from, to: start });
				sheets.push(blank());
				from = start;
			}
			name(sheets.at(-1)!, tag);
		});
		if (from < m.parts.length) sheets.at(-1)!.rows.push({ index, from, to: m.parts.length });
	});
	return sheets;
}
