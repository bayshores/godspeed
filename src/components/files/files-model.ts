/**
 * The Files page's small pure helpers. Every value comes from the class
 * record (src/core/contracts/class.ts) and the progress payload's file
 * coverage (src/core/progress.ts).
 */
import { groupFileSeries, SPEECH_TOOL_INSTALL, type ClassFile, type FileCoverage, type FileSeries } from "@/core";

/** Accepted by "Add files" (mirrors SUPPORTED_CLASS_FILE_EXTENSIONS). */
export const CLASS_FILE_ACCEPT = ".md,.markdown,.txt,.pdf,.vtt,.srt,.mp3,.m4a,.wav,.mp4,.mov";

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

/** A section's name. */
export function kindTitle(kind: "study" | "info"): string {
	return kind === "study" ? "Study material" : "Course info";
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
				body: `${factsLeave(known ? (coverage.get(change.file.id)?.facts ?? 0) : null)}The teacher can still read it.`,
				action: "Move",
			};
	}
}

/** A drop target's line while files from Finder are dragged over the page. */
export function dropTitle(kind: "study" | "info", count: number): string {
	const what = count > 0 ? `${count} ${count === 1 ? "file" : "files"}` : "files";
	return `Add ${what} as ${kindTitle(kind).toLowerCase()}`;
}

/** Transcripts and recordings (the lecture-audio side of a pair). */
const RECORDING = /\.(vtt|srt|mp3|m4a|wav|mp4|mov)$/i;

export function isRecording(name: string): boolean {
	return RECORDING.test(name);
}

/** One entry of a group: a number of a series ("Lecture 3", with every
 *  file that carries it, notes and transcript together) or one other file. */
export interface FileItem {
	key: string;
	/** "Lecture 3", "Week 2", "6"; null for a file outside any series. */
	label: string | null;
	/** "YYYY-MM-DD" from the item's own or its paired transcript's name. */
	date: string | null;
	files: ClassFile[];
}

export interface FileGroup {
	key: string;
	label: string;
	/** Files in the group (not entries). */
	count: number;
	items: FileItem[];
}

/** "Day", "Week" from a series label ("Week · Discussion"); null when the
 *  names start with the number ("06_Counting"). */
function headOf(series: FileSeries<ClassFile>): string | null {
	return series.key ? series.label.split(" · ")[0]! : null;
}

const numbersOf = (series: FileSeries<ClassFile>) => new Set(series.items.map((i) => i.number));

/** How alike two series' numbers are: shared over all (1 = the same numbers). */
function likeness(a: FileSeries<ClassFile>, b: FileSeries<ClassFile>): number {
	const x = numbersOf(a);
	const y = numbersOf(b);
	const shared = [...x].filter((n) => y.has(n)).length;
	return shared < 2 ? 0 : shared / new Set([...x, ...y]).size;
}

/**
 * Which notes series each transcript series pairs with: a series made only
 * of transcripts or recordings pairs with the one series that has none and
 * shares the most of its numbers (at least two, and at least half of all
 * their numbers). A tie pairs nothing, and a notes series pairs once.
 */
export function pairSeries(series: readonly FileSeries<ClassFile>[]): Map<FileSeries<ClassFile>, FileSeries<ClassFile>> {
	const all = (s: FileSeries<ClassFile>, test: (f: ClassFile) => boolean) => s.items.every((i) => i.files.every(test));
	const transcripts = series.filter((s) => all(s, (f) => isRecording(f.name)));
	const notes = series.filter((s) => all(s, (f) => !isRecording(f.name)));
	const best = new Map<FileSeries<ClassFile>, { notes: FileSeries<ClassFile>; score: number }>();
	for (const t of transcripts) {
		const scored = notes.map((n) => ({ notes: n, score: likeness(t, n) })).filter((c) => c.score >= 0.5).sort((a, b) => b.score - a.score);
		if (scored.length === 0 || scored[1]?.score === scored[0]!.score) continue;
		best.set(t, scored[0]!);
	}
	const pairs = new Map<FileSeries<ClassFile>, FileSeries<ClassFile>>();
	for (const [t, pick] of best) {
		const rivals = [...best].filter(([other, p]) => other !== t && p.notes === pick.notes);
		if (rivals.some(([, p]) => p.score >= pick.score)) continue;
		pairs.set(t, pick.notes);
	}
	return pairs;
}

function seriesGroup(series: FileSeries<ClassFile>, partner?: FileSeries<ClassFile>): FileGroup {
	const head = headOf(series);
	const items = new Map<number, FileItem>();
	const add = (from: FileSeries<ClassFile>, first: boolean) => {
		for (const item of from.items) {
			const entry = items.get(item.number) ?? { key: `${series.key}#${item.number}`, label: head ? `${head} ${item.number}` : String(item.number), date: null, files: [] };
			entry.files = first ? [...item.files, ...entry.files] : [...entry.files, ...item.files];
			entry.date = item.date ?? entry.date;
			items.set(item.number, entry);
		}
	};
	// Notes first, then the transcript; the transcript's date wins.
	if (partner) add(partner, true);
	add(series, false);
	const list = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
	return {
		key: partner ? `${series.key}+${partner.key}` : series.key,
		label: series.label,
		count: list.reduce((n, i) => n + i.files.length, 0),
		items: list,
	};
}

/**
 * The Files page's groups: one per numbered series in the file names,
 * a lecture's notes and its transcript joined (pairSeries), then "Other"
 * for the rest. Study material and course info sit together; each row
 * says which it is.
 */
export function fileGroups(files: readonly ClassFile[]): FileGroup[] {
	const { series, other } = groupFileSeries(files);
	const pairs = pairSeries(series);
	const paired = new Set(pairs.values());
	const groups = series.filter((s) => !paired.has(s)).map((s) => seriesGroup(s, pairs.get(s)));
	// Groups with study material (lectures, readings) come before course info.
	const hasStudy = (g: FileGroup) => g.items.some((i) => i.files.some((f) => f.kind === "study"));
	groups.sort((a, b) => Number(hasStudy(b)) - Number(hasStudy(a)));
	if (other.length > 0)
		groups.push({ key: "other", label: "Other", count: other.length, items: other.map((f) => ({ key: f.id, label: null, date: null, files: [f] })) });
	return groups;
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

/** "46 files · 27 study material · 19 course info". */
export function filesSummary(files: readonly ClassFile[]): string {
	const info = files.filter((f) => f.kind === "info").length;
	const parts = [count(files.length, "file", "files")];
	if (files.length > 0) parts.push(`${files.length - info} study material`, `${info} course info`);
	return parts.join(" · ");
}
