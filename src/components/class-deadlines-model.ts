/**
 * The Edit class dialog's deadline drafts (plan 2026-10-28; exams before
 * that). The dialog edits a copy of the class's deadlines; Save turns the
 * differences into the deadline routes' writes (POST new, PUT changed,
 * DELETE removed). Pure and unit-tested.
 */
import { isCalendarDate, isClockTime, type ClassDeadline, type DeadlineKind } from "@/core";

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

export interface DeadlineAddBody {
	kind: DeadlineKind;
	name: string;
	date: string;
	time?: string;
	fileIds: string[];
}

export interface DeadlineUpdateBody {
	kind?: DeadlineKind;
	name?: string;
	date?: string;
	/** null clears the time. */
	time?: string | null;
	fileIds?: string[];
	done?: boolean;
}

export type DeadlineWrite =
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

/** The writes that make `saved` match `drafts` (removals first, so a
 *  replaced deadline never collides). Unchanged deadlines write nothing. */
export function deadlineWrites(saved: readonly ClassDeadline[] | undefined, drafts: readonly DeadlineDraft[]): DeadlineWrite[] {
	const before = new Map((saved ?? []).map((d) => [d.id, d]));
	const kept = new Set(drafts.flatMap((d) => (d.id ? [d.id] : [])));
	const writes: DeadlineWrite[] = [];
	for (const d of saved ?? []) if (!kept.has(d.id)) writes.push({ op: "remove", id: d.id });
	for (const d of drafts) {
		const name = d.name.trim();
		const prev = d.id ? before.get(d.id) : undefined;
		if (!d.id || !prev) {
			const body: DeadlineAddBody = { kind: d.kind, name, date: d.date, ...(d.time !== "" ? { time: d.time } : {}), fileIds: [...d.fileIds] };
			writes.push({ op: "add", key: d.key, body, done: d.done });
			continue;
		}
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

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-29" → "Thu Oct 29" (a calendar date: no time zone shifts);
 *  "" for anything else. */
export function deadlineDateLabel(date: string): string {
	if (!isCalendarDate(date)) return "";
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return `${WEEKDAY[day]} ${MONTH[m - 1]} ${d}`;
}

/** "23:59" → "11:59 PM", "00:05" → "12:05 AM"; "" for anything else. */
export function clockLabel(time: string): string {
	if (!isClockTime(time)) return "";
	const [h, m] = time.split(":").map(Number) as [number, number];
	return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
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
