import type { HomeworkProblem, LessonStop, PlanStep, PlanStepBar, StepAnswer } from "@/shared/core";
import type { PracticeProgress } from "./practice-progress";

/** How a block or a list row reads: done in ink, the one in progress, the rest light. */
export type Tone = "done" | "current" | "later";

/** One block of a practice row, or one step of a plan or homework lesson's row. */
export interface RowBlock {
	key: string;
	tone: Tone;
	/** The step's or problem's name, for the tooltip and the label. */
	name: string;
	/** The raw status the block carries as data-block. */
	state: string;
}

/** What a practice row shows: its count and its blocks. */
interface RowSummary {
	count: string | null;
	blocks: RowBlock[];
}

/** One step of a plan lesson's row, or one problem of a homework lesson's. */
export interface RowStep extends RowBlock {
	/** "3" for a plan step, the assignment's own number ("2b") for a problem. */
	number: string;
	/** Where a done plan step goes back to: its first answered question. */
	jump: string | null;
	/** The hover text: the name, and on a done step that goes back, how its answers went. */
	hint: string;
	/** Done, so it shows a check; a problem opened again is done and current. */
	done: boolean;
	/** What a screen reader says for a problem cell, and why it can't open yet. */
	label: string;
}

/** Above this many steps a row shows only numbers and bars (the names go
 *  to the hover), so it stays within three lines. */
export const COMPACT_ABOVE = 12;

/** How many cells go on a line of a row `width` px wide: as many as fit at
 *  their least width, spread evenly over the lines that takes, so 6 cells
 *  with room for 4 go 3 and 3, never 4 and 2. Unmeasured: one line. */
export function rowColumns(n: number, width: number | null, min: number, gap: number): number {
	if (width === null || n === 0) return Math.max(1, n);
	const fit = Math.max(1, Math.floor((width + gap) / (min + gap)));
	return Math.ceil(n / Math.ceil(n / fit));
}

/** "2 of 2 right" over the graded answers (explain answers are not graded). */
export function rightCountLabel(answers: readonly StepAnswer[]): string | null {
	const graded = answers.filter((a) => a.outcome !== "ungraded");
	if (graded.length === 0) return null;
	return `${graded.filter((a) => a.outcome === "right").length} of ${graded.length} right`;
}

/** The step a done-step click jumps to: its first answered question. */
export function jumpTarget(step: PlanStep): string | null {
	if (step.status !== "visited") return null;
	return step.answers.find((a) => a.toolCallId)?.toolCallId ?? null;
}

/** A problem by its number as the assignment writes it: "problem 3", or
 *  "Ex. 4" when the assignment names it so. */
function problemName(number: string): string {
	return /^\d/.test(number) ? `problem ${number}` : number;
}

/** The go-ahead for one problem: "Start problem 3", "Start Ex. 4". */
export function startProblemLabel(number: string): string {
	return `Start ${problemName(number)}`;
}

/** The homework go-ahead for the first problem not done. Null when none is left. */
export function homeworkStartLabel(problems: readonly HomeworkProblem[]): string | null {
	const next = problems.find((p) => !p.done);
	return next ? startProblemLabel(next.number) : null;
}

/** What a screen reader hears when a pick goes out: "Opening problem 4". */
export function openingLabel(number: string): string {
	return `Opening ${problemName(number)}`;
}

/** A problem's place in the assignment: the open one is current even when done. */
function problemTone(problem: HomeworkProblem, open: string | null): Tone {
	return problem.number === open ? "current" : problem.done ? "done" : "later";
}

/** A plan lesson's row: every step in order. Null with no steps. At a
 *  topic's stop he has not kept going from, that topic reads as finished. */
export function stepsRow(bar: PlanStepBar, stop: LessonStop | null = null): RowStep[] | null {
	if (bar.steps.length === 0) return null;
	const finished = stop && stop.kind !== "problem" && !stop.keptGoing ? stop.nodeId : null;
	return bar.steps.map((step, i) => {
		const jump = jumpTarget(step);
		const right = jump ? rightCountLabel(step.answers) : null;
		const tone: Tone = step.status === "visited" || (step.status === "current" && step.id === finished) ? "done" : step.status === "current" ? "current" : "later";
		return {
			key: step.id,
			tone,
			name: step.title,
			state: step.status,
			number: String(i + 1),
			jump,
			hint: right ? `${step.title}, ${right}` : step.title,
			done: tone === "done",
			label: step.title,
		};
	});
}

/** Whether the plan branches: some step has two or more steps right before
 *  or after it. A plan that is one chain needs no map. */
export function planBranches(stepIds: readonly string[], edges: ReadonlyArray<{ from: string; to: string }>): boolean {
	const ids = new Set(stepIds);
	const links = new Set<string>();
	const into = new Set<string>();
	const out = new Set<string>();
	for (const e of edges) {
		const link = `${e.from}->${e.to}`;
		if (!ids.has(e.from) || !ids.has(e.to) || links.has(link)) continue;
		if (out.has(e.from) || into.has(e.to)) return true;
		links.add(link);
		out.add(e.from);
		into.add(e.to);
	}
	return false;
}

/** A homework lesson's row: every problem in order, each one a pick. The
 *  open one takes him to his work; `blocked` is why no other can open yet.
 *  Null with no problems. */
export function homeworkRow(problems: readonly HomeworkProblem[], open: string | null, blocked: string | null): RowStep[] | null {
	if (problems.length === 0) return null;
	return problems.map((p) => {
		const tone = problemTone(p, open);
		const name = problemName(p.number);
		const named = `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${p.title}`;
		const said = `${named}${p.done ? ", done" : ""}`;
		const label = tone === "current" ? `${said}, open now. Go to your work` : blocked ? `${said}. ${blocked}` : p.done ? `${said}. Open it again` : `${said}. Open it`;
		const hint = tone !== "current" && blocked ? `${p.title}. ${blocked}` : p.title;
		return { key: p.number, tone, name: p.title, state: tone === "later" ? "upcoming" : tone, number: p.number, jump: null, hint, done: p.done, label };
	});
}

/** A practice lesson's row: "3 of 4 solved" once a problem is finished, one block per problem. Null with no blocks. */
export function practiceRow(progress: PracticeProgress): RowSummary | null {
	if (progress.blocks.length === 0) return null;
	return {
		count: progress.finished > 0 ? `${progress.solved} of ${progress.finished} solved` : null,
		blocks: progress.blocks.map((b, i) => ({
			key: String(i),
			tone: b === "solved" ? "done" : b === "current" ? "current" : "later",
			name: `Problem ${i + 1}`,
			state: b,
		})),
	};
}
