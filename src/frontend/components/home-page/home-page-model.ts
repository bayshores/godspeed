/** Pure helpers for Home (home-page.tsx): per-space progress, which list a deadline goes in, which one the card shows and its words. */
import { hasProblems, localDay, longDay, nothingMorePlannedLine, planDays, type ContinueStudy, type DeadlineKind, type DeadlineProgress, type ProgressPayload } from "@/shared/core";
import { clockLabel, deadlineDateLabel } from "@/frontend/components/space-deadlines-model";
import { DAY, HOUR, MINUTE, calendarDays, dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { progressWords } from "@/frontend/components/overview/overview-model";

export interface SpacesProgress {
	/** The latest payload each space has had. */
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Why a space's last read failed. */
	errors: ReadonlyMap<string, string>;
	/** The lessons with no space, for the week line; null before the first read. */
	noSpace: ProgressPayload | null;
}

/** `spaceId` null: the lessons with no space. */
export type ProgressRead = { spaceId: string | null; payload: ProgressPayload } | { spaceId: string | null; error: string };

/** One round of reads on top of the last state. A failed read keeps the
 *  earlier payload, so a blip never blanks a row that had data. */
export function foldSpacesProgress(prev: SpacesProgress, spaceIds: readonly string[], reads: readonly ProgressRead[]): SpacesProgress {
	const progress = new Map<string, ProgressPayload>();
	const errors = new Map<string, string>();
	for (const spaceId of spaceIds) {
		const read = reads.find((r) => r.spaceId === spaceId);
		const payload = read && "payload" in read ? read.payload : prev.progress.get(spaceId);
		if (payload) progress.set(spaceId, payload);
		if (read && "error" in read) errors.set(spaceId, read.error);
	}
	const none = reads.find((r) => r.spaceId === null);
	return { progress, errors, noSpace: none && "payload" in none ? none.payload : prev.noSpace };
}

/** Every space has either data or a failed read, so no row waits on another. */
export function spacesSettled(spaceIds: readonly string[], state: SpacesProgress): boolean {
	return spaceIds.every((id) => state.progress.has(id) || state.errors.has(id));
}

/** The week is today and the six days after it; a deadline further away is Later. */
const TODAY_DAYS = 6;

/** Due within the week, or overdue. */
export function dueThisWeek(d: { date: string; time?: string }, nowMs: number): boolean {
	return calendarDays(nowMs, dueAtMs(d)) <= TODAY_DAYS;
}

export interface HomeLists {
	/** Open, due within the week or overdue, soonest first. */
	today: OpenDeadline[];
	/** Ticked done today. */
	done: OpenDeadline[];
	/** Open, due after the week. */
	later: OpenDeadline[];
}

/** Home's three lists, each in the order given (soonest first). A done
 *  row leaves when the day turns, without a new read. */
export function homeLists(open: readonly OpenDeadline[], doneToday: readonly OpenDeadline[], nowMs: number): HomeLists {
	const soon = (d: OpenDeadline) => dueThisWeek(d, nowMs);
	const day = localDay(nowMs);
	return {
		today: open.filter(soon),
		done: doneToday.filter((d) => d.doneAt !== undefined && localDay(new Date(d.doneAt)) === day),
		later: open.filter((d) => !soon(d)),
	};
}

/** An overdue deadline is asked about for this many days after its due day. */
const OVERDUE_ASK_DAYS = 7;

/** The overdue deadline to ask "Done?" about: the oldest one not done,
 *  past due by at most a week and not answered Not yet. */
export function overdueToAsk(open: readonly OpenDeadline[], asked: readonly string[], nowMs: number): OpenDeadline | null {
	let oldest: OpenDeadline | null = null;
	for (const d of open) {
		const late = nowMs - dueAtMs(d);
		if (d.done || late <= 0 || late > OVERDUE_ASK_DAYS * DAY || asked.includes(d.id)) continue;
		if (!oldest || dueAtMs(d) < dueAtMs(oldest)) oldest = d;
	}
	return oldest;
}

/** The count block: whole days left, hours on the last day, minutes in
 *  the last hour. Once it is due, the same count of how late it is
 *  ("2" over "days late"). */
export function countLeft(dueMs: number, nowMs: number): { count: string; unit: string } {
	const late = dueMs <= nowMs;
	const [from, to] = late ? [dueMs, nowMs] : [nowMs, dueMs];
	const gap = to - from;
	const count = (n: number, one: string, many: string) => ({ count: String(n), unit: `${n === 1 ? one : many}${late ? " late" : ""}` });
	if (gap >= DAY) return count(calendarDays(from, to), "day", "days");
	if (gap >= HOUR) return count(Math.floor(gap / HOUR), "hour", "hours");
	return count(Math.max(1, Math.ceil(gap / MINUTE)), "min", "min");
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
 *  is on Tuesday at 7:00 PM", "due Sunday Nov 29" after the week, "was due
 *  Tue Oct 27". `short` drops "the test
 *  is on" where the title already says what it is. */
export function dueWords(d: OpenDeadline, nowMs: number, short = false): string {
	const dueMs = dueAtMs(d);
	if (dueMs <= nowMs) return `was due ${deadlineDateLabel(d.date)}`;
	const days = calendarDays(nowMs, dueMs);
	const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days > TODAY_DAYS ? longDay(d.date) : new Date(dueMs).toLocaleDateString("en-US", { weekday: "long" });
	const at = d.time ? ` at ${clockLabel(d.time)}` : "";
	if (hasProblems(d.kind)) return `due ${day}${at}`;
	if (short) return `${day}${at}`;
	return `the ${EVENT_WORD[d.kind] ?? "test"} is ${days > 1 ? "on " : ""}${day}${at}`;
}

/** Where an unfinished Study session is: "Recursion is next", "in the
 *  middle of Recursion"; null when it says neither. */
function continueWords(next: ContinueStudy): string | null {
	if (next.stop?.next) return `${next.stop.next} is next`;
	return next.inTopic ? `in the middle of ${next.inTopic}` : null;
}

/** Its Study session reached its end today and today's plan has no
 *  topic left, as a moved deadline can give today a topic again. */
function nothingMoreToday(progress: DeadlineProgress | undefined, nowMs: number): boolean {
	return progress?.studyEndedToday === true && !planDays(localDay(nowMs), progress.date, progress.topics)[0]?.topics.length;
}

/** Home's card: what to do as its title, the one line under it, how far
 *  (its chip) and its main key. */
interface CardWords {
	title: string;
	/** "CSE 21, Thursday at 7:00 PM. 3 topics left today." */
	line: string;
	/** "40% ready", "2 of 7 problems done"; null with nothing to count. */
	ready: string | null;
	/** "Work on it" works on the assignment's problems; the others study
	 *  ("Continue" reopens an unfinished session). Null once it is done. */
	button: "Study" | "Continue" | "Work on it" | null;
}

const sentence = (words: string) => `${words[0]!.toUpperCase()}${words.slice(1)}.`;

/** The card's words. Homework and projects say how far they are; a test
 *  or quiz says where its Study session stopped, the topic it is in the
 *  middle of, how many topics are left today, or that nothing more is
 *  planned today. One ticked done says only its space and when. */
export function nextCard(d: OpenDeadline, progress: DeadlineProgress | undefined, nowMs: number): CardWords {
	const when = `${d.spaceName}, ${dueWords(d, nowMs, true)}`;
	if (d.done) return { title: d.name, line: when, ready: null, button: null };
	const ready = (progress && progressWords(progress)) ?? null;
	if (hasProblems(d.kind)) return { title: d.name, line: when, ready, button: "Work on it" };
	const next = progress?.continueStudy;
	const where = next && continueWords(next);
	const topics = progress ? (planDays(localDay(nowMs), progress.date, progress.topics)[0]?.topics.length ?? 0) : 0;
	const left = where ? sentence(where) : topics > 0 ? `${topics} ${topics === 1 ? "topic" : "topics"} left today.` : nothingMoreToday(progress, nowMs) ? nothingMorePlannedLine() : null;
	return { title: d.name, line: left ? `${when}. ${left}` : when, ready, button: next ? "Continue" : "Study" };
}

/** What Home says in place of the week when there is no deadline at all. */
export function homeEmpty(lists: HomeLists, teacher: string): string | null {
	return lists.today.length + lists.done.length + lists.later.length > 0 ? null : `None yet. ${teacher} can add them from your files.`;
}

/** The deadline the card shows: the one picked in the week or Later while
 *  it is still there (open or ticked done today), else mainRowId's. */
export function shownCard(lists: HomeLists, picked: string | null, mainId: string | null): OpenDeadline | null {
	const all = [...lists.today, ...lists.done, ...lists.later];
	const find = (id: string | null) => (id === null ? undefined : all.find((d) => d.id === id));
	return find(picked) ?? find(mainId) ?? null;
}

/** The row Home's card holds, with the page's one main button: a session
 *  stopped before today, else the soonest row. A session that stopped today, or
 *  ended today with nothing more planned, is passed over, so with no other
 *  row there is no card. `deadlines` are soonest first. */
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
