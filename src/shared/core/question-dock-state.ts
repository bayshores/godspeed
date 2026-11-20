/** The question dock's pure state: which options are picked, the confidence meter, and the saved draft. */

import type { SelectMode } from "./question-data.ts";

/** The confidence meter's stops: a 1–5 scale, SAVED as a percentage so the teacher's confidence prompt
 *  (shared/25-confidence.md) reads the same numbers it always has —
 *  level 1..5 ↔ 20/40/60/80/100. Older answers carry the previous grid
 *  (0/30/50/70/90/100) and display at the nearest level (confidenceLevel).
 *  The meter starts unrated: no level, no confidence sent. */
export const CONFIDENCE_STOPS: readonly number[] = [20, 40, 60, 80, 100];
const MIDDLE_CONFIDENCE_INDEX = 2;

/** One arrow press on the meter. Unrated counts as the middle level, so
 *  the first press lands next to it. */
export function stepConfidence(index: number | undefined, dir: 1 | -1): number {
	return Math.min(CONFIDENCE_STOPS.length - 1, Math.max(0, (index ?? MIDDLE_CONFIDENCE_INDEX) + dir));
}

export type ConfidenceLevel = 1 | 2 | 3 | 4 | 5;

/** The percentage a 1–5 level saves as (level × 20). */
function levelPercent(level: ConfidenceLevel): number {
	return level * 20;
}

/** The 1–5 level nearest a stored percentage (any 0–100 value, old grid
 *  included). Ties go to the lower level: 30 → 1, 50 → 2, 70 → 3, 90 → 4;
 *  0 → 1, 100 → 5. Out-of-range or non-finite input clamps. */
export function confidenceLevel(percent: number): ConfidenceLevel {
	const p = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 60;
	let best: ConfidenceLevel = 1;
	for (const level of [2, 3, 4, 5] as const) {
		if (Math.abs(levelPercent(level) - p) < Math.abs(levelPercent(best) - p)) best = level;
	}
	return best;
}

// ─── dock selection (the client state machine, pure for tests) ─────────────

/** The question dock's selection state (0-based indices in display order). */
export interface DockSelection {
	selected: Set<number>;
}

export const emptyDockSelection = (): DockSelection => ({ selected: new Set() });

/** The question form as the learner left it (saved with the lesson's
 * drafts). Indices use the call's stable shuffle. */
export interface QuestionFormDraft {
	selection: DockSelection;
	/** Absent until the learner picks a level. */
	confidenceIndex?: number;
	/** A code question's code, once it is no longer the starter code. */
	code?: string;
}

export interface QuestionDraft {
	form?: QuestionFormDraft;
}

/**
 * Toggling a listed option. Single-select: the option becomes THE answer,
 * and clicking the picked one again clears it. Multi-select: the option
 * toggles alongside its siblings.
 */
export function toggleOption(mode: SelectMode, sel: DockSelection, idx: number): DockSelection {
	if (mode === "multi-select") {
		const selected = new Set(sel.selected);
		if (selected.has(idx)) selected.delete(idx);
		else selected.add(idx);
		return { selected };
	}
	return { selected: sel.selected.has(idx) ? new Set() : new Set([idx]) };
}
