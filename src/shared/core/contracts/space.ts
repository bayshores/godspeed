/**
 * Space contracts.
 *
 * A space is one thing the learner is studying (a university course, a certification, a language). Each space owns:
 *  - its lessons (ChatRecord.spaceId),
 *  - its OWN knowledge graph (data/spaces/<id>/graph; reads may cross
 *    spaces, writes never do),
 *  - its files: copied into data/spaces/<id>/files, or found in a linked
 *    folder on the learner's computer,
 *  - a free-text description the learner writes.
 *
 * Lessons with no space use the shared graph (data/graph) — the
 * "No space" space (spaces are optional).
 *
 * Pure types + tiny pure helpers.
 */

/** "study" files are turned into graph facts by the extraction pipeline;
 *  "info" files (syllabus, assignments) are never extracted — the teacher
 *  can only read them. */
export type SpaceFileKind = "study" | "info";

/** Where a space file lives: "copied" = the app's own copy under
 *  data/spaces/<id>/files; "linked" = inside the space's linked folder
 *  (the learner's own folder, never written to). */
type SpaceFileOrigin = "copied" | "linked";

/** A file's pipeline state, shown as a badge.
 *  - pending: waiting for its turn (or a space-info file: nothing to do)
 *  - extracting: being turned into facts
 *  - ready: facts are in the space graph (or, for info files, readable)
 *  - failed: the last attempt failed (see `error`)
 *  - needs-whisper: a recording, but whisper.cpp/ffmpeg are not installed */
export type SpaceFileStatus = "pending" | "extracting" | "ready" | "failed" | "needs-whisper";

/** Installs the speech tool recordings need (whisper.cpp and ffmpeg). */
export const SPEECH_TOOL_INSTALL = "brew install whisper-cpp ffmpeg";

/** Most files a linked folder may contribute (a guard against linking a
 *  whole home directory by mistake). */
export const MAX_LINKED_FILES = 500;

/** What is wrong with a space's linked folder at its last scan:
 *  "missing" = not found (moved, renamed, drive unplugged);
 *  "not-responding" = there, but reading it timed out (Google Drive paused
 *  or offline), so nothing is taken as deleted;
 *  "empty" = there but showing no files (a synced folder starting up),
 *  so nothing is taken as deleted;
 *  "too-many-files" = only the first MAX_LINKED_FILES were added. */
export type FolderProblem = "missing" | "not-responding" | "empty" | "too-many-files";

/** A space's linked folder as its last scan saw it. */
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

export interface SpaceFile {
	/** Stable id: "f_" + 12 hex. */
	id: string;
	origin: SpaceFileOrigin;
	/** Display name (the file's basename). */
	name: string;
	/** "copied": path relative to data/spaces/<id>/files.
	 *  "linked": path relative to the space's linkedFolder. */
	path: string;
	kind: SpaceFileKind;
	/** sha256 (hex, 16 chars) of the file's bytes when last processed —
	 *  a different fingerprint means the file changed and its facts are
	 *  rebuilt automatically. */
	contentFp: string;
	/** Cheap change pre-check for linked files: "<mtimeMs>:<size>" at the
	 *  last fingerprint (the 60 s folder scan only re-hashes on a change). */
	statSig?: string;
	/** The notes-source id its facts were born under in the space graph
	 *  (study files only). */
	sourceId?: string;
	status: SpaceFileStatus;
	error?: string;
	addedAt: string;
	/** Found by a later scan of its linked folder (not linked with the
	 *  folder, nor added by hand): shown as new for a few days. */
	foundByScan?: true;
	/** Its kind was picked by hand (the kind menu, or the agent's
	 *  set_space_file_kind): godspeed never sorts it by itself. Files added
	 *  by hand pick their kind when added, so only linked files are sorted. */
	kindChosen?: true;
	/** The agent's read found logistics, so godspeed switched this
	 *  linked file to space info by itself. */
	sortedAsInfo?: true;
	/** A recording whose lecture transcript is already in the space: that
	 *  file's id. It is not transcribed and has no facts of its own. */
	transcriptId?: string;
}

/** A file that left the space (gone from its linked folder, or removed by
 *  hand), kept RECENT_CHANGE_DAYS for the Files page's Recent changes. */
export interface RemovedFile {
	/** The id it had. */
	id: string;
	name: string;
	/** ISO time it left. */
	at: string;
}

export type DeadlineKind = "exam" | "homework" | "quiz" | "project";

const DEADLINE_KINDS: readonly DeadlineKind[] = ["exam", "homework", "quiz", "project"];

/** One deadline of a space: added by the learner (Edit space) or by an
 *  outside agent from the syllabus (MCP add_space_deadline). Its topics are
 *  the topics with facts born in its files. */
export interface SpaceDeadline {
	/** "ddl_" + 12 hex. Deadlines upgraded from v2 exams keep their "exm_" id. */
	id: string;
	kind: DeadlineKind;
	/** "Midterm 1", "Homework 5". */
	name: string;
	/** The due day, YYYY-MM-DD (local wall clock, no time zone). */
	date: string;
	/** "HH:MM" 24h local wall clock. Absent = no time (due 23:59 that day). */
	time?: string;
	/** The space files (SpaceFile.id) it covers. */
	fileIds: string[];
	/** Files it doesn't cover, on purpose (Leave out, or the agent), so the
	 *  "before it, not on it" check stays quiet about them. */
	leftOutIds?: string[];
	/** Where the agent found what it covers ("2026-11-04 Midterm (practice exam).pdf"). */
	source?: string;
	/** The assignment itself (homework, project): the space file it is in. */
	assignmentFileId?: string;
	/** The assignment's problems, as the agent read them from its file. */
	problems?: HomeworkProblem[];
	done: boolean;
	/** ISO time it was ticked done. */
	doneAt?: string;
}

/** One problem of an assignment. The learner works on it in a homework
 *  session; it is done once the teacher marks the learner's work right. */
export interface HomeworkProblem {
	/** As the assignment numbers it ("Q1", "2b"); unique in its deadline. */
	number: string;
	/** A few words: "Largest step that converges". */
	title: string;
	/** The full problem text (markdown + LaTeX). */
	text: string;
	/** The page of the assignment file it is on. */
	page?: number;
	done: boolean;
}

/** At most this many problems in one assignment. */
export const MAX_HOMEWORK_PROBLEMS = 60;

export type SignatureKind = "math" | "code" | "text";

const SIGNATURE_KINDS: readonly SignatureKind[] = ["math", "code", "text"];

/** The space's signature: one line that sums up the subject, set huge and
 *  dim on its Overview cover. "math" is LaTeX (no `$`), "code" a line of
 *  code, "text" anything else (a quote, a sequence, a date). */
export interface SpaceSignature {
	kind: SignatureKind;
	value: string;
}

/** Longest signature, in characters (one line on the cover). */
export const SIGNATURE_MAX = 60;

/** The subject icons a space can wear with the subject
 *  each stands for. A space without one shows "book-open". */
export const SPACE_ICONS = {
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

export type SpaceIcon = keyof typeof SPACE_ICONS;

export function isSpaceIcon(name: unknown): name is SpaceIcon {
	return typeof name === "string" && Object.hasOwn(SPACE_ICONS, name);
}

/** How many space colors there are (--lh-space-1 to --lh-space-8). */
const SPACE_COLOR_COUNT = 8;

/** A space's color: 1 to SPACE_COLOR_COUNT. */
export type SpaceColor = number;

export function isSpaceColor(color: unknown): color is SpaceColor {
	return typeof color === "number" && Number.isInteger(color) && color >= 1 && color <= SPACE_COLOR_COUNT;
}

/** The color a new space takes: the one the fewest spaces wear, lowest
 *  number first. */
export function nextSpaceColor(taken: readonly SpaceColor[]): SpaceColor {
	let best = 1;
	let fewest = Infinity;
	for (let color = 1; color <= SPACE_COLOR_COUNT; color++) {
		const uses = taken.filter((t) => t === color).length;
		if (uses < fewest) [best, fewest] = [color, uses];
	}
	return best;
}

/** Halley's note on the cover: the teacher's two sentences on where the
 *  learner stands in the space and what's next (set_space_note). */
export interface SpaceNote {
	text: string;
	/** ISO time it was written. */
	at: string;
}

/** Longest note, in characters. */
export const NOTE_MAX = 280;

function isSignatureKind(kind: unknown): kind is SignatureKind {
	return typeof kind === "string" && (SIGNATURE_KINDS as readonly string[]).includes(kind);
}

/** A signature as given (by an agent or the Edit space dialog), cleaned:
 *  one line, trimmed. Null when the kind is unknown, the value is empty
 *  or longer than SIGNATURE_MAX. */
export function cleanSignature(raw: { kind?: unknown; value?: unknown }): SpaceSignature | null {
	if (!isSignatureKind(raw.kind) || typeof raw.value !== "string") return null;
	const value = raw.value.replace(/\s+/g, " ").trim();
	return value && value.length <= SIGNATURE_MAX ? { kind: raw.kind, value } : null;
}

/** One round of the teacher reading a space's files: what it read and the
 *  deadlines added meanwhile. Open until `endedAt` is set. */
export interface SpaceWork {
	startedAt: string;
	endedAt?: string;
	/** Study files that finished in this round (read or failed), in order. */
	fileIds: string[];
	deadlineIds: string[];
}

export interface SpaceRecord {
	/** "spc_" + base36 time + "_" + 8 hex ("cls_" on a space made before the rename). */
	id: string;
	name: string;
	/** The learner's own words about the space: level, notation, textbook,
	 *  what exams look like. Shown to the teacher on the space card. */
	description: string;
	createdAt: string;
	updatedAt: string;
	/** Hidden from the switcher, kept on disk. */
	archived: boolean;
	/** Absolute path of a folder on the learner's computer (optional). */
	linkedFolder?: string;
	files: SpaceFile[];
	/** Files that left in the last RECENT_CHANGE_DAYS, oldest first (absent
	 *  when none). */
	removedFiles?: RemovedFile[];
	/** The space's deadlines, soonest due first (absent on records that
	 *  never had one — absence reads as none). */
	deadlines?: SpaceDeadline[];
	signature?: SpaceSignature;
	icon?: SpaceIcon;
	color: SpaceColor;
	note?: SpaceNote;
	/** The learner's rules for lessons in this space (absent = none). */
	rules?: string[];
	/** The teacher's newest round of work here (absent = none to show). */
	lastWork?: SpaceWork;
	/** Schema stamp — same lazy-v1 / honest-refusal contract as chats. */
	version?: number;
}

/** The space record format this build writes and understands.
 *  v2: adds `exams`. A v1 record reads unchanged; the bump
 *  makes an older build REFUSE a v2 record rather than drop its exams on
 *  its next write (its reader rebuilds the record field by field).
 *  v3: exams become deadlines (`deadlines`; a v2 record's
 *  `exams` read as deadlines of kind "exam").
 *  v4: adds `signature` and `note`.
 *  v5: adds `rules`.
 *  v6: adds `removedFiles`.
 *  v7: deadlines add `assignmentFileId` and `problems`.
 *  v8: adds `color`.
 *  v9: the record file is space.json (class.json before). */
export const CURRENT_SPACE_VERSION = 9;

/** Why a deadline write was refused (the store's validation; the server
 *  maps it to a 400 / 404 with this message). */
export class SpaceDeadlineError extends Error {
	constructor(
		public readonly code: "bad_name" | "bad_kind" | "bad_date" | "bad_time" | "bad_source" | "bad_problems" | "unknown_file" | "deadline_not_found",
		message: string,
	) {
		super(message);
		this.name = "SpaceDeadlineError";
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
export interface SpaceSummary {
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
	/** When the newest file from the linked folder arrived (or was linked). */
	lastFolderFileAt?: string;
	signature?: SpaceSignature;
	icon?: SpaceIcon;
	color: SpaceColor;
	note?: SpaceNote;
	/** Study files the teacher still has to read. */
	filesLeft: number;
	/** Those are the space's first files: it is being built. */
	building?: true;
}

/** The "No space" space's wire name (query strings, MCP inputs). */
const NO_SPACE = "none";

/** A space-scope value as the server sees it: a space id, or null for
 *  "No space". */
export type SpaceScope = string | null;

const SPACE_ID = /^(spc|cls)_[A-Za-z0-9_-]+$/;

/** True when `id` looks like a space id (path-safe). */
export function isSpaceId(id: unknown): id is string {
	return typeof id === "string" && SPACE_ID.test(id);
}

/** Parse a wire space value ("none" / absent / a space id) into a scope.
 *  Returns undefined when the value is malformed. */
export function parseSpaceScope(raw: string | null | undefined): SpaceScope | undefined {
	if (raw === null || raw === undefined || raw === "" || raw === NO_SPACE) return null;
	return isSpaceId(raw) ? raw : undefined;
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
export const SUPPORTED_SPACE_FILE_EXTENSIONS: readonly string[] = [
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

export function isSupportedSpaceFile(name: string): boolean {
	return SUPPORTED_SPACE_FILE_EXTENSIONS.includes(extensionOf(name));
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
