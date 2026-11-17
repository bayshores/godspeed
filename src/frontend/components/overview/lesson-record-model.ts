/** The Lessons block on Progress: its rows in order, how many show, what
 *  an unfinished lesson's chip says, and the edits shown before the payload
 *  has them. Pure. */
import type { LessonProgress } from "@/shared/core";

/** Rows shown until "Show all". */
const SHOWN = 8;

/** Unfinished lessons first, then the studied ones, each newest first. */
export function lessonOrder(lessons: readonly LessonProgress[]): LessonProgress[] {
	const newest = [...lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return [...newest.filter((l) => l.unfinished), ...newest.filter((l) => !l.unfinished)];
}

/** The rows the block shows, and the count "Show all" names (null when none
 *  is hidden). One hidden row is shown instead of hidden. */
export function shownRows(lessons: readonly LessonProgress[], shownAll: boolean): { rows: readonly LessonProgress[]; showAll: number | null } {
	if (shownAll || lessons.length <= SHOWN + 1) return { rows: lessons, showAll: null };
	return { rows: lessons.slice(0, SHOWN), showAll: lessons.length };
}

/** An unfinished lesson's chip: "Homework", its step ("Step 3 of 5"), or
 *  "Started" before the first step and with no plan. */
export function statusChip(lesson: Pick<LessonProgress, "kind" | "step">): string {
	if (lesson.kind === "homework") return "Homework";
	const step = lesson.step;
	return step && step.done > 0 ? `Step ${step.done} of ${step.total}` : "Started";
}

/** An unfinished lesson's key: "Work on it" for homework, else "Continue". */
export function keyLabel(lesson: Pick<LessonProgress, "kind">): string {
	return lesson.kind === "homework" ? "Work on it" : "Continue";
}

/** Renames, deletes and moves the server took that the payload may not show
 *  yet: chat id → the new title, or null once the row is gone from here. */
export type LessonEdits = Readonly<Record<string, string | null>>;

/** The lessons with the edits applied. */
export function withEdits(lessons: readonly LessonProgress[], edits: LessonEdits): LessonProgress[] {
	return lessons.flatMap((l) => {
		const edit = edits[l.chatId];
		if (edit === undefined) return [l];
		return edit === null ? [] : [{ ...l, title: edit }];
	});
}

/** The edits the payload doesn't agree with yet; the same object when
 *  every one still stands. */
export function pendingEdits(edits: LessonEdits, lessons: readonly LessonProgress[]): LessonEdits {
	const byId = new Map(lessons.map((l) => [l.chatId, l]));
	const left = Object.entries(edits).filter(([id, edit]) => {
		const lesson = byId.get(id);
		return lesson !== undefined && (edit === null || lesson.title !== edit);
	});
	return left.length === Object.keys(edits).length ? edits : Object.fromEntries(left);
}
