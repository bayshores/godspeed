/**
 * A space's files in groups, as the Files page and the godspeed folder's
 * spaces/ show them: one group per numbered series in the file names
 * (core/file-series.ts), a lecture's notes and its transcript joined, one
 * per linked subfolder for files in no series (Drive folders of dated
 * slides), then "Other". Study material and space info sit together.
 */
import { isRecordingOrCaptions, type SpaceFile } from "./contracts.ts";
import { dateInName, groupFileSeries, type FileSeries } from "./file-series.ts";

/** One entry of a group: a number of a series ("Lecture 3", with every
 *  file that carries it, notes and transcript together) or one other file. */
export interface FileItem {
	key: string;
	/** "Lecture 3", "Week 2", "6"; null for a file outside any series. */
	label: string | null;
	/** "YYYY-MM-DD" from the item's own or its paired transcript's name. */
	date: string | null;
	files: SpaceFile[];
}

export interface FileGroup {
	key: string;
	label: string;
	/** Files in the group (not entries). */
	count: number;
	items: FileItem[];
}

/** "Day", "Week" from a series label ("Week, Discussion"); null when the
 *  names start with the number ("06_Counting") or with codes ("29-fa26-l3"). */
function headOf(series: FileSeries<SpaceFile>): string | null {
	return series.key && series.label !== "Numbered" ? series.label.split(", ")[0]! : null;
}

/** How alike two series' numbers are: shared over all (1 = the same
 *  numbers). A number whose items both carry a date shares only when the
 *  dates agree (Week 1's discussion is not Lecture 1). */
function likeness(a: FileSeries<SpaceFile>, b: FileSeries<SpaceFile>): number {
	const dates = new Map(b.items.map((i) => [i.number, i.date]));
	const shared = a.items.filter((i) => dates.has(i.number) && (!i.date || !dates.get(i.number) || i.date === dates.get(i.number))).length;
	const all = new Set([...a.items, ...b.items].map((i) => i.number)).size;
	return shared < 2 ? 0 : shared / all;
}

/**
 * Which notes series each transcript series pairs with: a series made only
 * of transcripts or recordings pairs with the one series that has none and
 * shares the most of its numbers (at least two, and at least half of all
 * their numbers). Names that start with their number ("01_Logic") are
 * chapters or readings, not lecture notes, so they never pair. A tie pairs
 * nothing, and a notes series pairs once.
 */
export function pairSeries(series: readonly FileSeries<SpaceFile>[]): Map<FileSeries<SpaceFile>, FileSeries<SpaceFile>> {
	const all = (s: FileSeries<SpaceFile>, test: (f: SpaceFile) => boolean) => s.items.every((i) => i.files.every(test));
	const transcripts = series.filter((s) => all(s, (f) => isRecordingOrCaptions(f.name)));
	const notes = series.filter((s) => s.key !== "" && all(s, (f) => !isRecordingOrCaptions(f.name)));
	const best = new Map<FileSeries<SpaceFile>, { notes: FileSeries<SpaceFile>; score: number }>();
	for (const t of transcripts) {
		const scored = notes.map((n) => ({ notes: n, score: likeness(t, n) })).filter((c) => c.score >= 0.5).sort((a, b) => b.score - a.score);
		if (scored.length === 0 || scored[1]?.score === scored[0]!.score) continue;
		best.set(t, scored[0]!);
	}
	const pairs = new Map<FileSeries<SpaceFile>, FileSeries<SpaceFile>>();
	for (const [t, pick] of best) {
		const rivals = [...best].filter(([other, p]) => other !== t && p.notes === pick.notes);
		if (rivals.some(([, p]) => p.score >= pick.score)) continue;
		pairs.set(t, pick.notes);
	}
	return pairs;
}

function seriesGroup(series: FileSeries<SpaceFile>, partner?: FileSeries<SpaceFile>): FileGroup {
	const head = headOf(series);
	const items = new Map<number, FileItem>();
	const add = (from: FileSeries<SpaceFile>, first: boolean) => {
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

/** Files in no series that share a linked subfolder (two or more): one
 *  group per folder, named after it, by date in the names. */
function folderGroups(other: readonly SpaceFile[]): { groups: FileGroup[]; rest: SpaceFile[] } {
	const byDir = new Map<string, SpaceFile[]>();
	for (const f of other) {
		const dir = f.origin === "linked" && f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
		byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
	}
	const groups: FileGroup[] = [];
	const rest: SpaceFile[] = [];
	for (const [dir, files] of byDir) {
		if (!dir || files.length < 2) {
			rest.push(...files);
			continue;
		}
		const items = files
			.map((f) => ({ key: f.id, label: null, date: dateInName(f.name), files: [f] }))
			.sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9") || a.files[0]!.name.localeCompare(b.files[0]!.name, undefined, { numeric: true }));
		groups.push({ key: `folder:${dir}`, label: dir.split("/").pop()!, count: files.length, items });
	}
	return { groups, rest };
}

/** The groups: one per numbered series, a lecture's notes and transcript
 *  joined (pairSeries), one per linked subfolder of the rest, study groups
 *  first, then "Other". */
export function fileGroups(files: readonly SpaceFile[]): FileGroup[] {
	const { series, other } = groupFileSeries(files);
	const pairs = pairSeries(series);
	const paired = new Set(pairs.values());
	const folders = folderGroups(other);
	const groups = [...series.filter((s) => !paired.has(s)).map((s) => seriesGroup(s, pairs.get(s))), ...folders.groups];
	// Groups with study material (lectures, readings) come before space info.
	const hasStudy = (g: FileGroup) => g.items.some((i) => i.files.some((f) => f.kind === "study"));
	groups.sort((a, b) => Number(hasStudy(b)) - Number(hasStudy(a)));
	const rest = folders.rest.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	if (rest.length > 0) groups.push({ key: "other", label: "Other", count: rest.length, items: rest.map((f) => ({ key: f.id, label: null, date: null, files: [f] })) });
	return groups;
}
