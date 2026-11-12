/**
 * The Files page's small pure helpers. Every value comes from the class
 * record (src/shared/core/contracts/class.ts) and the progress payload's file
 * coverage (src/shared/core/progress.ts).
 */
import { SPEECH_TOOL_INSTALL, SUPPORTED_CLASS_FILE_EXTENSIONS, type ClassFile, type FileCoverage, type FileGroup } from "@/shared/core";

/** Accepted by "Add files" (files with no extension can still be dropped). */
export const CLASS_FILE_ACCEPT = SUPPORTED_CLASS_FILE_EXTENSIONS.join(",");

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
	| { kind: "transcript"; label: string }
	| { kind: "none" };

/**
 * A row's state from its pipeline status and coverage:
 * - extracting → "Building facts"
 * - pending study file → "Waiting", or "Waiting for your agent" when no
 *   agent is teaching (a course-info file has nothing to do)
 * - failed → red label + Retry
 * - needs-whisper → "Needs a speech tool" + Retry, with the install command
 * - ready recording its lecture's transcript covers → "Uses its
 *   transcript" (it has no facts of its own; the transcript is the row
 *   next to it)
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
			if (file.transcriptId) return { kind: "transcript", label: "Uses its transcript" };
			if (file.kind !== "study" || !coverage) return { kind: "none" };
			return { kind: "coverage", facts: coverage.facts, inLessons: coverage.inLessons, share: coverage.share };
	}
}

/** The More menu offers Retry while a file is stuck waiting; a failed row
 *  already shows its own Retry. */
export function canRetry(file: ClassFile): boolean {
	return file.status === "pending";
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

/** A section's name. */
export function kindTitle(kind: "study" | "info"): string {
	return kind === "study" ? "Study material" : "Course info";
}

/** What each kind does, under its name (Add files and the drop targets). */
export function kindNote(kind: "study" | "info"): string {
	return kind === "study" ? "Turned into facts" : "Read by the teacher only";
}

/** "1 fact", "31 facts". */
function count(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** What "Move to Course info" does to a study file's facts (null: not
 *  known yet). A file with no facts loses nothing, so it says nothing. */
function factsLeave(facts: number | null): string {
	if (facts === 0) return "";
	return `${facts === null ? "Its facts leave" : `Its ${count(facts, "fact leaves", "facts leave")}`} the graph. `;
}

/** A change on the Files page that waits for the learner's OK. */
export type FileConfirm = { kind: "unlink" } | { kind: "remove"; file: ClassFile } | { kind: "move"; file: ClassFile };

export interface ConfirmCopy {
	title: string;
	body: string;
	/** A safer way to get there (Unlink: Pick folder again). */
	note?: string;
	action: string;
	/** The action takes something away for good (red); a move is a plain button. */
	danger: boolean;
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
				danger: true,
			};
		}
		case "remove": {
			const what = change.file.kind === "study" ? withFacts(factsOf([change.file]), "it") : "";
			return {
				title: `Remove ${change.file.name}?`,
				body: `It leaves ${className}${what}. Your original file is not touched. This cannot be undone.`,
				action: "Remove file",
				danger: true,
			};
		}
		case "move":
			return {
				title: "Move to Course info?",
				body: `${factsLeave(known ? (coverage.get(change.file.id)?.facts ?? 0) : null)}The teacher can still read it.`,
				action: "Move file",
				danger: false,
			};
	}
}

/** A drop target's line while files from Finder are dragged over the page. */
export function dropTitle(kind: "study" | "info", count: number): string {
	const what = count > 0 ? `${count} ${count === 1 ? "file" : "files"}` : "files";
	return `Add ${what} as ${kindTitle(kind).toLowerCase()}`;
}

/** The groups narrowed to entries with a file whose name has `query`
 *  (any case); groups left empty drop out. */
export function filterGroups(groups: readonly FileGroup[], query: string): FileGroup[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...groups];
	const out: FileGroup[] = [];
	for (const g of groups) {
		const items = g.items.filter((i) => i.files.some((f) => f.name.toLowerCase().includes(q)));
		if (items.length > 0) out.push({ ...g, items, count: items.reduce((n, i) => n + i.files.length, 0) });
	}
	return out;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-25" → "Fri Sep 25" (a calendar day, no time zone). */
export function shortDate(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
	const day = new Date(Date.UTC(y, m - 1, d));
	return `${DAYS[day.getUTCDay()]} ${MONTHS[m - 1]} ${d}`;
}

/** The line above each section of the file list, given whether each is
 *  open (Recent changes counts as open): solid beside an open section,
 *  dotted between two folded ones, none above the first. */
export function listRules(open: readonly boolean[]): ("solid" | "dotted" | null)[] {
	return open.map((o, i) => (i === 0 ? null : o || open[i - 1] ? "solid" : "dotted"));
}

/** "46 files, 27 study material, 19 course info". */
export function filesSummary(files: readonly ClassFile[]): string {
	const info = files.filter((f) => f.kind === "info").length;
	const parts = [count(files.length, "file", "files")];
	if (files.length > 0) parts.push(`${files.length - info} study material`, `${info} course info`);
	return parts.join(", ");
}
