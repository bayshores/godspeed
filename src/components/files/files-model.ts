/**
 * The Files page's small pure helpers. Every value comes from the class
 * record (src/core/contracts/class.ts) and the progress payload's file
 * coverage (src/core/progress.ts).
 */
import { SPEECH_TOOL_INSTALL, type ClassFile, type FileCoverage } from "@/core";

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

/** The computer's file browser by name, for "Show in …" labels. */
export function fileBrowserName(platform: string | undefined): string {
	return platform === "win32" ? "File Explorer" : platform === "darwin" ? "Finder" : "Files";
}

/** What a row shows after its name. */
export type FileState =
	| { kind: "coverage"; facts: number; inLessons: number; share: number | null }
	| { kind: "building" }
	| { kind: "waiting"; label: string }
	| { kind: "failed"; label: string; error?: string; install?: string }
	| { kind: "none" };

/**
 * A row's state from its pipeline status and coverage:
 * - extracting → "Building facts…"
 * - pending study file → "Waiting", or "Waiting for your agent" when no
 *   agent is teaching (a course-info file has nothing to do)
 * - failed → red label + Retry
 * - needs-whisper → "Needs a speech tool" + Retry, with the install command
 * - ready study file → the coverage bar and its fact count (once the
 *   progress payload has it)
 * - ready course info → nothing
 */
export function fileState(file: ClassFile, coverage: FileCoverage | undefined, agentTeaching: boolean): FileState {
	switch (file.status) {
		case "extracting":
			return { kind: "building" };
		case "pending":
			return file.kind === "study" ? { kind: "waiting", label: agentTeaching ? "Waiting" : "Waiting for your agent" } : { kind: "none" };
		case "failed":
			return { kind: "failed", label: "Failed", ...(file.error ? { error: file.error } : {}) };
		case "needs-whisper":
			return { kind: "failed", label: "Needs a speech tool", install: SPEECH_TOOL_INSTALL };
		case "ready":
			if (file.kind !== "study" || !coverage) return { kind: "none" };
			return { kind: "coverage", facts: coverage.facts, inLessons: coverage.inLessons, share: coverage.share };
	}
}

/** Retry is offered while a file is stuck or failed. */
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

/** "1 fact", "31 facts". */
function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** What "Move to Course info" does to a study file's facts (null: not known yet). */
function factsLeave(facts: number | null): string {
	return facts ? `Its ${count(facts, "fact leaves", "facts leave")} the graph.` : "Its facts leave the graph.";
}

/** A change on the Files page that waits for the learner's OK. */
export type FileConfirm = { kind: "unlink" } | { kind: "remove"; file: ClassFile } | { kind: "move"; file: ClassFile };

export interface ConfirmCopy {
	title: string;
	body: string;
	/** A safer way to get there (Unlink: Pick folder again). */
	note?: string;
	action: string;
}

/**
 * What the confirm box says before a change that takes facts out of the
 * graph: how many files and facts go, and whether it can be undone.
 * `coverage` is empty until the progress payload loads; counts it doesn't
 * know are left out.
 */
export function confirmCopy(
	change: FileConfirm,
	className: string,
	files: readonly ClassFile[],
	coverage: ReadonlyMap<string, FileCoverage>,
): ConfirmCopy {
	const known = coverage.size > 0;
	const factsOf = (list: readonly ClassFile[]) => (known ? list.reduce((sum, f) => sum + (coverage.get(f.id)?.facts ?? 0), 0) : null);
	const withFacts = (facts: number | null, from: string) =>
		facts === 0 ? "" : `, along with ${facts === null ? "the facts" : `the ${count(facts, "fact", "facts")}`} built from ${from}`;
	switch (change.kind) {
		case "unlink": {
			const linked = files.filter((f) => f.origin === "linked");
			const leave = linked.length > 0 ? `Its ${count(linked.length, "file leaves", "files leave")} ${className}${withFacts(factsOf(linked), "them")}. ` : "";
			return {
				title: "Unlink this folder?",
				body: `${leave}The folder on your computer is not touched. This cannot be undone.`,
				note: "To switch to another folder, use Pick folder again instead. It keeps the facts of files that are also in the new folder.",
				action: "Unlink",
			};
		}
		case "remove": {
			const what = change.file.kind === "study" ? withFacts(factsOf([change.file]), "it") : "";
			return {
				title: `Remove ${change.file.name}?`,
				body: `It leaves ${className}${what}. Your original file is not touched. This cannot be undone.`,
				action: "Remove",
			};
		}
		case "move":
			return {
				title: "Move to Course info?",
				body: `${factsLeave(known ? (coverage.get(change.file.id)?.facts ?? 0) : null)} The teacher can still read it.`,
				action: "Move",
			};
	}
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
	if (kind === "info") return { title: "Move to Course info", detail: `${factsLeave(drag.facts)} The teacher can still read it.` };
	return { title: "Move to Study material", detail: "It gets turned into facts for the graph." };
}
