/**
 * The deadline page's material check: the files it covers (or every study
 * file when it covers none) grouped into numbered series with the numbers
 * that look missing, and what is still being read, failed or is course
 * info. Pure and unit-tested.
 */
import { groupFileSeries, seriesGaps, type ClassFile, type FileCoverage } from "@/core";

export type SlotState = "ready" | "reading" | "failed" | "info" | "missing";

export interface Slot {
	number: number;
	state: SlotState;
	/** The files at this number (none for a missing one). */
	names: string[];
	date: string | null;
}

export interface MaterialSeries {
	key: string;
	label: string;
	slots: Slot[];
	/** Numbers present / the last number. */
	present: number;
	last: number;
	/** Every file in it is course info (no facts). */
	infoOnly: boolean;
}

export interface Material {
	/** The deadline covers no files, so this is every study file. */
	allStudy: boolean;
	series: MaterialSeries[];
	/** Files that are not part of a series, in name order. */
	loose: { id: string; name: string; state: Exclude<SlotState, "missing"> }[];
	studyFiles: number;
	infoFiles: number;
	reading: number;
	failed: number;
	/** Facts born in the study files shown. */
	facts: number;
	/** Numbers missing across every series. */
	missing: number;
}

type FileLike = Pick<ClassFile, "id" | "name" | "kind" | "status">;

function fileState(f: FileLike): Exclude<SlotState, "missing"> {
	if (f.status === "failed" || f.status === "needs-whisper") return "failed";
	if (f.status === "pending" || f.status === "extracting") return "reading";
	return f.kind === "info" ? "info" : "ready";
}

/** The worst state among a number's files. */
const ORDER: Exclude<SlotState, "missing">[] = ["failed", "reading", "ready", "info"];
const worst = (states: Exclude<SlotState, "missing">[]) => ORDER.find((s) => states.includes(s)) ?? "ready";

export function deadlineMaterial(files: readonly FileLike[], coveredIds: readonly string[], coverage: readonly Pick<FileCoverage, "fileId" | "facts">[]): Material {
	const covered = new Set(coveredIds);
	const shown = covered.size > 0 ? files.filter((f) => covered.has(f.id)) : files.filter((f) => f.kind === "study");
	const { series, other } = groupFileSeries(shown);
	const factsOf = new Map(coverage.map((c) => [c.fileId, c.facts]));
	let missing = 0;
	const groups = series.map((s): MaterialSeries => {
		const gaps = seriesGaps(s);
		missing += gaps.length;
		const slots: Slot[] = [
			...s.items.map((i) => ({ number: i.number, state: worst(i.files.map(fileState)), names: i.files.map((f) => f.name), date: i.date })),
			...gaps.map((n) => ({ number: n, state: "missing" as const, names: [], date: null })),
		].sort((a, b) => a.number - b.number);
		return {
			key: s.key,
			label: s.label,
			slots,
			present: s.items.length,
			last: s.items[s.items.length - 1]!.number,
			infoOnly: s.items.every((i) => i.files.every((f) => f.kind === "info")),
		};
	});
	return {
		allStudy: covered.size === 0,
		series: groups,
		loose: other.map((f) => ({ id: f.id, name: f.name, state: fileState(f) })),
		studyFiles: shown.filter((f) => f.kind === "study").length,
		infoFiles: shown.filter((f) => f.kind === "info").length,
		reading: shown.filter((f) => fileState(f) === "reading").length,
		failed: shown.filter((f) => fileState(f) === "failed").length,
		facts: shown.reduce((sum, f) => sum + (factsOf.get(f.id) ?? 0), 0),
		missing,
	};
}

/** The line under "Material". */
export function materialSummary(m: Material): string {
	if (m.series.length === 0 && m.loose.length === 0) return "No study files yet.";
	const parts: string[] = [];
	if (m.missing > 0) parts.push(`${missingText(m.series)} ${m.missing === 1 ? "looks" : "look"} missing`);
	if (m.failed > 0) parts.push(`${m.failed} ${m.failed === 1 ? "file" : "files"} couldn't be read`);
	if (m.reading > 0) parts.push(`${m.reading} still being read`);
	return parts.length > 0 ? `${parts.join(", ")}.` : "Nothing looks missing from the file names.";
}

/** "Lecture 3, 4 and HW 2", naming at most two series. */
function missingText(series: readonly MaterialSeries[]): string {
	const named = series
		.map((s) => ({ label: s.label, numbers: s.slots.filter((slot) => slot.state === "missing").map((slot) => slot.number) }))
		.filter((s) => s.numbers.length > 0)
		.map((s) => `${s.label} ${s.numbers.join(", ")}`);
	if (named.length <= 2) return named.join(" and ");
	return `${named.slice(0, 2).join(", ")} and ${named.length - 2} more`;
}

/** The message "Check with the syllabus" sends to the teacher. */
export function syllabusCheckMessage(className: string, deadline: { name: string; when: string }): string {
	return `Check my ${className} files for ${deadline.name} (${deadline.when}). Compare the syllabus and course info with the class's files and tell me which lectures, transcripts, discussions or readings it covers that are missing. Don't add anything yet.`;
}

/** "2 of 5 right", or "not tested". */
export function rightLabel(t: { right: number; answered: number }): string {
	return t.answered === 0 ? "not tested" : `${t.right} of ${t.answered} right`;
}
