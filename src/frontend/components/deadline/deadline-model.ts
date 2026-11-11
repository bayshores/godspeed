/**
 * The deadline page's "What's on it": the files it covers grouped into class
 * days (a day's slides, transcript and discussion are one row) and weeks,
 * the class days before it that it neither covers nor leaves out, and the
 * ones left out on purpose. Pure and unit-tested.
 */
import { dateInName, extensionOf, type ClassDeadline, type ClassFile, type DeadlineKind, type FileCoverage, type TopicProgress } from "@/shared/core";
import { clockLabel, kindLabel } from "@/frontend/components/class-deadlines-model";
import { longDay } from "@/frontend/components/home-page/home-page-model";

export type DayState = "ready" | "reading" | "failed" | "info";

type FileLike = Pick<ClassFile, "id" | "name" | "kind" | "status">;

/** One class day: every file dated that day (or one undated file). */
export interface ClassDay {
	/** The date, or the file id for an undated file. */
	key: string;
	/** "YYYY-MM-DD"; null for an undated file. */
	date: string | null;
	/** "Intro and Counting", or the file's name when undated. */
	title: string;
	/** What the day's files are: "lecture slides", "transcript". */
	parts: string[];
	fileIds: string[];
	names: string[];
	/** The worst state among its files. */
	state: DayState;
}

export interface Week {
	/** Counted from the week of the class's first dated study file. */
	number: number;
	days: ClassDay[];
}

export interface Material {
	/** The covered files' class days by week, then undated files as their own days. */
	weeks: Week[];
	undated: ClassDay[];
	/** Study days before it that it doesn't cover and that weren't left out. */
	notIncluded: ClassDay[];
	leftOut: ClassDay[];
	classDays: number;
	files: number;
	reading: number;
	failed: number;
	/** Facts born in the covered files. */
	facts: number;
}

function fileState(f: FileLike): DayState {
	if (f.status === "failed" || f.status === "needs-whisper") return "failed";
	if (f.status === "pending" || f.status === "extracting") return "reading";
	return f.kind === "info" ? "info" : "ready";
}

const ORDER: DayState[] = ["failed", "reading", "ready", "info"];
const worst = (states: DayState[]) => ORDER.find((s) => states.includes(s)) ?? "ready";

/** Words that say what kind of file it is, not what the day was about. */
const PART_WORDS = ["transcript", "slides", "notes", "annotated", "recording", "handout", "worksheet", "solutions", "discussion"];
const GENERIC = new Set([...PART_WORDS, "lecture", "week", "day", "class", "evening", "morning", "section", "lab", "and", "the", "of"]);

/** The name without its extension, date and empty brackets. */
function plain(name: string): string {
	const ext = extensionOf(name);
	const stem = ext ? name.slice(0, -ext.length) : name;
	return stem
		.replace(/\d{4}-\d{2}-\d{2}|(?<!\d)20\d{6}(?!\d)/g, " ")
		.replace(/\(\s*\)/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** "Intro and Counting" from "2026-09-25 Intro and Counting (lecture slides).pdf". */
function titleOf(name: string): string {
	return plain(name)
		.replace(/\([^)]*\)/g, " ")
		.replace(/^[\s_\-.]+|[\s_\-.]+$/g, "")
		.replace(/[_]+/g, " ")
		.replace(/\s+/g, " ");
}

/** How much of a title is about the day: words that aren't course codes, numbers or file words. */
function topicWords(title: string): number {
	return title.split(/\s+/).filter((w) => /\p{Ll}/u.test(w) && !/\d/.test(w) && !GENERIC.has(w.toLowerCase())).length;
}

/** "lecture slides" from the brackets, else a file word in the name; null when neither says. */
function partOf(name: string): string | null {
	const bracket = /\(([^)\d]*\p{L}[^)\d]*)\)/u.exec(plain(name))?.[1]?.trim();
	if (bracket) return bracket.toLowerCase();
	const lower = name.toLowerCase();
	return PART_WORDS.find((w) => lower.includes(w)) ?? null;
}

function dayOf(key: string, date: string | null, files: FileLike[]): ClassDay {
	const titles = files.map((f) => titleOf(f.name));
	const best = titles.reduce((a, b) => (topicWords(b) > topicWords(a) || (topicWords(b) === topicWords(a) && b.length < a.length) ? b : a));
	return {
		key,
		date,
		title: date ? best || files[0]!.name : files[0]!.name,
		parts: [...new Set(files.map((f) => partOf(f.name)).filter((p): p is string => p !== null))].sort(),
		fileIds: files.map((f) => f.id),
		names: files.map((f) => f.name),
		state: worst(files.map(fileState)),
	};
}

/** Files grouped into class days: dated ones by day (in date order), then each undated one alone (by name). */
function classDays(files: readonly FileLike[]): ClassDay[] {
	const byDate = new Map<string, FileLike[]>();
	const undated: FileLike[] = [];
	for (const f of files) {
		const date = dateInName(f.name);
		if (date) byDate.set(date, [...(byDate.get(date) ?? []), f]);
		else undated.push(f);
	}
	return [
		...[...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, fs]) => dayOf(date, date, fs)),
		...undated.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((f) => dayOf(f.id, null, [f])),
	];
}

/** The Monday on or before a day (days since 1970). */
function weekStart(day: number): number {
	// 1970-01-01 was a Thursday: Monday is 3 days earlier.
	return day - ((day + 3) % 7);
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

type DeadlineLike = Pick<ClassDeadline, "id" | "kind" | "date" | "fileIds" | "leftOutIds">;

/** Where the "not on it" check starts: after the class's last earlier exam
 *  for an exam, else at its first covered day; null = no check. */
function checkFrom(d: DeadlineLike, others: readonly DeadlineLike[], coveredDates: string[]): string | null {
	if (d.kind === "exam") {
		const before = others.filter((o) => o.id !== d.id && o.kind === "exam" && o.date < d.date).map((o) => o.date);
		return before.length > 0 ? before.sort().at(-1)! : "";
	}
	return coveredDates.length > 0 ? coveredDates.sort()[0]! : null;
}

export function deadlineMaterial(
	files: readonly FileLike[],
	deadline: DeadlineLike,
	deadlines: readonly DeadlineLike[],
	coverage: readonly Pick<FileCoverage, "fileId" | "facts">[],
): Material {
	const covered = new Set(deadline.fileIds);
	const leftOut = new Set(deadline.leftOutIds ?? []);
	const shown = files.filter((f) => covered.has(f.id));
	const days = classDays(shown);
	const firstDate = files.filter((f) => f.kind === "study").map((f) => dateInName(f.name)).filter((d): d is string => d !== null).sort()[0];
	// A term that starts on a Friday folds those days into week 1.
	const base = firstDate ? weekStart(dayNumber(firstDate) + 3) : 0;
	const weeks: Week[] = [];
	for (const day of days.filter((d) => d.date)) {
		const number = firstDate ? Math.max(1, Math.floor((weekStart(dayNumber(day.date!)) - base) / 7) + 1) : 1;
		const last = weeks.at(-1);
		if (last?.number === number) last.days.push(day);
		else weeks.push({ number, days: [day] });
	}
	const coveredDates = days.map((d) => d.date).filter((d): d is string => d !== null);
	const from = checkFrom(deadline, deadlines, coveredDates);
	const candidates =
		from === null || covered.size === 0
			? []
			: files.filter((f) => {
					if (f.kind !== "study" || covered.has(f.id) || leftOut.has(f.id)) return false;
					const date = dateInName(f.name);
					// An exam's check starts the day after the last exam; another deadline's on its first covered day.
					return date !== null && date < deadline.date && (deadline.kind === "exam" ? date > from : date >= from);
				});
	const factsOf = new Map(coverage.map((c) => [c.fileId, c.facts]));
	return {
		weeks,
		undated: days.filter((d) => !d.date),
		notIncluded: classDays(candidates),
		leftOut: classDays(files.filter((f) => leftOut.has(f.id))),
		classDays: coveredDates.length,
		files: shown.length,
		reading: shown.filter((f) => fileState(f) === "reading").length,
		failed: shown.filter((f) => fileState(f) === "failed").length,
		facts: shown.reduce((sum, f) => sum + (factsOf.get(f.id) ?? 0), 0),
	};
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "11 class days, 34 files, 2 still being read". */
export function materialSummary(m: Material): string {
	const parts = [m.classDays > 0 ? plural(m.classDays, "class day") : null, plural(m.files, "file")];
	if (m.reading > 0) parts.push(`${m.reading} still being read`);
	if (m.failed > 0) parts.push(`${m.failed} couldn't be read`);
	return parts.filter(Boolean).join(", ");
}

/** "Sep 25" from "2026-09-25". */
export function shortDate(date: string): string {
	return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The message Ask sends the teacher. */
export function coverageMessage(className: string, deadline: { name: string; when: string }): string {
	return `Work out what ${deadline.name} (${deadline.when}) in ${className} covers from my files, like a practice exam, a review sheet or the syllabus. Link those files to it, leave out the earlier ones it doesn't cover, and tell me which file you went by.`;
}

/** A topic's answers so far. */
export type TopicTally = Pick<TopicProgress, "id" | "right" | "answered">;

/** "2 of 5 right", or "not tested". */
export function rightLabel(t: { right: number; answered: number } | undefined): string {
	return t && t.answered > 0 ? `${t.right} of ${t.answered} right` : "not tested";
}

/** Over the deadline's name: "Exam, Tuesday Dec 8, 11:59 PM". */
export function whenLine(d: { kind: DeadlineKind; date: string; time?: string }): string {
	return [kindLabel(d.kind), longDay(d.date), d.time ? clockLabel(d.time) : ""].filter(Boolean).join(", ");
}
