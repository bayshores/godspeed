/** Pure helpers for Today (home-page.tsx): per-class progress, which list a deadline goes in, and each row's words. */
import { hasProblems, localDay, planDays, type DeadlineProgress, type ProgressPayload } from "@/shared/core";
import { clockLabel, deadlineDateLabel } from "@/frontend/components/class-deadlines-model";
import { DAY, HOUR, MINUTE, calendarDays, dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { progressWords } from "@/frontend/components/overview/overview-model";

export interface ClassesProgress {
	/** The latest payload each class has had. */
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Why a class's last read failed. */
	errors: ReadonlyMap<string, string>;
}

export type ProgressRead = { classId: string; payload: ProgressPayload } | { classId: string; error: string };

/** One round of reads on top of the last state. A failed read keeps the
 *  class's earlier payload, so a blip never blanks a row that had data. */
export function foldClassesProgress(prev: ClassesProgress, classIds: readonly string[], reads: readonly ProgressRead[]): ClassesProgress {
	const progress = new Map<string, ProgressPayload>();
	const errors = new Map<string, string>();
	for (const classId of classIds) {
		const read = reads.find((r) => r.classId === classId);
		const payload = read && "payload" in read ? read.payload : prev.progress.get(classId);
		if (payload) progress.set(classId, payload);
		if (read && "error" in read) errors.set(classId, read.error);
	}
	return { progress, errors };
}

/** Every class has either data or a failed read, so no row waits on another. */
export function classesSettled(classIds: readonly string[], state: ClassesProgress): boolean {
	return classIds.every((id) => state.progress.has(id) || state.errors.has(id));
}

/** A deadline at most this many days away is under Today; the rest are Later. */
const TODAY_DAYS = 7;

/** Due within the week, or overdue. */
export function dueThisWeek(d: { date: string; time?: string }, nowMs: number): boolean {
	return calendarDays(nowMs, dueAtMs(d)) <= TODAY_DAYS;
}

interface TodayLists {
	/** Open, due within the week or overdue. */
	today: OpenDeadline[];
	/** Ticked done today. */
	done: OpenDeadline[];
	/** Open, due after the week. */
	later: OpenDeadline[];
}

/** Today's three lists, each in the order given (soonest first). A done
 *  row leaves when the day turns, without a new read. */
export function todayLists(open: readonly OpenDeadline[], doneToday: readonly OpenDeadline[], nowMs: number): TodayLists {
	const soon = (d: OpenDeadline) => dueThisWeek(d, nowMs);
	const day = localDay(nowMs);
	return {
		today: open.filter(soon),
		done: doneToday.filter((d) => d.doneAt !== undefined && localDay(new Date(d.doneAt)) === day),
		later: open.filter((d) => !soon(d)),
	};
}

/** The count block: whole days left, hours on the last day, minutes in
 *  the last hour, "late" once it is due. */
export function countLeft(dueMs: number, nowMs: number): { count: string; unit: string } {
	const left = dueMs - nowMs;
	if (left <= 0) return { count: "late", unit: "" };
	if (left >= DAY) {
		const days = calendarDays(nowMs, dueMs);
		return { count: String(days), unit: days === 1 ? "day" : "days" };
	}
	if (left >= HOUR) {
		const hours = Math.floor(left / HOUR);
		return { count: String(hours), unit: hours === 1 ? "hour" : "hours" };
	}
	return { count: String(Math.ceil(left / MINUTE)), unit: "min" };
}

/** "Wednesday Nov 11" for 2026-11-11. */
export function longDay(day: string): string {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const date = new Date(y, m - 1, d);
	return `${date.toLocaleDateString("en-US", { weekday: "long" })} ${date.toLocaleDateString("en-US", { month: "short" })} ${d}`;
}

/** ". 2 of 7 problems done", or ". 19% ready" for one with no problems;
 *  "" with nothing to count. */
export function progressNote(p: DeadlineProgress | undefined): string {
	const words = p && progressWords(p);
	return words ? `. ${words}` : "";
}

/** When an open deadline is due, after its class: "due Friday", "the test
 *  is on Tuesday at 7:00 PM", "was due Tue Oct 27". */
function dueWords(d: OpenDeadline, nowMs: number): string {
	const dueMs = dueAtMs(d);
	if (dueMs <= nowMs) return `was due ${deadlineDateLabel(d.date)}`;
	const days = calendarDays(nowMs, dueMs);
	const day = days === 0 ? "today" : days === 1 ? "tomorrow" : new Date(dueMs).toLocaleDateString("en-US", { weekday: "long" });
	const at = d.time ? ` at ${clockLabel(d.time)}` : "";
	if (hasProblems(d.kind)) return `due ${day}${at}`;
	return `the ${d.kind === "quiz" ? "quiz" : "test"} is ${days > 1 ? "on " : ""}${day}${at}`;
}

interface TodayRowWords {
	title: string;
	/** Under the title: the class and when it is due. */
	line: string;
	/** The one main button. "Work on it" works on the assignment's
	 *  problems; the others study. */
	button: "Start" | "Continue" | "Work on it";
}

/** A Today row's words. A test or quiz names today's share of the topics
 *  that still need work; homework and projects say how far they are. */
export function todayRow(d: OpenDeadline, progress: DeadlineProgress | undefined, nowMs: number): TodayRowWords {
	const when = `${d.className}, ${dueWords(d, nowMs)}`;
	if (hasProblems(d.kind)) return { title: d.name, line: `${when}${progressNote(progress)}`, button: "Work on it" };
	if (progress?.continueStudy) return { title: `Continue studying for ${d.name}`, line: when, button: "Continue" };
	const topics = progress ? (planDays(localDay(nowMs), d.date, progress.topics)[0]?.topics.length ?? 0) : 0;
	const title = topics > 0 ? `Study ${topics} ${topics === 1 ? "topic" : "topics"} for ${d.name}` : d.name;
	return { title, line: when, button: "Start" };
}

/** Under a Later row's name: "CSE 21, Tuesday Dec 8. 19% ready". */
export function laterLine(d: OpenDeadline, progress: DeadlineProgress | undefined): string {
	return `${d.className}, ${longDay(d.date)}${progressNote(progress)}`;
}
