/**
 * The Edit class dialog's exam drafts (redesign plan, Phase 6). The dialog
 * edits a copy of the class's exams; Save turns the differences into the
 * exam routes' writes (POST new, PUT changed, DELETE removed). Pure and
 * unit-tested.
 */
import { isExamDate, type ClassExam } from "@/core";

export interface ExamDraft {
	/** Stable React key: the exam id, or "new-<n>" before its first save. */
	key: string;
	/** The saved exam's id; absent until it is created. */
	id?: string;
	name: string;
	/** YYYY-MM-DD, or "" while unset. */
	date: string;
	fileIds: string[];
}

export function draftsFrom(exams: readonly ClassExam[] | undefined): ExamDraft[] {
	return (exams ?? []).map((e) => ({ key: e.id, id: e.id, name: e.name, date: e.date, fileIds: [...e.fileIds] }));
}

/** The first draft that can't be saved, as a message; null when all can. */
export function draftProblem(drafts: readonly ExamDraft[]): string | null {
	for (const d of drafts) {
		if (d.name.trim() === "") return "Each exam needs a name.";
		if (!isExamDate(d.date)) return `${d.name.trim()} needs a date.`;
	}
	return null;
}

export type ExamWrite =
	| { op: "add"; key: string; body: { name: string; date: string; fileIds: string[] } }
	| { op: "update"; key: string; id: string; body: { name?: string; date?: string; fileIds?: string[] } }
	| { op: "remove"; id: string };

function sameIds(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const set = new Set(a);
	return b.every((id) => set.has(id));
}

/** The writes that make `saved` match `drafts` (removals first, so a
 *  replaced exam never collides). Unchanged exams write nothing. */
export function examWrites(saved: readonly ClassExam[] | undefined, drafts: readonly ExamDraft[]): ExamWrite[] {
	const before = new Map((saved ?? []).map((e) => [e.id, e]));
	const kept = new Set(drafts.flatMap((d) => (d.id ? [d.id] : [])));
	const writes: ExamWrite[] = [];
	for (const e of saved ?? []) if (!kept.has(e.id)) writes.push({ op: "remove", id: e.id });
	for (const d of drafts) {
		const name = d.name.trim();
		const prev = d.id ? before.get(d.id) : undefined;
		if (!d.id || !prev) {
			writes.push({ op: "add", key: d.key, body: { name, date: d.date, fileIds: [...d.fileIds] } });
			continue;
		}
		const body: { name?: string; date?: string; fileIds?: string[] } = {};
		if (name !== prev.name) body.name = name;
		if (d.date !== prev.date) body.date = d.date;
		if (!sameIds(d.fileIds, prev.fileIds)) body.fileIds = [...d.fileIds];
		if (Object.keys(body).length > 0) writes.push({ op: "update", key: d.key, id: d.id, body });
	}
	return writes;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-29" → "Thu Oct 29" (a calendar date: no time zone shifts);
 *  "" for anything else. */
export function examDateLabel(date: string): string {
	if (!isExamDate(date)) return "";
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return `${WEEKDAY[day]} ${MONTH[m - 1]} ${d}`;
}

/** "1 file" / "3 files". */
export function filesLabel(n: number): string {
	return `${n} ${n === 1 ? "file" : "files"}`;
}

/** Toggle one file in an exam's list, keeping class file order. */
export function toggleFile(fileIds: readonly string[], fileId: string, classOrder: readonly string[]): string[] {
	const set = new Set(fileIds);
	if (set.has(fileId)) set.delete(fileId);
	else set.add(fileId);
	const ordered = classOrder.filter((id) => set.has(id));
	// Ids the class no longer lists stay as they were (the server decides).
	const rest = fileIds.filter((id) => set.has(id) && !classOrder.includes(id));
	return [...ordered, ...rest];
}
