/** The space's Deadlines tab: which list a deadline goes in and each row's words. Pure. */
import { hasProblems, type DeadlineKind, type DeadlineProgress } from "@/shared/core";
import { kindLabel } from "@/frontend/components/space-deadlines-model";
import { byDue, isOverdue } from "@/frontend/components/deadlines-model";
import { longDay, progressNote } from "@/frontend/components/home-page/home-page-model";

interface Listed {
	kind: DeadlineKind;
	name: string;
	date: string;
	time?: string;
	done: boolean;
}

/** The Deadlines tab with its "Add a deadline" dialog open. */
export const ADD_DEADLINE_HREF = "/space/deadlines?add=1";

/** "Coming up": not done and not yet due, soonest first. "Done or past":
 *  the rest, latest first. */
export function deadlineLists<T extends Listed>(deadlines: readonly T[], nowMs: number): { coming: T[]; past: T[] } {
	const past = (d: T) => d.done || isOverdue(d, nowMs);
	return { coming: byDue(deadlines.filter((d) => !past(d))), past: byDue(deadlines.filter(past)).reverse() };
}

/** Under a row's name. Coming up: "Homework, due Friday Nov 13. 2 of 7
 *  problems done", "Exam, Tuesday Dec 8. 19% ready". Done or past:
 *  "Homework, was due Friday Nov 6", "Exam, Tuesday Oct 20". */
export function deadlineLine(d: Listed, progress: DeadlineProgress | undefined, nowMs: number): string {
	const past = d.done || isOverdue(d, nowMs);
	const due = !hasProblems(d.kind) ? "" : past ? "was due " : "due ";
	return `${kindLabel(d.kind)}, ${due}${longDay(d.date)}${past ? "" : progressNote(progress)}`;
}
