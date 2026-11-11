/**
 * Deadlines across classes: their order. Pure and unit-tested. The
 * lists come from GET /api/deadlines (non-archived classes, soonest
 * first).
 */
import type { ClassDeadline } from "@/shared/core";
import { dueAtMs } from "./countdown-model";

/** A deadline with its class: an open one, or one ticked done today. */
export type OpenDeadline = ClassDeadline & { classId: string; className: string };

/** Soonest due first (so overdue ones come first), name breaking ties. */
export function byDue<T extends { date: string; time?: string; name: string }>(list: readonly T[]): T[] {
	return [...list].sort((a, b) => dueAtMs(a) - dueAtMs(b) || a.name.localeCompare(b.name));
}

export function isOverdue(d: { date: string; time?: string }, nowMs: number): boolean {
	return dueAtMs(d) <= nowMs;
}
