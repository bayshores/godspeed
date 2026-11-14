/** Pure helpers for Today (home-page.tsx): per-space progress, which list a deadline goes in, and each row's words. */
import { hasProblems, localDay, planDays, type DeadlineKind, type DeadlineProgress, type ProgressPayload } from "@/shared/core";
import { clockLabel, deadlineDateLabel } from "@/frontend/components/space-deadlines-model";
import { DAY, HOUR, MINUTE, calendarDays, dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { progressWords } from "@/frontend/components/overview/overview-model";

export interface SpacesProgress {
	/** The latest payload each space has had. */
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Why a space's last read failed. */
	errors: ReadonlyMap<string, string>;
}

export type ProgressRead = { spaceId: string; payload: ProgressPayload } | { spaceId: string; error: string };

/** One round of reads on top of the last state. A failed read keeps the
 *  space's earlier payload, so a blip never blanks a row that had data. */
export function foldSpacesProgress(prev: SpacesProgress, spaceIds: readonly string[], reads: readonly ProgressRead[]): SpacesProgress {
	const progress = new Map<string, ProgressPayload>();
	const errors = new Map<string, string>();
	for (const spaceId of spaceIds) {
		const read = reads.find((r) => r.spaceId === spaceId);
		const payload = read && "payload" in read ? read.payload : prev.progress.get(spaceId);
		if (payload) progress.set(spaceId, payload);
		if (read && "error" in read) errors.set(spaceId, read.error);
	}
	return { progress, errors };
}

/** Every space has either data or a failed read, so no row waits on another. */
export function spacesSettled(spaceIds: readonly string[], state: SpacesProgress): boolean {
	return spaceIds.every((id) => state.progress.has(id) || state.errors.has(id));
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

/** What a deadline that isn't handed in is called in "the test is on". */
const EVENT_WORD: Partial<Record<DeadlineKind, string>> = { quiz: "quiz", interview: "interview" };

/** When an open deadline is due, after its space: "due Friday", "the test
 *  is on Tuesday at 7:00 PM", "was due Tue Oct 27". */
function dueWords(d: OpenDeadline, nowMs: number): string {
	const dueMs = dueAtMs(d);
	if (dueMs <= nowMs) return `was due ${deadlineDateLabel(d.date)}`;
	const days = calendarDays(nowMs, dueMs);
	const day = days === 0 ? "today" : days === 1 ? "tomorrow" : new Date(dueMs).toLocaleDateString("en-US", { weekday: "long" });
	const at = d.time ? ` at ${clockLabel(d.time)}` : "";
	if (hasProblems(d.kind)) return `due ${day}${at}`;
	return `the ${EVENT_WORD[d.kind] ?? "test"} is ${days > 1 ? "on " : ""}${day}${at}`;
}

interface TodayRowWords {
	title: string;
	/** Under the title: the space and when it is due. */
	line: string;
	/** The row's button. "Work on it" works on the assignment's
	 *  problems; the others study ("Study more" starts a new session after
	 *  one reached its end today). */
	button: "Start" | "Continue" | "Study more" | "Work on it";
}

/** Its Study session reached its end today and today's plan has no
 *  topic left, as a moved deadline can give today a topic again. */
function nothingMoreToday(progress: DeadlineProgress | undefined, nowMs: number): boolean {
	return progress?.studyEndedToday === true && !planDays(localDay(nowMs), progress.date, progress.topics)[0]?.topics.length;
}

/** A Today row's words. Homework and projects say how far they are; a
 *  test or quiz says where its Study session stopped, the topic it is in
 *  the middle of, or that nothing more is planned today. */
export function todayRow(d: OpenDeadline, progress: DeadlineProgress | undefined, nowMs: number): TodayRowWords {
	const when = `${d.spaceName}, ${dueWords(d, nowMs)}`;
	if (hasProblems(d.kind)) return { title: d.name, line: `${when}${progressNote(progress)}`, button: "Work on it" };
	const next = progress?.continueStudy;
	if (next) {
		const line = next.stop?.next ? `${d.spaceName}, ${next.stop.next} is next.` : next.inTopic ? `${d.spaceName}, in the middle of ${next.inTopic}.` : when;
		return { title: `Continue studying for ${d.name}`, line, button: "Continue" };
	}
	if (nothingMoreToday(progress, nowMs)) return { title: `Study for ${d.name}`, line: `${d.spaceName}, nothing more is planned today.`, button: "Study more" };
	return { title: `Study for ${d.name}`, line: when, button: "Start" };
}

/** The id of the one row of Today whose button is dark: a session stopped
 *  before today, else the soonest row. A session that stopped today, or
 *  ended today with nothing more planned, is passed over, so with no other
 *  row no button is dark. `deadlines` are soonest first. */
export function mainRowId(deadlines: readonly OpenDeadline[], progress: ReadonlyMap<string, DeadlineProgress>, nowMs: number): string | null {
	const today = localDay(nowMs);
	const stopDay = (d: OpenDeadline) => {
		const at = progress.get(d.id)?.continueStudy?.stop?.at;
		return at === undefined ? null : localDay(Date.parse(at));
	};
	const stoppedBefore = deadlines.find((d) => {
		const day = stopDay(d);
		return day !== null && day < today;
	});
	if (stoppedBefore) return stoppedBefore.id;
	return deadlines.find((d) => stopDay(d) !== today && !nothingMoreToday(progress.get(d.id), nowMs))?.id ?? null;
}

/** Under a Later row's name: "CSE 21, Tuesday Dec 8. 19% ready". */
export function laterLine(d: OpenDeadline, progress: DeadlineProgress | undefined): string {
	return `${d.spaceName}, ${longDay(d.date)}${progressNote(progress)}`;
}
