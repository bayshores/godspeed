/** The fact grid's colors, one cell per fact (a space's Progress, the graph). Pure and unit-tested. */
import { UNTESTED_COLOR, rampColor, type FactProgress } from "@/shared/core";

/** An unstudied fact's cell: the pane's own border color. */
export const UNSTUDIED_CELL = "var(--border)";

/** A fact's share of right answers (0–1); null before its first answer. */
export function factRate(f: Pick<FactProgress, "answers">): number | null {
	if (f.answers.length === 0) return null;
	return f.answers.filter((a) => a.outcome === "right").length / f.answers.length;
}

/** The space's fact grid, one color per fact: answered facts in their
 *  right rate's ramp color, then studied but unanswered ones, then the
 *  unstudied ones dim. */
export function factCells(facts: readonly Pick<FactProgress, "inLessons" | "answers">[]): string[] {
	const answered = facts.filter((f) => f.answers.length > 0).map((f) => rampColor(factRate(f)));
	const studied = facts.filter((f) => f.answers.length === 0 && f.inLessons).map(() => UNTESTED_COLOR);
	const rest = facts.filter((f) => f.answers.length === 0 && !f.inLessons).map(() => UNSTUDIED_CELL);
	return [...answered, ...studied, ...rest];
}
