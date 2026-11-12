/**
 * Numbered series in a space's file names ("Day1 …", "Lecture01_2026-09-25",
 * "Week 2 Evening Discussion", "HW3_F26", "06_Counting"), so the Files page
 * can group them.
 * Purely from names: nothing here knows what the space actually has.
 */

import { extensionOf } from "./contracts.ts";

export interface NamedFile {
	id: string;
	name: string;
}

/** One number of a series and the files that carry it (a lecture's notes
 *  can come as two files). */
export interface SeriesItem<F extends NamedFile = NamedFile> {
	number: number;
	files: F[];
	/** "YYYY-MM-DD" when a file's name has one. */
	date: string | null;
}

export interface FileSeries<F extends NamedFile = NamedFile> {
	/** The shared start of the names, lowercased ("day", "cse21_hw", "" for "01_…"). */
	key: string;
	/** For people: "Day", "CSE21 HW", "Week, Discussion", "Numbered". */
	label: string;
	/** In number order. */
	items: SeriesItem<F>[];
}

/** "2026-09-24", or "20260924" as a whole number (a real month and day). */
const DATE = /(\d{4})-(\d{2})-(\d{2})|(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/;

function stem(name: string): string {
	const ext = extensionOf(name);
	return ext ? name.slice(0, -ext.length) : name;
}

/** "YYYY-MM-DD" when the name carries a date. */
export function dateInName(name: string): string | null {
	return splitDate(name).date;
}

/** The name with its date cut out, and the date. */
function splitDate(name: string): { rest: string; date: string | null } {
	const m = DATE.exec(name);
	if (!m) return { rest: name, date: null };
	const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
	return { rest: name.replace(DATE, " "), date: `${y}-${mo}-${d}` };
}

const words = (text: string) =>
	text
		.split(/[\s_\-.()]+/)
		.map((w) => w.trim())
		// Words only: no bare numbers or dashes.
		.filter((w) => /\p{L}/u.test(w));

interface Candidate {
	key: string;
	prefix: string;
	number: number;
	remainder: string;
}

/** Every way to read a name as "<prefix><number><remainder>". */
function candidates(name: string): Candidate[] {
	const { rest } = splitDate(stem(name));
	const out: Candidate[] = [];
	for (const m of rest.matchAll(/\d+/g)) {
		const prefix = rest.slice(0, m.index);
		out.push({
			key: prefix.toLowerCase().replace(/^[\s_\-.]+|[\s_\-.]+$/g, "").replace(/\s+/g, " "),
			prefix,
			number: Number(m[0]),
			remainder: rest.slice(m.index + m[0].length),
		});
	}
	return out;
}

// Shared by chance, so they name nothing ("Sets and functions", "Proofs go on and on").
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "vs", "with"]);

function labelFor(members: Candidate[]): string {
	// A prefix of name codes only ("29-fa26-l") makes no label.
	const headWords = words(members[0]!.prefix);
	const head = headWords.some((w) => !/\d/.test(w) && w.length > 1) ? headWords.join(" ") : "";
	// Words every member's remainder shares, e.g. "Discussion".
	const sets = members.map((c) => new Set(words(c.remainder).map((w) => w.toLowerCase())));
	const shared = words(members[0]!.remainder).filter((w) => !SMALL_WORDS.has(w.toLowerCase()) && sets.every((s) => s.has(w.toLowerCase())));
	const tail = shared.filter((w, i) => shared.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i).join(" ");
	if (!head) return tail || "Numbered";
	return tail ? `${head}, ${tail}` : head;
}

/**
 * Group files into numbered series. A series needs at least two files
 * whose numbers differ; each file joins the biggest series it can (ties go
 * to the longer prefix). The rest are returned as `other`, in name order.
 */
export function groupFileSeries<F extends NamedFile>(files: readonly F[]): { series: FileSeries<F>[]; other: F[] } {
	const byKey = new Map<string, { file: F; c: Candidate }[]>();
	const options = new Map<F, Candidate[]>();
	for (const file of files) {
		const cs = candidates(file.name);
		options.set(file, cs);
		for (const c of cs) {
			const list = byKey.get(c.key) ?? [];
			list.push({ file, c });
			byKey.set(c.key, list);
		}
	}
	// A key counts only when its numbers differ.
	const size = (key: string) => {
		const list = byKey.get(key) ?? [];
		return new Set(list.map((m) => m.c.number)).size > 1 ? new Set(list.map((m) => m.file)).size : 0;
	};
	const chosen = new Map<string, { file: F; c: Candidate }[]>();
	const other: F[] = [];
	for (const file of files) {
		let best: Candidate | null = null;
		for (const c of options.get(file)!) {
			const s = size(c.key);
			if (s < 2) continue;
			if (!best || s > size(best.key) || (s === size(best.key) && c.key.length > best.key.length)) best = c;
		}
		if (!best) {
			other.push(file);
			continue;
		}
		const list = chosen.get(best.key) ?? [];
		list.push({ file, c: best });
		chosen.set(best.key, list);
	}
	const series: FileSeries<F>[] = [];
	for (const [key, members] of chosen) {
		// A series left with one number after the others chose elsewhere isn't one.
		if (new Set(members.map((m) => m.c.number)).size < 2) {
			other.push(...members.map((m) => m.file));
			continue;
		}
		const items = new Map<number, SeriesItem<F>>();
		for (const { file, c } of members) {
			const item = items.get(c.number) ?? { number: c.number, files: [], date: null };
			item.files.push(file);
			item.date ??= splitDate(stem(file.name)).date;
			items.set(c.number, item);
		}
		series.push({
			key,
			label: labelFor(members.map((m) => m.c)),
			items: [...items.values()].sort((a, b) => a.number - b.number),
		});
	}
	series.sort((a, b) => a.label.localeCompare(b.label));
	other.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	return { series, other };
}
