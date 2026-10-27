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
	/** Schema stamp — same lazy-v1 / honest-refusal contract as chats. */
	version?: number;
}

/** The class record format this build writes and understands. */
export const CURRENT_CLASS_VERSION = 1;

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
export const NO_CLASS = "none";

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
export const RECORDING_EXTENSIONS = [".mp3", ".m4a", ".wav", ".mp4", ".mov"] as const;

export const SUPPORTED_CLASS_FILE_EXTENSIONS: readonly string[] = [
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
