/**
 * Deadlines across spaces: their order. Pure and unit-tested. The
 * lists come from GET /api/deadlines (non-archived spaces, soonest
 * first).
 */
import type { SpaceDeadline } from "@/shared/core";
import { dueAtMs } from "./countdown-model";

/** A deadline with its space: an open one, or one ticked done today. */
export type OpenDeadline = SpaceDeadline & { spaceId: string; spaceName: string };

/** Soonest due first (so overdue ones come first), name breaking ties. */
export function byDue<T extends { date: string; time?: string; name: string }>(list: readonly T[]): T[] {
	return [...list].sort((a, b) => dueAtMs(a) - dueAtMs(b) || a.name.localeCompare(b.name));
}

export function isOverdue(d: { date: string; time?: string }, nowMs: number): boolean {
	return dueAtMs(d) <= nowMs;
}
