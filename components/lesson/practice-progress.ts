/**
 * A practice lesson's progress for its top bar ("2 of 3 solved") and the
 * Your-turn chip ("Problem 3"). Pure: derived from the view messages —
 * every posed problem that went through, closed by the conclude call that
 * follows it.
 */

export type PracticeBlock = "solved" | "missed" | "current";

export interface PracticeProgress {
	/** One block per finished problem, in order, plus the active one last. */
	blocks: PracticeBlock[];
	solved: number;
	finished: number;
	/** The active problem's 1-based number, or null between problems. */
	currentNumber: number | null;
}

const SOLVED = new Set(["solved", "solvedWithHints"]);

export function practiceProgress(
	messages: ReadonlyArray<{ parts: ReadonlyArray<{ type: string; state?: string; input?: unknown }> }>,
	activeProblem: boolean,
): PracticeProgress {
	const blocks: PracticeBlock[] = [];
	let open = false;
	for (const m of messages) {
		for (const part of m.parts) {
			if (part.state === "output-error" || part.state === "input-streaming") continue;
			if (part.type === "tool-problem") {
				open = true;
			} else if (part.type === "tool-conclude" && open) {
				const outcome = (part.input as { outcome?: unknown } | undefined)?.outcome;
				blocks.push(typeof outcome === "string" && SOLVED.has(outcome) ? "solved" : "missed");
				open = false;
			}
		}
	}
	const solved = blocks.filter((b) => b === "solved").length;
	const finished = blocks.length;
	if (activeProblem) blocks.push("current");
	return { blocks, solved, finished, currentNumber: activeProblem ? finished + 1 : null };
}
