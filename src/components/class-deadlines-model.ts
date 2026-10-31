/**
 * The Edit class dialog's drafts. The dialog edits a copy of the class's
 * fields and deadlines; Save turns the differences from that copy into
 * writes (POST new, PUT changed, DELETE removed), so an agent's change
 * made while the dialog is open is never undone. Pure and unit-tested.
 */
import { clockLabel as coreClockLabel, dayLabel, isCalendarDate, isClockTime, type ClassDeadline, type DeadlineKind } from "@/core";

export interface DeadlineDraft {
	/** Stable React key: the deadline id, or "new-<n>" before its first save. */
	key: string;
	/** The saved deadline's id; absent until it is created. */
	id?: string;
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

export function draftsFrom(deadlines: readonly ClassDeadline[] | undefined): DeadlineDraft[] {
	return (deadlines ?? []).map((d) => ({
		key: d.id,
		id: d.id,
		kind: d.kind,
		name: d.name,
		date: d.date,
		time: d.time ?? "",
		fileIds: [...d.fileIds],
		done: d.done,
	}));
}

/** The first draft that can't be saved, as a message; null when all can. */
export function draftProblem(drafts: readonly DeadlineDraft[]): string | null {
	for (const d of drafts) {
		if (d.name.trim() === "") return "Each deadline needs a name.";
		if (!isCalendarDate(d.date)) return `${d.name.trim()} needs a date.`;
		if (d.time !== "" && !isClockTime(d.time)) return `${d.name.trim()} needs a time like 23:59, or no time.`;
	}
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

type DeadlineWrite =
	/** `done`: the new deadline was ticked before its first save (POST
	 *  never takes done, so the dialog follows up with a PUT). */
	| { op: "add"; key: string; body: DeadlineAddBody; done: boolean }
	| { op: "update"; key: string; id: string; body: DeadlineUpdateBody }
	| { op: "remove"; id: string };

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

/** The writes that make `saved` (the deadlines the drafts came from) match
 *  `drafts` (removals first, so a replaced deadline never collides).
 *  Unchanged deadlines write nothing. Only drafts with no id are added: a
 *  draft whose deadline is gone from `saved` was removed elsewhere and is
 *  never added back as new. */
export function deadlineWrites(saved: readonly ClassDeadline[] | undefined, drafts: readonly DeadlineDraft[]): DeadlineWrite[] {
	const before = new Map((saved ?? []).map((d) => [d.id, d]));
	const kept = new Set(drafts.flatMap((d) => (d.id ? [d.id] : [])));
	const writes: DeadlineWrite[] = [];
	for (const d of saved ?? []) if (!kept.has(d.id)) writes.push({ op: "remove", id: d.id });
	for (const d of drafts) {
		const name = d.name.trim();
		if (!d.id) {
			const body: DeadlineAddBody = { kind: d.kind, name, date: d.date, ...(d.time !== "" ? { time: d.time } : {}), fileIds: [...d.fileIds] };
			writes.push({ op: "add", key: d.key, body, done: d.done });
			continue;
		}
		const prev = before.get(d.id);
		if (!prev) continue;
		const body: DeadlineUpdateBody = {};
		if (d.kind !== prev.kind) body.kind = d.kind;
		if (name !== prev.name) body.name = name;
		if (d.date !== prev.date) body.date = d.date;
		if (d.time !== (prev.time ?? "")) body.time = d.time === "" ? null : d.time;
		if (!sameIds(d.fileIds, prev.fileIds)) body.fileIds = [...d.fileIds];
		if (d.done !== prev.done) body.done = d.done;
		if (Object.keys(body).length > 0) writes.push({ op: "update", key: d.key, id: d.id, body });
	}
	return writes;
}

/** A draft's fields as one comparable string. */
function draftValue(d: DeadlineDraft): string {
	return JSON.stringify([d.kind, d.name, d.date, d.time, [...d.fileIds].sort(), d.done]);
}

/**
 * Deadlines removed elsewhere (by an agent) while the dialog is open
 * (`removed`: ids the server listed before and no longer does): the drafts
 * the learner didn't edit leave the drafts and the seeded copy. Edited ones
 * stay; their Save says the deadline is gone. Null when nothing changes.
 */
export function dropRemoved(
	seeded: readonly ClassDeadline[],
	drafts: readonly DeadlineDraft[],
	removed: ReadonlySet<string>,
): { seeded: ClassDeadline[]; drafts: DeadlineDraft[] } | null {
	const gone = new Set<string>();
	for (const seed of seeded) {
		if (!removed.has(seed.id)) continue;
		const draft = drafts.find((d) => d.id === seed.id);
		if (!draft || draftValue(draft) === draftValue(draftsFrom([seed])[0]!)) gone.add(seed.id);
	}
	if (gone.size === 0) return null;
	return { seeded: seeded.filter((d) => !gone.has(d.id)), drafts: drafts.filter((d) => !d.id || !gone.has(d.id)) };
}

/** A new deadline row nobody has filled in yet (Home's Add deadline opens one). */
function blankDraft(d: DeadlineDraft): boolean {
	return !d.id && d.name.trim() === "" && d.date === "" && d.time === "" && d.fileIds.length === 0 && !d.done;
}

/** The learner changed something since the dialog opened: a field or a
 *  deadline (an untouched blank new row doesn't count). */
export function hasUnsavedChanges<T extends object>(
	seeded: { fields: T; deadlines: readonly ClassDeadline[] },
	fields: T,
	drafts: readonly DeadlineDraft[],
): boolean {
	if (Object.keys(changedFields(seeded.fields, fields)).length > 0) return true;
	return deadlineWrites(seeded.deadlines, drafts.filter((d) => !blankDraft(d))).length > 0;
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

/** "1 file" / "3 files". */
export function filesLabel(n: number): string {
	return `${n} ${n === 1 ? "file" : "files"}`;
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
