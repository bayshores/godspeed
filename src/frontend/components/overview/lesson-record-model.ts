/** The Lessons block on Progress: its two groups, the rows each shows, the
 *  line under an unfinished lesson's title, and the edits shown before the
 *  payload has them. Pure. */
import type { LessonProgress } from "@/shared/core";

interface LessonGroup {
	name: "Unfinished" | "Studied";
	/** Newest first. */
	lessons: LessonProgress[];
	/** Rows shown until "Show all". */
	size: number;
}

/** Unfinished (3 rows) then Studied (5 rows), each newest first; a group
 *  with no lessons is left out. */
export function lessonGroups(lessons: readonly LessonProgress[]): LessonGroup[] {
	const newest = [...lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	const groups: LessonGroup[] = [
		{ name: "Unfinished", lessons: newest.filter((l) => l.unfinished), size: 3 },
		{ name: "Studied", lessons: newest.filter((l) => !l.unfinished), size: 5 },
	];
	return groups.filter((g) => g.lessons.length > 0);
}

/** The rows a group shows, and the count "Show all" names (null when none
 *  is hidden). One hidden row is shown instead of hidden. */
export function groupRows(lessons: readonly LessonProgress[], size: number, shownAll: boolean): { rows: readonly LessonProgress[]; showAll: number | null } {
	if (shownAll || lessons.length <= size + 1) return { rows: lessons, showAll: null };
	return { rows: lessons.slice(0, size), showAll: lessons.length };
}

/** Under an unfinished lesson's title: "Step 3 of 5"; nothing before the
 *  first step, with no plan, or for homework. */
export function stepLine(lesson: Pick<LessonProgress, "kind" | "step">): string | null {
	const step = lesson.step;
	if (lesson.kind === "homework" || !step || step.done === 0) return null;
	return `Step ${step.done} of ${step.total}`;
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
