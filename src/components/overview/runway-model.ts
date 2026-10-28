/**
 * "Ready for what's due" (Class Overview, plan 2026-10-28 Phase 3): which
 * deadlines the runway shows, the labels around its rings and the "Most
 * needed" topic. Pure and unit-tested.
 */
import { daysBetween, type DeadlineProgress } from "@/core";
import { deadlineDateLabel, dueLabel } from "@/components/class-deadlines-model";
import { byDue, isOverdue } from "@/components/deadlines-model";
import { deadlineFilesText } from "@/components/graph/derive";
import { displayName } from "./overview-model";

/** Deadline stops after "Today". */
export const RUNWAY_STOPS = 5;

type Due = Pick<DeadlineProgress, "id" | "kind" | "name" | "date" | "time" | "done">;

/** The deadlines still ahead (open, not past due), soonest first. */
export function upcomingDeadlines<T extends Due>(deadlines: readonly T[], nowMs: number): T[] {
	return byDue(deadlines.filter((d) => !d.done && !isOverdue(d, nowMs)));
}

/** The runway's stops: the next 5; with more than 5, the next 4 and a
 *  "+N later" slot for the rest. */
export function runwayStops<T extends Due>(upcoming: readonly T[], max = RUNWAY_STOPS): { stops: T[]; later: number } {
	if (upcoming.length <= max) return { stops: [...upcoming], later: 0 };
	return { stops: upcoming.slice(0, max - 1), later: upcoming.length - (max - 1) };
}

/** The text over a line segment: "1 day", "2 days"; nothing on the same day. */
export function gapLabel(fromDate: string, toDate: string): string {
	const days = daysBetween(fromDate, toDate);
	if (days <= 0) return "";
	return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Under a stop's name: "Fri Oct 30", or "Exam · Thu Nov 5" for exams. */
export function stopMeta(d: Pick<DeadlineProgress, "kind" | "date">): string {
	const day = deadlineDateLabel(d.date);
	return d.kind === "exam" ? `Exam · ${day}` : day;
}

/** 0.38 → 38. */
export function percent(rate: number): number {
	return Math.round(rate * 100);
}

/** The ring tooltip's title: "Midterm 2 · 38% ready" (just the name when
 *  there is nothing to be ready on). */
export function ringTitle(d: Pick<DeadlineProgress, "name" | "ready">): string {
	return d.ready === null ? d.name : `${d.name} · ${percent(d.ready)}% ready`;
}

/** The ring tooltip's second line: "Thu Nov 5, 7:00 PM · Lecture 4". */
export function ringMeta(d: Pick<DeadlineProgress, "date" | "time" | "files">): string {
	const when = dueLabel(d.date, d.time);
	const files = deadlineFilesText(d.files.map((f) => ({ name: displayName(f.name) })));
	return files ? `${when} · ${files}` : when;
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(names: readonly string[]): string {
	if (names.length <= 1) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface MostNeeded {
	topicId: string;
	name: string;
	/** The deadlines that cover it, soonest first. */
	deadlines: string[];
}

/** The open-deadline topic with the lowest right rate (untested counts as
 *  0); ties go to the topic more deadlines cover, then by name. */
export function mostNeeded(upcoming: readonly Pick<DeadlineProgress, "name" | "topics">[]): MostNeeded | null {
	const byTopic = new Map<string, { name: string; rate: number; deadlines: string[] }>();
	for (const d of upcoming) {
		for (const t of d.topics) {
			const entry = byTopic.get(t.id);
			if (entry) {
				if (!entry.deadlines.includes(d.name)) entry.deadlines.push(d.name);
			} else byTopic.set(t.id, { name: t.name, rate: t.rate ?? 0, deadlines: [d.name] });
		}
	}
	let best: (MostNeeded & { rate: number }) | null = null;
	for (const [topicId, e] of byTopic) {
		const better =
			!best ||
			e.rate < best.rate ||
			(e.rate === best.rate && (e.deadlines.length > best.deadlines.length || (e.deadlines.length === best.deadlines.length && e.name.localeCompare(best.name) < 0)));
		if (better) best = { topicId, name: e.name, rate: e.rate, deadlines: e.deadlines };
	}
	return best ? { topicId: best.topicId, name: best.name, deadlines: best.deadlines } : null;
}

/** Facts that came up in a lesson, of all the class's facts. */
export function studiedFacts(facts: readonly { inLessons: boolean }[]): { studied: number; total: number } {
	return { studied: facts.filter((f) => f.inLessons).length, total: facts.length };
}
