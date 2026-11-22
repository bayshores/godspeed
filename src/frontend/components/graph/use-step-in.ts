/** A part of the Graph slip that steps in after it mounts (`.lh-block-in`). */
import { useState, type CSSProperties } from "react";

/**
 * The class and style that step a part in `delayMs` after it mounts; with null it is simply there.
 * Fixed at mount, so a later render (a fold, a hover) never replays or drops the step.
 */
export function useStepIn(delayMs: number | null): { className: string; style: CSSProperties | undefined } {
	const [at] = useState(delayMs);
	return stepIn(at);
}

/**
 * The same for a part that mounts and steps in once with its panel, which never changes how it came.
 * One due at once is simply there, so it is never hidden for the frame its step takes to start.
 */
export function stepIn(delayMs: number | null): { className: string; style: CSSProperties | undefined } {
	if (delayMs === null || delayMs <= 0) return { className: "", style: undefined };
	return { className: "lh-block-in", style: { "--lh-block-delay": `${delayMs}ms` } as CSSProperties };
}
