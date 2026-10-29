/**
 * Class contracts.
 *
 * A class is a university course the learner is taking. Each class owns:
 *  - its lessons (ChatRecord.classId),
 *  - its OWN knowledge graph (data/classes/<id>/graph; reads may cross
 *    classes, writes never do),
 *  - its files: copied into data/classes/<id>/files, or found in a linked
 *    folder on the learner's computer,
 *  - a free-text description the learner writes.
 *
 * Lessons with no class use the shared graph (data/graph) — the
 * "No class" space (classes are optional).
 *
 * Pure types + tiny pure helpers.
 */

/** "study" files are turned into graph facts by the extraction pipeline;
 *  "info" files (syllabus, assignments) are never extracted — the teacher
 *  can only read them. */
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

/** Most files a linked folder may contribute (a guard against linking a
 *  whole home directory by mistake). */
export const MAX_LINKED_FILES = 500;

/** What is wrong with a class's linked folder at its last scan:
 *  "missing" = not found (moved, renamed, drive unplugged);
 *  "too-many-files" = only the first MAX_LINKED_FILES were added. */
export type FolderProblem = "missing" | "too-many-files";

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
	 *  rebuilt automatically. */
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

export type SignatureKind = "math" | "code" | "text";

const SIGNATURE_KINDS: readonly SignatureKind[] = ["math", "code", "text"];

/** The class's signature: one line that sums up the course, set huge and
 *  dim on its Overview cover. "math" is LaTeX (no `$`), "code" a line of
 *  code, "text" anything else (a quote, a sequence, a date). */
export interface ClassSignature {
	kind: SignatureKind;
	value: string;
}

/** Longest signature, in characters (one line on the cover). */
export const SIGNATURE_MAX = 60;

/** Halley's note on the cover: the teacher's two sentences on where the
 *  learner stands in the class and what's next (set_class_note). */
export interface ClassNote {
	text: string;
	/** ISO time it was written. */
	at: string;
}

/** Longest note, in characters. */
export const NOTE_MAX = 280;

function isSignatureKind(kind: unknown): kind is SignatureKind {
	return typeof kind === "string" && (SIGNATURE_KINDS as readonly string[]).includes(kind);
}

/** A signature as given (by an agent or the Edit class dialog), cleaned:
 *  one line, trimmed. Null when the kind is unknown, the value is empty
 *  or longer than SIGNATURE_MAX. */
export function cleanSignature(raw: { kind?: unknown; value?: unknown }): ClassSignature | null {
	if (!isSignatureKind(raw.kind) || typeof raw.value !== "string") return null;
	const value = raw.value.replace(/\s+/g, " ").trim();
	return value && value.length <= SIGNATURE_MAX ? { kind: raw.kind, value } : null;
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
	/** Hidden from the switcher, kept on disk. */
	archived: boolean;
	/** Absolute path of a folder on the learner's computer (optional). */
	linkedFolder?: string;
	files: ClassFile[];
	/** The class's deadlines, soonest due first (absent on records that
	 *  never had one — absence reads as none). */
	deadlines?: ClassDeadline[];
	signature?: ClassSignature;
	note?: ClassNote;
	/** The learner's rules for lessons in this class (absent = none). */
	rules?: string[];
	/** Schema stamp — same lazy-v1 / honest-refusal contract as chats. */
	version?: number;
}

/** The class record format this build writes and understands.
 *  v2: adds `exams`. A v1 record reads unchanged; the bump
 *  makes an older build REFUSE a v2 record rather than drop its exams on
 *  its next write (its reader rebuilds the record field by field).
 *  v3: exams become deadlines (`deadlines`; a v2 record's
 *  `exams` read as deadlines of kind "exam").
 *  v4: adds `signature` and `note`.
 *  v5: adds `rules`. */
export const CURRENT_CLASS_VERSION = 5;

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
	signature?: ClassSignature;
	note?: ClassNote;
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

/** File types the pipeline can turn into text. */
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
