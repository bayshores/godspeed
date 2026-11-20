/** A space's lessons on Progress: the unfinished ones beside the finished
 *  ones, how many of each show, the day a finished row names, a row's step
 *  blocks, and the edits shown before the payload has them. Also the
 *  lessons one deadline's page lists. Pure. */
import type { DeadlineProgress, LessonProgress } from "@/shared/core";

/** Unfinished lessons shown until "Show all". */
export const UNFINISHED_SHOWN = 3;
/** Finished lessons shown until "Show all". */
export const FINISHED_SHOWN = 12;

/** The unfinished lessons and the finished ones, each newest first. */
export function splitLessons(lessons: readonly LessonProgress[]): { unfinished: LessonProgress[]; finished: LessonProgress[] } {
	const newest = [...lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return { unfinished: newest.filter((l) => l.unfinished), finished: newest.filter((l) => !l.unfinished) };
}

/** The rows a list shows, and the count "Show all" names (null when none is
 *  hidden). One hidden row is shown instead of hidden. */
export function shownRows<T>(rows: readonly T[], limit: number, shownAll: boolean): { rows: readonly T[]; showAll: number | null } {
	if (shownAll || rows.length <= limit + 1) return { rows, showAll: null };
	return { rows: rows.slice(0, limit), showAll: rows.length };
}

/** The lessons for one deadline, the one last worked in first: the one its
 *  Study key continues while it is unfinished. */
export function lessonsFor(lessons: readonly LessonProgress[], deadlineId: string): LessonProgress[] {
	return lessons.filter((l) => l.deadlineId === deadlineId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** An unfinished lesson's key: "Work on it" for homework, else "Continue". */
export function keyLabel(lesson: Pick<LessonProgress, "kind">): string {
	return lesson.kind === "homework" ? "Work on it" : "Continue";
}

/** A homework lesson's blocks are its deadline's problems; any other
 *  lesson's are the steps of its plan. Null with neither. */
export function stepBlocks(
	lesson: Pick<LessonProgress, "kind" | "step" | "deadlineId">,
	deadlines: readonly Pick<DeadlineProgress, "id" | "problems">[],
): { done: number; total: number } | null {
	const problems = lesson.kind === "homework" ? deadlines.find((d) => d.id === lesson.deadlineId)?.problems : undefined;
	const blocks = problems ?? lesson.step;
	return blocks && blocks.total > 0 ? blocks : null;
}

const startOfDay = (ms: number) => {
	const d = new Date(ms);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** The day a lesson was last worked on: "Today", "Yesterday", "Nov 14",
 *  or "Nov 14, 2025" in another year. */
export function dayWord(at: string, nowMs: number): string {
	const ms = Date.parse(at);
	if (Number.isNaN(ms)) return "";
	const days = Math.round((startOfDay(nowMs) - startOfDay(ms)) / 86_400_000);
	if (days <= 0) return "Today";
	if (days === 1) return "Yesterday";
	const sameYear = new Date(ms).getFullYear() === new Date(nowMs).getFullYear();
	return new Date(ms).toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
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
