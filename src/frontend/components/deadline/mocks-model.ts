/** A deadline's mocks as its Path sheet shows them: which deadlines take
 *  them, when "Take a mock" is off, and the mock box's numbers. Pure. */
import type { DeadlineKind } from "@/shared/core";

/** A range the mock box's steppers keep a number in. */
export interface StepRange {
	min: number;
	max: number;
	step: number;
	/** What the box opens with. */
	start: number;
}

export const QUESTIONS: StepRange = { min: 1, max: 10, step: 1, start: 5 };
export const MINUTES: StepRange = { min: 5, max: 240, step: 5, start: 45 };

/** A whole number in the range; anything that isn't a number keeps `fallback`. */
export function clampTo(range: StepRange, n: number, fallback: number): number {
	if (!Number.isFinite(n)) return fallback;
	return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

/** Tests and interviews have mocks; homework and projects have problems. */
export function takesMocks(kind: DeadlineKind): boolean {
	return kind === "exam" || kind === "quiz" || kind === "interview";
}

/** Why "Take a mock" is off, or null when it is on: a mock is written from
 *  the deadline's study facts or from what it's like, and with neither it
 *  would be made up. */
export function mockOffReason(hasFacts: boolean, hasAbout: boolean): string | null {
	return hasFacts || hasAbout ? null : "A mock is written from this deadline's study files or from what it's like, and it has neither yet.";
}

/** What POST /api/spaces/:id/mocks sends: no minutes means no time limit. */
export function newMockBody(deadlineId: string, questions: number, minutes: number | null): { deadlineId: string; questions: number; minutes?: number } {
	return { deadlineId, questions, ...(minutes === null ? {} : { minutes }) };
}

/** Under "Remove {deadline}?": "Its 3 mocks are removed too."; null with none. */
export function mocksRemovedLine(count: number): string | null {
	if (count === 0) return null;
	return count === 1 ? "Its mock is removed too." : `Its ${count} mocks are removed too.`;
}
