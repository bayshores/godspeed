import { createContext, useContext } from "react";

/** The lesson plan's step numbers by plan node id (1-based, learning
 *  order) — answered cards read it to say "Check · step 10". Stable while
 *  the plan is unchanged, so streaming never redraws the cards. */
export const LessonStepsContext = createContext<ReadonlyMap<string, number> | null>(null);

/** The step number a question's input points at (its nodeId), if any. */
export function useStepNumber(input: unknown): number | undefined {
	const steps = useContext(LessonStepsContext);
	const nodeId = (input as { nodeId?: unknown } | null | undefined)?.nodeId;
	return steps && typeof nodeId === "string" ? steps.get(nodeId) : undefined;
}

/** The transcript anchor of an answered question (the step bar's jump). */
export function answerAnchorSelector(toolCallId: string): string {
	return `[data-answer-call="${toolCallId.replace(/["\\]/g, "\\$&")}"]`;
}
