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
type ClassFileOrigin = "copied" | "linked";

/** A file's pipeline state, shown as a badge.
 *  - pending: waiting for its turn (or a course-info file: nothing to do)
 *  - extracting: being turned into facts
 *  - ready: facts are in the class graph (or, for info files, readable)
 *  - failed: the last attempt failed (see `error`)
 *  - needs-whisper: a recording, but whisper.cpp/ffmpeg are not installed */
export type ClassFileStatus = "pending" | "extracting" | "ready" | "failed" | "needs-whisper";

/** Installs the speech tool recordings need (whisper.cpp and ffmpeg). */
export const SPEECH_TOOL_INSTALL = "brew install whisper-cpp ffmpeg";

/** Most files a linked folder may contribute (a guard against linking a
 *  whole home directory by mistake). */
export const MAX_LINKED_FILES = 500;

/** What is wrong with a class's linked folder at its last scan:
 *  "missing" = not found (moved, renamed, drive unplugged);
 *  "not-responding" = there, but reading it timed out (Google Drive paused
 *  or offline), so nothing is taken as deleted;
 *  "empty" = there but showing no files (a synced folder starting up),
 *  so nothing is taken as deleted;
 *  "too-many-files" = only the first MAX_LINKED_FILES were added. */
export type FolderProblem = "missing" | "not-responding" | "empty" | "too-many-files";

/** A class's linked folder as its last scan saw it. */
export interface FolderStatus {
	problem: FolderProblem | null;
	/** When a scan last read the folder through (null: not since launch). */
	checkedAt: string | null;
	/** New files not added yet because they are still changing (downloading). */
	settling: number;
	/** Files in the folder that can't be read (absent when none). */
	skipped?: SkippedFiles;
}

/** A linked folder's files that can't be read: how many, a few names, and
 *  how many are Google Docs/Sheets/Slides links (their text is online). */
export interface SkippedFiles {
	count: number;
	examples: string[];
	google: number;
}

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
	/** Found by a later scan of its linked folder (not linked with the
	 *  folder, nor added by hand): shown as new for a few days. */
	foundByScan?: true;
	/** Its kind was picked by hand (the kind menu, or the agent's
	 *  set_class_file_kind): godspeed never sorts it by itself. Files added
	 *  by hand pick their kind when added, so only linked files are sorted. */
	kindChosen?: true;
	/** The agent's read found course logistics, so godspeed switched this
	 *  linked file to course info by itself. */
	sortedAsInfo?: true;
	/** A recording whose lecture transcript is already in the class: that
	 *  file's id. It is not transcribed and has no facts of its own. */
	transcriptId?: string;
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
	/** Files it doesn't cover, on purpose (Leave out, or the agent), so the
	 *  "before it, not on it" check stays quiet about them. */
	leftOutIds?: string[];
	/** Where the agent found what it covers ("2026-11-04 Midterm (practice exam).pdf"). */
	source?: string;
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

/** The subject icons a class can wear (lucide names), with the subject
 *  each stands for. A class without one shows "book-open". */
export const CLASS_ICONS = {
	cpu: "Computer science",
	code: "Programming",
	sigma: "Math",
	"chart-line": "Statistics",
	atom: "Physics",
	"flask-conical": "Chemistry",
	dna: "Biology",
	brain: "Psychology",
	landmark: "History",
	scale: "Law and politics",
	"trending-up": "Economics",
	globe: "Geography",
	languages: "Languages",
	"book-open": "Literature",
	palette: "Art",
	music: "Music",
} as const;

export type ClassIcon = keyof typeof CLASS_ICONS;

export function isClassIcon(name: unknown): name is ClassIcon {
	return typeof name === "string" && Object.hasOwn(CLASS_ICONS, name);
}

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
	icon?: ClassIcon;
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
		public readonly code: "bad_name" | "bad_kind" | "bad_date" | "bad_time" | "bad_source" | "unknown_file" | "deadline_not_found",
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
	/** When the newest file a folder scan found arrived. */
	lastFoundAt?: string;
	signature?: ClassSignature;
	icon?: ClassIcon;
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

/** File types the pipeline can turn into text. Plain text and code are
 *  read as they are; documents (PDF, Word, PowerPoint) have their text
 *  pulled out and saved. A file with no extension is read as plain text
 *  when its bytes are text (the server checks). */
const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"] as const;
const CODE_EXTENSIONS = [
	".c", ".h", ".cpp", ".cc", ".hpp", ".py", ".java", ".js", ".jsx", ".ts", ".tsx", ".go", ".rs",
	".rb", ".swift", ".kt", ".cs", ".sql", ".sh", ".r", ".scala", ".hs", ".lua", ".php",
] as const;
const OFFICE_EXTENSIONS = [".docx", ".pptx"] as const;
export const DOCUMENT_EXTENSIONS = [".pdf", ...OFFICE_EXTENSIONS] as const;
const TRANSCRIPT_EXTENSIONS = [".vtt", ".srt"] as const;
const RECORDING_EXTENSIONS = [".mp3", ".m4a", ".wav", ".mp4", ".mov"] as const;

/** Read as UTF-8 text, as they are. */
export const PLAIN_TEXT_EXTENSIONS: readonly string[] = [...TEXT_EXTENSIONS, ...CODE_EXTENSIONS];

/** Every supported extension, for lists people and agents read. */
export const SUPPORTED_CLASS_FILE_EXTENSIONS: readonly string[] = [
	...PLAIN_TEXT_EXTENSIONS,
	...DOCUMENT_EXTENSIONS,
	...TRANSCRIPT_EXTENSIONS,
	...RECORDING_EXTENSIONS,
];

/** Lower-cased extension including the dot ("" when none). A dot followed
 *  by words and spaces ("cse29.site, Piazza feed (captured …)") is part of
 *  the name, not an extension. */
export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
	if (dot <= slash) return "";
	const ext = name.slice(dot).toLowerCase();
	return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

/** A filename safe to store (no folders, no control chars). */
export function safeName(name: string): string {
	const base = (name.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "").replace(/[\u0000-\u001f]/g, "").trim();
	return base.length > 0 && base !== "." && base !== ".." ? base.slice(0, 200) : "file";
}

export function isSupportedClassFile(name: string): boolean {
	return SUPPORTED_CLASS_FILE_EXTENSIONS.includes(extensionOf(name));
}

export function isCodeFile(name: string): boolean {
	return (CODE_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

export function isRecordingFile(name: string): boolean {
	return (RECORDING_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

/** Captions (.srt / .vtt), read with their times. */
export function isTranscriptFile(name: string): boolean {
	return (TRANSCRIPT_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

export function isOfficeFile(name: string): boolean {
	return (OFFICE_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

/** The lecture-audio side of a lecture: captions or a recording. */
export function isRecordingOrCaptions(name: string): boolean {
	return isRecordingFile(name) || isTranscriptFile(name);
}

/** The error of a file that is gone from its place. */
export const FILE_NOT_FOUND = "The file could not be found";
