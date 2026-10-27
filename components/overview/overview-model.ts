/**
 * The Class Overview's small derived values (redesign plan, Phase 4).
 * Pure — every number comes from the ProgressPayload (src/core/progress.ts);
 * this file only shapes it for the page and is unit-tested on its own.
 */
import type { CalibrationLevel, FileCoverage, LessonProgress } from "@/src/core";
import { messageAnchorId } from "@/src/core";

/** A file's name without its extension ("Lecture 3 — Expectation.pdf" →
 *  "Lecture 3 — Expectation"). The Files page shows the full name. */
export function displayName(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/** A study file counts as studied once any of its facts came up in a lesson. */
export function isStudied(file: Pick<FileCoverage, "inLessons">): boolean {
	return file.inLessons > 0;
}

/** The coverage block's width weight: its fact count (a file whose facts
 *  aren't built yet still gets a sliver). */
export function blockWeight(file: Pick<FileCoverage, "facts">): number {
	return Math.max(file.facts, 1);
}

/** Where a coverage block's click goes: the Files page, at that file. */
export function fileHref(fileId: string): string {
	return `/class/files#file-${encodeURIComponent(fileId)}`;
}

/** A lesson's page. */
export function lessonHref(chatId: string): string {
	return `/chat/${encodeURIComponent(chatId)}`;
}

/** A question inside its lesson: the lesson page at the asking message's
 *  anchor (the same anchors the graph's message links use). */
export function questionHref(chatId: string, messageId: string): string {
	return `${lessonHref(chatId)}#${encodeURIComponent(messageAnchorId(messageId))}`;
}

/** Lessons with at least one graded answer (a row with no blocks says nothing). */
export function answeredLessons(lessons: readonly LessonProgress[]): LessonProgress[] {
	return lessons.filter((l) => l.answers.length > 0);
}

/** "<title> has the most misses." — the lesson with the most answers that
 *  weren't right (wrong + "I don't know"); the first one on a tie. Only
 *  when there are at least two lessons to compare and one has a miss. */
export function mostMissesTakeaway(lessons: readonly LessonProgress[]): string | null {
	if (lessons.length < 2) return null;
	let best: LessonProgress | null = null;
	let bestMisses = 0;
	for (const l of lessons) {
		const misses = l.answered - l.right;
		if (misses > bestMisses) {
			best = l;
			bestMisses = misses;
		}
	}
	return best ? `${best.title} has the most misses.` : null;
}

/** A level is overconfident (drawn red) when it is a "sure" level (4–5,
 *  the plan's definition) and was right less often than it claims. */
export function isLevelOverconfident(level: CalibrationLevel): boolean {
	return level.level >= 4 && level.rate !== null && level.rate * 100 < level.target;
}

/** "At 4 and 5 you're right less often than you think." — null when no
 *  level is overconfident. */
export function calibrationTakeaway(levels: readonly CalibrationLevel[]): string | null {
	const red = levels.filter(isLevelOverconfident).map((l) => String(l.level));
	if (red.length === 0) return null;
	const list = red.length === 1 ? red[0] : `${red.slice(0, -1).join(", ")} and ${red[red.length - 1]}`;
	return `At ${list} you're right less often than you think.`;
}

/** Calibration has something to show once any level has an answer. */
export function hasCalibration(levels: readonly CalibrationLevel[]): boolean {
	return levels.some((l) => l.answered > 0);
}
