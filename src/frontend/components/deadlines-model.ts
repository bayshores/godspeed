/**
 * Open deadlines across classes: their order and short labels. Pure and
 * unit-tested. The list comes from GET /api/deadlines (open deadlines of
 * non-archived classes, soonest first).
 */
import type { ClassDeadline } from "@/shared/core";
import { clockLabel, deadlineDateLabel } from "./class-deadlines-model";
import { dueAtMs } from "./countdown-model";

export type OpenDeadline = ClassDeadline & { classId: string; className: string };

/** Soonest due first (so overdue ones come first), name breaking ties. */
export function byDue<T extends { date: string; time?: string; name: string }>(list: readonly T[]): T[] {
	return [...list].sort((a, b) => dueAtMs(a) - dueAtMs(b) || a.name.localeCompare(b.name));
}

export function isOverdue(d: { date: string; time?: string }, nowMs: number): boolean {
	return dueAtMs(d) <= nowMs;
}

/** "Fri" for a YYYY-MM-DD date. */
function weekdayLabel(date: string): string {
	return deadlineDateLabel(date).split(" ")[0] ?? "";
}

/** The short "when" under a title: the time ("5:00 PM"), or the weekday
 *  ("Fri") for a deadline with no time. */
export function whenLabel(d: { date: string; time?: string }): string {
	return d.time ? clockLabel(d.time) : weekdayLabel(d.date);
}
