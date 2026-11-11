/**
 * A deadline as the Add / Edit deadline dialog holds it, and the words
 * deadlines are shown with. The dialog edits a copy; Save sends only what
 * differs from the deadline it opened with, so an agent's change made
 * meanwhile is never undone. Pure and unit-tested.
 */
import { clockLabel as coreClockLabel, dateInName, dayLabel, isCalendarDate, isClockTime, type ClassDeadline, type DeadlineKind } from "@/shared/core";

export interface DeadlineDraft {
	kind: DeadlineKind;
	name: string;
	/** YYYY-MM-DD, or "" while unset. */
	date: string;
	/** HH:MM, or "" for no time. */
	time: string;
	fileIds: string[];
	done: boolean;
}

/** The kind picker's choices, in order. */
export const KIND_OPTIONS: readonly { kind: DeadlineKind; label: string }[] = [
	{ kind: "exam", label: "Exam" },
	{ kind: "homework", label: "Homework" },
	{ kind: "quiz", label: "Quiz" },
	{ kind: "project", label: "Project" },
];

/** "homework" → "Homework". */
export function kindLabel(kind: DeadlineKind): string {
	return KIND_OPTIONS.find((o) => o.kind === kind)?.label ?? kind;
}

/** What "Add a deadline" opens with. */
export const NEW_DEADLINE: DeadlineDraft = { kind: "homework", name: "", date: "", time: "", fileIds: [], done: false };

export function draftFrom(d: ClassDeadline): DeadlineDraft {
	return { kind: d.kind, name: d.name, date: d.date, time: d.time ?? "", fileIds: [...d.fileIds], done: d.done };
}

/** Why the draft can't be saved, as a message; null when it can. */
export function draftProblem(d: DeadlineDraft): string | null {
	if (d.name.trim() === "") return "A deadline needs a name.";
	if (!isCalendarDate(d.date)) return "A deadline needs a date.";
	if (d.time !== "" && !isClockTime(d.time)) return "The time needs to look like 23:59, or be left empty.";
	return null;
}

interface DeadlineAddBody {
	kind: DeadlineKind;
	name: string;
	date: string;
	time?: string;
	fileIds: string[];
}

interface DeadlineUpdateBody {
	kind?: DeadlineKind;
	name?: string;
	date?: string;
	/** null clears the time. */
	time?: string | null;
	fileIds?: string[];
	done?: boolean;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const set = new Set(a);
	return b.every((id) => set.has(id));
}

/** The fields of `now` that differ from `seeded` (compared by value). */
export function changedFields<T extends object>(seeded: T, now: T): Partial<T> {
	const changed: Partial<T> = {};
	for (const key of Object.keys(now) as (keyof T)[]) {
		if (JSON.stringify(now[key]) !== JSON.stringify(seeded[key])) changed[key] = now[key];
	}
	return changed;
}

/** What POST sends for a new deadline. */
export function addBody(d: DeadlineDraft): DeadlineAddBody {
	return { kind: d.kind, name: d.name.trim(), date: d.date, ...(d.time !== "" ? { time: d.time } : {}), fileIds: [...d.fileIds] };
}

/** What PUT sends: only the fields that differ from the saved deadline
 *  (nothing changed: an empty body). */
export function updateBody(saved: ClassDeadline, d: DeadlineDraft): DeadlineUpdateBody {
	const name = d.name.trim();
	const body: DeadlineUpdateBody = {};
	if (d.kind !== saved.kind) body.kind = d.kind;
	if (name !== saved.name) body.name = name;
	if (d.date !== saved.date) body.date = d.date;
	if (d.time !== (saved.time ?? "")) body.time = d.time === "" ? null : d.time;
	if (!sameIds(d.fileIds, saved.fileIds)) body.fileIds = [...d.fileIds];
	if (d.done !== saved.done) body.done = d.done;
	return body;
}

/** The learner changed something since the dialog opened (`saved`: the
 *  deadline being edited, null for a new one). */
export function draftChanged(saved: ClassDeadline | null, d: DeadlineDraft): boolean {
	return saved ? Object.keys(updateBody(saved, d)).length > 0 : Object.keys(changedFields(NEW_DEADLINE, d)).length > 0;
}

/** "2026-10-29" → "Thu Oct 29" (a calendar date: no time zone shifts);
 *  "" for a draft's unfinished date. */
export function deadlineDateLabel(date: string): string {
	return isCalendarDate(date) ? dayLabel(date) : "";
}

/** "23:59" → "11:59 PM", "00:05" → "12:05 AM"; "" for a draft's unfinished time. */
export function clockLabel(time: string): string {
	return isClockTime(time) ? coreClockLabel(time) : "";
}

/** "Fri Oct 30, 11:59 PM", or "Fri Oct 30" with no time. */
export function dueLabel(date: string, time: string | undefined): string {
	const day = deadlineDateLabel(date);
	const clock = time ? clockLabel(time) : "";
	return day && clock ? `${day}, ${clock}` : day;
}

/** A file's class day from its name, "Oct 27"; "" for an undated file. */
export function fileDayLabel(name: string): string {
	const date = dateInName(name);
	return date ? dayLabel(date).split(" ").slice(1).join(" ") : "";
}

/** The deadline's file list shows a filter box from this many files. */
export const FILE_FILTER_FROM = 8;

/** The files whose name has every word of the filter in it (any case);
 *  a blank filter keeps them all. */
export function filterFiles<F extends { name: string }>(files: readonly F[], filter: string): readonly F[] {
	const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return files;
	return files.filter((f) => {
		const name = f.name.toLowerCase();
		return words.every((w) => name.includes(w));
	});
}

/** Toggle one file in a deadline's list, keeping class file order. */
export function toggleFile(fileIds: readonly string[], fileId: string, classOrder: readonly string[]): string[] {
	const set = new Set(fileIds);
	if (set.has(fileId)) set.delete(fileId);
	else set.add(fileId);
	const ordered = classOrder.filter((id) => set.has(id));
	// Ids the class no longer lists stay as they were (the server decides).
	const rest = fileIds.filter((id) => set.has(id) && !classOrder.includes(id));
	return [...ordered, ...rest];
}
