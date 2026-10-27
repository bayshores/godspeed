/**
 * The Files page's small pure helpers (redesign plan, Phase 6). Every
 * value comes from the class record (src/core/contracts/class.ts) and the
 * progress payload's file coverage (src/core/progress.ts); unit-tested on
 * their own.
 */
import type { ClassFile, FileCoverage } from "@/core";

/** Accepted by "Add files" (mirrors SUPPORTED_CLASS_FILE_EXTENSIONS). */
export const CLASS_FILE_ACCEPT = ".md,.markdown,.txt,.pdf,.vtt,.srt,.mp3,.m4a,.wav,.mp4,.mov";

/** A file row's element id — the Overview links to /class/files#file-<id>. */
export function fileAnchorId(fileId: string): string {
	return `file-${fileId}`;
}

/** The file id in a "#file-<id>" hash, or null. */
export function fileIdFromHash(hash: string): string | null {
	const m = /^#file-(.+)$/.exec(hash);
	if (!m) return null;
	try {
		return decodeURIComponent(m[1]!);
	} catch {
		return null;
	}
}

/** The class's files split into the page's two sections, class order kept. */
export function splitByKind(files: readonly ClassFile[]): { study: ClassFile[]; info: ClassFile[] } {
	const study: ClassFile[] = [];
	const info: ClassFile[] = [];
	for (const f of files) (f.kind === "info" ? info : study).push(f);
	return { study, info };
}

/** "/Users/me/School/CSE 21" → "~/School/CSE 21" (macOS and Linux home
 *  folders); any other path is shown as is. */
export function shortenHome(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** What a row shows between its name and the Study/Info toggle. */
export type FileState =
	| { kind: "coverage"; facts: number; inLessons: number; share: number | null }
	| { kind: "building" }
	| { kind: "waiting" }
	| { kind: "failed"; label: string; error?: string }
	| { kind: "none" };

/**
 * A row's state from its pipeline status and coverage:
 * - extracting → "Building facts…"
 * - pending study file → "Waiting" (a course-info file has nothing to do)
 * - failed / needs-whisper → red label + Retry
 * - ready study file → the coverage bar and its fact count (once the
 *   progress payload has it)
 * - ready course info → nothing
 */
export function fileState(file: ClassFile, coverage: FileCoverage | undefined): FileState {
	switch (file.status) {
		case "extracting":
			return { kind: "building" };
		case "pending":
			return file.kind === "study" ? { kind: "waiting" } : { kind: "none" };
		case "failed":
			return { kind: "failed", label: "Failed", ...(file.error ? { error: file.error } : {}) };
		case "needs-whisper":
			return { kind: "failed", label: "Needs whisper", ...(file.error ? { error: file.error } : {}) };
		case "ready":
			if (file.kind !== "study" || !coverage) return { kind: "none" };
			return { kind: "coverage", facts: coverage.facts, inLessons: coverage.inLessons, share: coverage.share };
	}
}

/** Retry is offered while a file is stuck or failed (the old dialog's rule). */
export function canRetry(file: ClassFile): boolean {
	return file.status === "failed" || file.status === "needs-whisper" || file.status === "pending";
}

/** Only the app's own copies can be removed; a linked folder's files leave
 *  with Unlink. */
export function canRemove(file: ClassFile): boolean {
	return file.origin === "copied";
}

/** The coverage bar's fill: the share of the file's facts that came up in
 *  a lesson (0 when it has none yet). */
export function studiedFill(state: { facts: number; inLessons: number }): number {
	return state.facts > 0 ? Math.min(1, state.inLessons / state.facts) : 0;
}

/** The drag payload type for a file row moved between the two sections. */
export const FILE_DRAG_TYPE = "application/x-godspeed-class-file";

/** A section's name. */
export function kindTitle(kind: "study" | "info"): string {
	return kind === "study" ? "Study material" : "Course info";
}

/** What a section's drop target says while something is dragged over it:
 *  - files from Finder → "Drop to add 2 files as study material"
 *  - a row from the other section → "Move to Course info" and what that does */
export function dropCopy(
	kind: "study" | "info",
	drag: { type: "finder"; count: number } | { type: "row"; facts: number | null },
): { title: string; detail?: string } {
	if (drag.type === "finder") {
		const what = drag.count > 0 ? `${drag.count} ${drag.count === 1 ? "file" : "files"}` : "files";
		return { title: `Drop to add ${what} as ${kindTitle(kind).toLowerCase()}` };
	}
	if (kind === "info") {
		const facts = drag.facts ? `Its ${drag.facts} ${drag.facts === 1 ? "fact leaves" : "facts leave"} the graph.` : "Its facts leave the graph.";
		return { title: "Move to Course info", detail: `${facts} The teacher can still read it.` };
	}
	return { title: "Move to Study material", detail: "It gets turned into facts for the graph." };
}
