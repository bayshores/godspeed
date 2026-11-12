import { stepPosition, type HomeworkProblem, type PlanStep, type PlanStepBar, type StepAnswer } from "@/shared/core";
import type { PracticeProgress } from "./practice-progress";

/** How a block or a list row reads: done in ink, the one in progress, the rest light. */
export type Tone = "done" | "current" | "later";

/** One block of the plan row. */
export interface RowBlock {
	key: string;
	tone: Tone;
	/** The step's or problem's name, for the tooltip and the label. */
	name: string;
	/** The raw status the block carries as data-block. */
	state: string;
	/** A done step's first answered question: the block scrolls back to it. */
	jump: string | null;
}

/** What the row shows: its count, its blocks and where the learner is now. */
export interface RowSummary {
	count: string | null;
	blocks: RowBlock[];
	/** The current step's or problem's name; null when none is current. */
	here: string | null;
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

/** "Problem 3" for a bare number, else the number as the assignment writes it. */
function problemName(number: string): string {
	return /^\d/.test(number) ? `Problem ${number}` : number;
}

/** The line over an open homework problem: "HW6, problem 3 of 7, part b". */
export function homeworkProblemLine(name: string, total: number, open: string, part: string | null): string {
	const place = /^\d/.test(open) ? `problem ${open} of ${total}` : open;
	return `${name}, ${place}${part ? `, part ${part}` : ""}`;
}

/** A problem's place in the assignment. */
export function problemTone(problem: HomeworkProblem, open: string | null): Tone {
	return problem.done ? "done" : problem.number === open ? "current" : "later";
}

/** A plan lesson's row: "Step 2 of 4", one block per step. Null with no steps. */
export function stepsRow(bar: PlanStepBar): RowSummary | null {
	if (bar.steps.length === 0) return null;
	return {
		count: `Step ${stepPosition(bar.steps)} of ${bar.steps.length}`,
		blocks: bar.steps.map((step) => ({
			key: step.id,
			tone: step.status === "visited" ? "done" : step.status === "current" ? "current" : "later",
			name: step.title,
			state: step.status,
			jump: jumpTarget(step),
		})),
		here: bar.steps[bar.currentIndex]?.title ?? null,
	};
}

/** A homework lesson's row: "2 of 7 done", one block per problem. Null with no problems. */
export function homeworkRow(problems: readonly HomeworkProblem[], open: string | null): RowSummary | null {
	if (problems.length === 0) return null;
	const done = problems.filter((p) => p.done).length;
	return {
		count: `${done} of ${problems.length} done`,
		blocks: problems.map((p) => {
			const tone = problemTone(p, open);
			return { key: p.number, tone, name: p.title, state: tone === "later" ? "upcoming" : tone, jump: null };
		}),
		here: open === null ? null : problemName(open),
	};
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
			jump: null,
		})),
		here: null,
	};
}
