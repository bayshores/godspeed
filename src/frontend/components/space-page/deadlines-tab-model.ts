/** The space's Deadlines tab: which list a deadline goes in, where its outline sits, each row's words and the link that opens Add a deadline. Pure. */
import { hasProblems, isCalendarDate, isDeadlineKind, longDay, type DeadlineKind, type DeadlineProgress, type RhythmGap } from "@/shared/core";
import { dueAtMs, gapDueMs } from "@/frontend/components/countdown-model";
import { kindLabel, type DeadlineSeed } from "@/frontend/components/space-deadlines-model";
import { byDue, isOverdue } from "@/frontend/components/deadlines-model";
import { progressNote } from "@/frontend/components/home-page/home-page-model";
import type { Leaving } from "@/frontend/components/presence";

interface Listed {
	kind: DeadlineKind;
	name: string;
	date: string;
	time?: string;
	done: boolean;
}

/** The Deadlines tab with its "Add a deadline" dialog open, filled in with `seed`'s kind, name
 *  and date when given. */
export function addDeadlineHref(seed?: DeadlineSeed): string {
	const params = new URLSearchParams({ add: "1" });
	if (seed) params.set("kind", seed.kind);
	if (seed) params.set("name", seed.name);
	if (seed?.date) params.set("date", seed.date);
	return `/space/deadlines?${params}`;
}

/** The address once the dialog it asked for is open: without what addDeadlineHref put in it. */
export function withoutAddLink(params: URLSearchParams): URLSearchParams {
	for (const key of ["add", "kind", "name", "date"]) params.delete(key);
	return params;
}

/** The seed addDeadlineHref put in the address; undefined for a plain "Add a deadline". */
export function seedFromSearch(params: URLSearchParams): DeadlineSeed | undefined {
	const kind = params.get("kind");
	const name = params.get("name");
	const date = params.get("date");
	if (!isDeadlineKind(kind) || name === null) return undefined;
	return { kind, name, ...(date !== null && isCalendarDate(date) ? { date } : {}) };
}

/** "Coming up": not done and not yet due, soonest first. "Done or past":
 *  the rest, latest first. */
export function deadlineLists<T extends Listed>(deadlines: readonly T[], nowMs: number): { coming: T[]; past: T[] } {
	const past = (d: T) => d.done || isOverdue(d, nowMs);
	return { coming: byDue(deadlines.filter((d) => !past(d))), past: byDue(deadlines.filter(past)).reverse() };
}

/** One row of "Coming up": a deadline, or the space's outline (a rhythm gap), held while it leaves. */
type ComingRow<T> = { kind: "deadline"; deadline: T } | { kind: "gap"; gap: RhythmGap; leaving: boolean };

/** "Coming up" with the outlines placed by their day: due at the day's end, as a deadline with no
 *  time, so after what is due earlier that day and before a deadline with no time that day.
 *  `coming` is soonest first. An outline that leaves as a deadline `joined` on its day gives way at
 *  once, so the new row takes its place and the rows after it hold still. */
export function comingRows<T extends Listed>(coming: readonly T[], gaps: readonly Leaving<RhythmGap>[], joined: (d: T) => boolean): ComingRow<T>[] {
	const rows: ComingRow<T>[] = coming.map((deadline) => ({ kind: "deadline", deadline }));
	for (const { item: gap, leaving } of gaps) {
		if (leaving && coming.some((d) => d.date === gap.day && joined(d))) continue;
		const at = gapDueMs(gap);
		const after = rows.findIndex((row) => row.kind === "deadline" && dueAtMs(row.deadline) >= at);
		rows.splice(after < 0 ? rows.length : after, 0, { kind: "gap", gap, leaving });
	}
	return rows;
}

/** Under a row's name. Coming up: "Homework, due Friday Nov 13. 2 of 7
 *  problems done", "Exam, Tuesday Dec 8. 19% ready". Done or past:
 *  "Homework, was due Friday Nov 6", "Exam, Tuesday Oct 20". */
export function deadlineLine(d: Listed, progress: DeadlineProgress | undefined, nowMs: number): string {
	const past = d.done || isOverdue(d, nowMs);
	const due = !hasProblems(d.kind) ? "" : past ? "was due " : "due ";
	return `${kindLabel(d.kind)}, ${due}${longDay(d.date)}${past ? "" : progressNote(progress)}`;
}
