/**
 * The Files page's small pure helpers. Every value comes from the space
 * record (src/shared/core/contracts/space.ts) and the progress payload's file
 * coverage (src/shared/core/progress.ts).
 */
import { plural } from "@/frontend/lib/plural";
import { SPEECH_TOOL_INSTALL, SUPPORTED_SPACE_FILE_EXTENSIONS, type SpaceFile, type FileCoverage, type FileGroup } from "@/shared/core";

/** Accepted by "Add files" (files with no extension can still be dropped). */
export const SPACE_FILE_ACCEPT = SUPPORTED_SPACE_FILE_EXTENSIONS.join(",");

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
 * - pending study file → "Waiting" (a space-info file has nothing to do;
 *   the space's work frame says when the teacher is off)
 * - failed → red label + Retry
 * - needs-whisper → "Needs a speech tool" + Retry, with the install command
 * - ready recording its lecture's transcript covers → "Uses its
 *   transcript" (it has no facts of its own; the transcript is the row
 *   next to it)
 * - ready study file → the coverage bar and its fact count (once the
 *   progress payload has it)
 * - ready space info → nothing
 */
export function fileState(file: SpaceFile, coverage: FileCoverage | undefined): FileState {
	switch (file.status) {
		case "extracting":
			return { kind: "building" };
		case "pending":
			return file.kind === "study" ? { kind: "waiting", label: "Waiting" } : { kind: "none" };
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
export function canRetry(file: SpaceFile): boolean {
	return file.status === "pending";
}

/** Only the app's own copies can be removed; a linked folder's files leave
 *  with Unlink. */
export function canRemove(file: SpaceFile): boolean {
	return file.origin === "copied";
}

/** The coverage bar's fill: the share of the file's facts that came up in
 *  a lesson (0 when it has none yet). */
export function studiedFill(state: { facts: number; inLessons: number }): number {
	return state.facts > 0 ? Math.min(1, state.inLessons / state.facts) : 0;
}

/** A section's name. */
export function kindTitle(kind: "study" | "info"): string {
	return kind === "study" ? "Study material" : "Space info";
}

/** What "Move to Space info" does to a study file's facts (null: not
 *  known yet). A file with no facts loses nothing, so it says nothing. */
function factsLeave(facts: number | null): string {
	if (facts === 0) return "";
	return `${facts === null ? "Its facts leave" : `Its ${plural(facts, "fact leaves", "facts leave")}`} the graph. `;
}

/** A change on the Files page that waits for the learner's OK. */
export type FileConfirm = { kind: "unlink" } | { kind: "remove"; file: SpaceFile } | { kind: "move"; file: SpaceFile };

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
	spaceName: string,
	files: readonly SpaceFile[],
	coverage: ReadonlyMap<string, FileCoverage>,
): ConfirmCopy {
	const known = coverage.size > 0;
	const factsOf = (list: readonly SpaceFile[]) => (known ? list.reduce((sum, f) => sum + (coverage.get(f.id)?.facts ?? 0), 0) : null);
	const withFacts = (facts: number | null, from: string) =>
		facts === 0 ? "" : `, along with ${facts === null ? "the facts" : `the ${plural(facts, "fact")}`} built from ${from}`;
	switch (change.kind) {
		case "unlink": {
			const linked = files.filter((f) => f.origin === "linked");
			const leave = linked.length > 0 ? `Its ${plural(linked.length, "file leaves", "files leave")} ${spaceName}${withFacts(factsOf(linked), "them")}. ` : "";
			return {
				title: "Unlink this folder?",
				body: `${leave}The folder on your computer is not touched. This cannot be undone.`,
				note: "To switch to another folder, use Pick folder again instead. It keeps the facts of files that are also in the new folder.",
				action: "Unlink",
				danger: true,
			};
		}
		case "remove": {
			// A PDF goes with the .tex it is built from.
			const source = files.find((f) => f.pdfId === change.file.id);
			if (source) {
				const what = change.file.kind === "study" ? withFacts(factsOf([change.file]), "them") : "";
				return {
					title: `Remove ${change.file.name} and ${source.name}?`,
					body: `They leave ${spaceName}${what}. Your original files are not touched. This cannot be undone.`,
					action: "Remove files",
					danger: true,
				};
			}
			const what = change.file.kind === "study" ? withFacts(factsOf([change.file]), "it") : "";
			return {
				title: `Remove ${change.file.name}?`,
				body: `It leaves ${spaceName}${what}. Your original file is not touched. This cannot be undone.`,
				action: "Remove file",
				danger: true,
			};
		}
		case "move":
			return {
				title: "Move to Space info?",
				body: `${factsLeave(known ? (coverage.get(change.file.id)?.facts ?? 0) : null)}The teacher can still read it.`,
				action: "Move file",
				danger: false,
			};
	}
}

/** The page's line while files from Finder are dragged over it (count 0: not known yet). */
export function dropTitle(count: number): string {
	return `Drop to add ${count > 0 ? plural(count, "file") : "files"}`;
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

/** "27 study material, 19 space info" (the Files tab already counts the
 *  files); a kind with none is left out. */
/** The letters after a file name's last dot, as its tile shows them ("PDF"); none for a name without them. */
export function fileType(name: string): string {
	const ext = /\.([A-Za-z0-9]{1,4})$/.exec(name)?.[1];
	return ext ? ext.toUpperCase() : "";
}

/** An entry's rows: a .tex right after its PDF (where the groups put it)
 *  is drawn in the PDF's row as its source. */
export function entryRows(files: readonly SpaceFile[]): { file: SpaceFile; source?: SpaceFile }[] {
	return files.flatMap((file, i) => (i > 0 && file.pdfId === files[i - 1]!.id ? [] : [{ file, source: files[i + 1]?.pdfId === file.id ? files[i + 1] : undefined }]));
}

export function filesSummary(files: readonly SpaceFile[]): string {
	const info = files.filter((f) => f.kind === "info").length;
	const study = files.length - info;
	return [study > 0 && `${study} study material`, info > 0 && `${info} space info`].filter(Boolean).join(", ");
}
