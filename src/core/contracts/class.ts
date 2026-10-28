/**
 * Class contracts (classes wave, owner-approved 2026-10-26).
 *
 * A class is a university course the learner is taking. Each class owns:
 *  - its lessons (ChatRecord.classId),
 *  - its OWN knowledge graph (data/classes/<id>/graph — owner ruling:
 *    separate graph per class; reads may cross classes, writes never do),
 *  - its files: copied into data/classes/<id>/files, or found in a linked
 *    folder on the learner's computer,
 *  - a free-text description the learner writes.
 *
 * Lessons with no class keep using today's graph (data/graph) — the
 * "No class" space (owner ruling: classes are optional; no migration).
 *
 * Pure types + tiny pure helpers.
 */

/** "study" files are turned into graph facts by the extraction pipeline;
 *  "info" files (syllabus, assignments) are never extracted — the teacher
 *  can only read them (owner ruling 2026-10-26: per-file choice). */
export type ClassFileKind = "study" | "info";

/** Where a class file lives: "copied" = the app's own copy under
 *  data/classes/<id>/files; "linked" = inside the class's linked folder
 *  (the learner's own folder, never written to). */
export type ClassFileOrigin = "copied" | "linked";

/** A file's pipeline state, shown as a badge.
 *  - pending: waiting for its turn (or a course-info file: nothing to do)
 *  - extracting: being turned into facts
 *  - ready: facts are in the class graph (or, for info files, readable)
 *  - failed: the last attempt failed (see `error`)
 *  - needs-whisper: a recording, but whisper.cpp/ffmpeg are not installed */
export type ClassFileStatus = "pending" | "extracting" | "ready" | "failed" | "needs-whisper";

export interface ClassFile {
	/** Stable id: "f_" + 12 hex. */
	id: string;
	origin: ClassFileOrigin;
	/** Display name (the file's basename). */
	name: string;
	/** "copied": path relative to data/classes/<id>/files.
	 *  "linked": path relative to the class's linkedFolder. */
	path: string;
	kind: ClassFileKind;
	/** sha256 (hex, 16 chars) of the file's bytes when last processed —
	 *  a different fingerprint means the file changed and its facts are
	 *  rebuilt (owner ruling: rebuild automatically). */
	contentFp: string;
	/** Cheap change pre-check for linked files: "<mtimeMs>:<size>" at the
	 *  last fingerprint (the 60 s folder scan only re-hashes on a change). */
	statSig?: string;
	/** The notes-source id its facts were born under in the class graph
	 *  (study files only). */
	sourceId?: string;
	status: ClassFileStatus;
	error?: string;
	addedAt: string;
}

/** What a deadline is (plan 2026-10-28: exams become general deadlines). */
export type DeadlineKind = "exam" | "homework" | "quiz" | "project";

const DEADLINE_KINDS: readonly DeadlineKind[] = ["exam", "homework", "quiz", "project"];

/** One deadline of a class: added by the learner (Edit class) or by an
 *  outside agent from the syllabus (MCP add_class_deadline). Its topics are
 *  the topics with facts born in its files. */
export interface ClassDeadline {
	/** "ddl_" + 12 hex. Deadlines upgraded from v2 exams keep their "exm_" id. */
	id: string;
	kind: DeadlineKind;
	/** "Midterm 1", "Homework 5". */
	name: string;
	/** The due day, YYYY-MM-DD (local wall clock, no time zone). */
	date: string;
	/** "HH:MM" 24h local wall clock. Absent = no time (due 23:59 that day). */
	time?: string;
	/** The class files (ClassFile.id) it covers. */
	fileIds: string[];
	done: boolean;
	/** ISO time it was ticked done. */
	doneAt?: string;
}

export interface ClassRecord {
	/** "cls_" + base36 time + "_" + 8 hex. */
	id: string;
	name: string;
	/** The learner's own words about the class: level, notation, textbook,
	 *  what exams look like. Shown to the teacher on the class card. */
	description: string;
	createdAt: string;
	updatedAt: string;
	/** Hidden from the switcher, kept on disk (owner ruling: archive + delete). */
	archived: boolean;
	/** Absolute path of a folder on the learner's computer (optional). */
	linkedFolder?: string;
	files: ClassFile[];
	/** The class's deadlines, soonest due first (absent on records that
	 *  never had one — absence reads as none). */
	deadlines?: ClassDeadline[];
	/** Schema stamp — same lazy-v1 / honest-refusal contract as chats. */
	version?: number;
}

/** The class record format this build writes and understands.
 *  v2 (2026-10-27): adds `exams`. A v1 record reads unchanged; the bump
 *  makes an older build REFUSE a v2 record rather than drop its exams on
 *  its next write (its reader rebuilds the record field by field).
 *  v3 (2026-10-28): exams become deadlines (`deadlines`; a v2 record's
 *  `exams` read as deadlines of kind "exam"). */
export const CURRENT_CLASS_VERSION = 3;

/** Why a deadline write was refused (the store's validation; the server
 *  maps it to a 400 / 404 with this message). */
export class ClassDeadlineError extends Error {
	constructor(
		public readonly code: "bad_name" | "bad_kind" | "bad_date" | "bad_time" | "unknown_file" | "deadline_not_found",
		message: string,
	) {
		super(message);
		this.name = "ClassDeadlineError";
	}
}

/** True when `date` is a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(date: unknown): date is string {
	if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const [y, m, d] = date.split("-").map(Number) as [number, number, number];
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** True when `time` is a 24h clock time written HH:MM (00:00–23:59). */
export function isClockTime(time: unknown): time is string {
	return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export function isDeadlineKind(kind: unknown): kind is DeadlineKind {
	return typeof kind === "string" && (DEADLINE_KINDS as readonly string[]).includes(kind);
}

/** When a deadline is due: its day and time, with no time meaning 23:59. */
export function deadlineDueAt(d: { date: string; time?: string }): { date: string; time: string } {
	return { date: d.date, time: d.time ?? "23:59" };
}

/** Sort order for deadlines: due date, then due time (none = 23:59),
 *  then name. */
export function compareDeadlines(a: { date: string; time?: string; name: string }, b: { date: string; time?: string; name: string }): number {
	const da = deadlineDueAt(a);
	const db = deadlineDueAt(b);
	return da.date.localeCompare(db.date) || da.time.localeCompare(db.time) || a.name.localeCompare(b.name);
}

/** The list view: the record minus its file list, plus counts. */
export interface ClassSummary {
	id: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
	archived: boolean;
	linkedFolder?: string;
	fileCount: number;
}

/** The "No class" space's wire name (query strings, MCP inputs). */
const NO_CLASS = "none";

/** A class-scope value as the server sees it: a class id, or null for
 *  "No class". */
export type ClassScope = string | null;

const CLASS_ID = /^cls_[A-Za-z0-9_-]+$/;

/** True when `id` looks like a class id (path-safe). */
export function isClassId(id: unknown): id is string {
	return typeof id === "string" && CLASS_ID.test(id);
}

/** Parse a wire class value ("none" / absent / a class id) into a scope.
 *  Returns undefined when the value is malformed. */
export function parseClassScope(raw: string | null | undefined): ClassScope | undefined {
	if (raw === null || raw === undefined || raw === "" || raw === NO_CLASS) return null;
	return isClassId(raw) ? raw : undefined;
}

/** File types the pipeline can turn into text (Phase 3 + recordings). */
export const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"] as const;
export const DOCUMENT_EXTENSIONS = [".pdf"] as const;
export const TRANSCRIPT_EXTENSIONS = [".vtt", ".srt"] as const;
const RECORDING_EXTENSIONS = [".mp3", ".m4a", ".wav", ".mp4", ".mov"] as const;

const SUPPORTED_CLASS_FILE_EXTENSIONS: readonly string[] = [
	...TEXT_EXTENSIONS,
	...DOCUMENT_EXTENSIONS,
	...TRANSCRIPT_EXTENSIONS,
	...RECORDING_EXTENSIONS,
];

/** Lower-cased extension including the dot ("" when none). */
export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
	return dot > slash ? name.slice(dot).toLowerCase() : "";
}

export function isSupportedClassFile(name: string): boolean {
	return SUPPORTED_CLASS_FILE_EXTENSIONS.includes(extensionOf(name));
}

export function isRecordingFile(name: string): boolean {
	return (RECORDING_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}
