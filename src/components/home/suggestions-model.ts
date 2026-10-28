/**
 * Home's "Suggested for <class>" rows (redesign Phase 6), derived from the
 * class's ProgressPayload (src/core/progress.ts). Pure, unit-tested.
 *
 *  - Continue: the class's most recently active lesson (lessons come
 *    newest first). The app keeps no "finished" flag, so the newest
 *    lesson is the one to continue.
 *  - Next up: the earliest study file not studied yet (payload.nextUp).
 *  - Work on next: the first two topics of the soonest open deadline
 *    that has files, or the class-wide list when none is ahead.
 */
import type {
	DeadlineProgress,
	FileCoverage,
	LessonProgress,
	LhMessage,
	PlanTree,
	ProgressPayload,
	TopicProgress,
	WorkOnNextItem,
} from "@/core";
import { planStepBar, projectView } from "@/core";

/** How many "Work on next" rows Home shows. */
export const WORK_ON_NEXT_ROWS = 2;

export type Suggestion =
	| { kind: "continue"; lesson: LessonProgress }
	| { kind: "next-up"; file: FileCoverage }
	| { kind: "work-on-next"; item: WorkOnNextItem; topic: TopicProgress };

/** The soonest deadline that hasn't passed, isn't done and covers files
 *  (deadlines come soonest first). */
export function upcomingDeadline(deadlines: readonly DeadlineProgress[]): DeadlineProgress | null {
	return deadlines.find((d) => d.daysUntil >= 0 && !d.done && d.files.length > 0) ?? null;
}

/** The "Work on next" list Home draws from. */
export function workOnNextList(data: Pick<ProgressPayload, "deadlines" | "overall">): WorkOnNextItem[] {
	return upcomingDeadline(data.deadlines)?.workOnNext ?? data.overall.workOnNext;
}

export function homeSuggestions(data: ProgressPayload | null): Suggestion[] {
	if (!data) return [];
	const out: Suggestion[] = [];
	const latest = data.lessons[0];
	if (latest) out.push({ kind: "continue", lesson: latest });
	if (data.nextUp) out.push({ kind: "next-up", file: data.nextUp });
	const topics = new Map(data.topics.map((t) => [t.id, t]));
	for (const item of workOnNextList(data)) {
		if (out.filter((s) => s.kind === "work-on-next").length >= WORK_ON_NEXT_ROWS) break;
		const topic = topics.get(item.topicId);
		if (topic) out.push({ kind: "work-on-next", item, topic });
	}
	return out;
}

/** A row's React key. */
export function suggestionKey(s: Suggestion): string {
	if (s.kind === "continue") return `continue:${s.lesson.chatId}`;
	if (s.kind === "next-up") return `next-up:${s.file.fileId}`;
	return `work:${s.item.topicId}`;
}

/** Where the lesson's plan is: "step 3 / 11" (the same position the
 *  lesson's step bar shows). */
export interface LessonStep {
	position: number;
	total: number;
}

/** The slice of GET /api/chats/:id the step needs. */
export interface LessonStepRecord {
	kind?: "teach" | "practice";
	tree?: PlanTree | null;
	messages: readonly LhMessage[];
}

/** The lesson's plan position; null for practice lessons and lessons
 *  with no plan yet. */
export function lessonStep(record: LessonStepRecord): LessonStep | null {
	if (record.kind === "practice" || !record.tree) return null;
	const { steps, currentIndex } = planStepBar(record.tree, projectView(record.messages));
	if (steps.length === 0) return null;
	const position = currentIndex >= 0 ? currentIndex + 1 : steps.filter((s) => s.status === "visited").length;
	return { position, total: steps.length };
}
