/**
 * The Progress tab's small derived values.
 * Pure: every number comes from the ProgressPayload (src/shared/core/progress.ts);
 * this file only shapes it for the page and is unit-tested on its own.
 */
import type { CalibrationLevel, DeadlineProgress, LessonProgress, StatusCounts } from "@/shared/core";
import { hasProblems, messageAnchorId, rightWords } from "@/shared/core";
import { byDue, isOverdue } from "@/frontend/components/deadlines-model";

/** A file's name without its extension ("Lecture 3 — Expectation.pdf" →
 *  "Lecture 3 — Expectation"). The Files page shows the full name. */
export function displayName(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
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

/** A lesson title quoted, its trailing punctuation dropped so the
 *  sentence around it reads right. */
const quoted = (title: string) => `“${title.trim().replace(/[.!?,;:\s]+$/, "")}”`;

/** "“<title>” has the most misses." — the lesson with the most answers
 *  that weren't right (wrong + "I don't know"; one solved with hints is no miss). A tie names both lessons,
 *  or says how many tie. Only when there are at least two lessons to
 *  compare and one has a miss. */
export function mostMissesTakeaway(lessons: readonly LessonProgress[]): string | null {
	if (lessons.length < 2) return null;
	const misses = (l: LessonProgress) => l.answered - l.right - (l.hinted ?? 0);
	const most = Math.max(...lessons.map(misses));
	if (most <= 0) return null;
	const top = lessons.filter((l) => misses(l) === most);
	const each = `${most} ${most === 1 ? "miss" : "misses"}`;
	if (top.length === 1) return `${quoted(top[0]!.title)} has the most misses.`;
	if (top.length === lessons.length) return lessons.length === 2 ? `Both lessons have ${each}.` : `All ${lessons.length} lessons have ${each}.`;
	if (top.length === 2) return `${quoted(top[0]!.title)} and ${quoted(top[1]!.title)} have the most misses, ${each} each.`;
	return `${top.length} lessons tie for the most misses, ${each} each.`;
}

/** A level is overconfident (drawn red) when it is a "sure" level (4–5)
 *  and was right less often than it claims. */
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

const DAY_MS = 86_400_000;

/** When the teacher's note was written, as "after … lesson": today's,
 *  yesterday's, a weekday's within the week, then the date. */
export function noteWhen(at: string, nowMs: number): string {
	const written = new Date(at);
	if (Number.isNaN(written.getTime())) return "";
	const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((startOf(new Date(nowMs)) - startOf(written)) / DAY_MS);
	if (days <= 0) return "after today's lesson";
	if (days === 1) return "after yesterday's lesson";
	if (days < 7) return `after ${written.toLocaleDateString("en-US", { weekday: "long" })}'s lesson`;
	return `after the ${written.toLocaleDateString("en-US", { month: "short", day: "numeric" })} lesson`;
}

/** The deadline's own page. */
export function deadlineHref(id: string): string {
	return `/space/deadline/${encodeURIComponent(id)}`;
}

/** 0.38 → 38. */
export function percent(rate: number): number {
	return Math.round(rate * 100);
}

type Due = Pick<DeadlineProgress, "id" | "kind" | "name" | "date" | "time" | "done">;

/** The deadlines still ahead (open, not past due), soonest first. */
export function upcomingDeadlines<T extends Due>(deadlines: readonly T[], nowMs: number): T[] {
	return byDue(deadlines.filter((d) => !d.done && !isOverdue(d, nowMs)));
}

/** How far a deadline is, in words: "2 of 7 problems done", or "19% ready"
 *  for one with no problems; null with nothing to count. */
export function progressWords(d: Pick<DeadlineProgress, "problems" | "ready">): string | null {
	if (d.problems) return `${d.problems.done} of ${d.problems.total} problems done`;
	return d.ready !== null ? `${percent(d.ready)}% ready` : null;
}

/** The topic statuses in the words the learner sees, strongest first, with
 *  a right rate that draws each one's ramp color. */
export const STATUS_LEGEND: readonly { key: keyof StatusCounts; label: string; rate: number | null }[] = [
	{ key: "strong", label: "strong", rate: 0.9 },
	{ key: "shaky", label: "shaky", rate: 0.7 },
	{ key: "weak", label: "weak", rate: 0.3 },
	{ key: "untested", label: "not tested", rate: null },
];

/** The same as a share, 0 to 1; null with nothing to count. */
export function progressShare(d: Pick<DeadlineProgress, "problems" | "ready">): number | null {
	if (d.problems) return d.problems.total > 0 ? d.problems.done / d.problems.total : 0;
	return d.ready;
}

/** The next deadline's button: homework and projects are worked on, tests
 *  are studied for. */
export function nextDeadlineButton(d: Pick<DeadlineProgress, "kind" | "name">): string {
	return `${hasProblems(d.kind) ? "Work on" : "Study for"} ${d.name}`;
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(names: readonly string[]): string {
	if (names.length <= 1) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface MostNeeded {
	topicId: string;
	name: string;
	/** The deadlines that cover it, soonest first. */
	deadlines: string[];
}

/** The open-deadline topic with the lowest right rate (untested counts as
 *  0); ties go to the topic more deadlines cover, then by name. */
export function mostNeeded(upcoming: readonly Pick<DeadlineProgress, "name" | "topics">[]): MostNeeded | null {
	const byTopic = new Map<string, { name: string; rate: number; deadlines: string[] }>();
	for (const d of upcoming) {
		for (const t of d.topics) {
			const entry = byTopic.get(t.id);
			if (entry) {
				if (!entry.deadlines.includes(d.name)) entry.deadlines.push(d.name);
			} else byTopic.set(t.id, { name: t.name, rate: t.rate ?? 0, deadlines: [d.name] });
		}
	}
	let best: (MostNeeded & { rate: number }) | null = null;
	for (const [topicId, e] of byTopic) {
		const better =
			!best ||
			e.rate < best.rate ||
			(e.rate === best.rate && (e.deadlines.length > best.deadlines.length || (e.deadlines.length === best.deadlines.length && e.name.localeCompare(best.name) < 0)));
		if (better) best = { topicId, name: e.name, rate: e.rate, deadlines: e.deadlines };
	}
	return best ? { topicId: best.topicId, name: best.name, deadlines: best.deadlines } : null;
}

/** "Pick up where you left off" lists this many lessons. */
const RECENT_LESSONS = 3;

/** The lessons worked on last, newest first. */
export function recentLessons(lessons: readonly LessonProgress[]): LessonProgress[] {
	return [...lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT_LESSONS);
}

/** Under a lesson's title: "4 of 6 right", "4 of 6 right, 1 with hints";
 *  "No answers yet" before the first. */
export function scoreLine(l: Pick<LessonProgress, "right" | "hinted" | "answered">): string {
	return l.answered > 0 ? rightWords(l) : "No answers yet";
}
