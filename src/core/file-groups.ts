/**
 * A class's files in groups, as the Files page and the godspeed folder's
 * classes/ show them: one group per numbered series in the file names
 * (core/file-series.ts), a lecture's notes and its transcript joined, then
 * "Other". Study material and course info sit together.
 */
import type { ClassFile } from "./contracts.ts";
import { groupFileSeries, type FileSeries } from "./file-series.ts";

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

/** The groups: one per numbered series, a lecture's notes and transcript
 *  joined (pairSeries), study groups first, then "Other". */
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
