/**
 * Home's "Suggested for <space>" rows, derived from the
 * space's ProgressPayload (src/shared/core/progress.ts). Pure, unit-tested.
 *
 *  - Continue: the space's most recently active lesson (lessons come
 *    newest first). The app keeps no "finished" flag, so the newest
 *    lesson is the one to continue.
 *  - Next up: in a space with a path, the topic its Study takes; else the
 *    earliest study file not studied yet (payload.nextUp).
 *  - Work on next: the first two topics of the soonest open deadline
 *    that has files, or the space-wide list when none is ahead.
 */
import type {
	DeadlineProgress,
	FileCoverage,
	LessonKind,
	LessonProgress,
	LhMessage,
	PathTopicProgress,
	PlanTree,
	ProgressPayload,
	TopicProgress,
	WorkOnNextItem,
} from "@/shared/core";
import { pathNext, planStepBar, projectView } from "@/shared/core";
import { rightLabel } from "@/frontend/components/deadline/deadline-model";

/** How many "Work on next" rows Home shows. */
export const WORK_ON_NEXT_ROWS = 2;

export type Suggestion =
	| { kind: "continue"; lesson: LessonProgress }
	| { kind: "next-up"; file: FileCoverage }
	| { kind: "path"; topic: PathTopicProgress; position: number; total: number }
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
	const onPath = data.path ? pathNext(data.path) : null;
	if (data.path && onPath) out.push({ kind: "path", topic: onPath.topic, position: onPath.position, total: data.path.topics.length });
	else if (data.nextUp) out.push({ kind: "next-up", file: data.nextUp });
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
	if (s.kind === "path") return `path:${s.topic.id}`;
	return `work:${s.item.topicId}`;
}

/** Where the lesson's plan is: "step 3 of 11" (the same position the
 *  lesson's step bar shows). */
export interface LessonStep {
	position: number;
	total: number;
}

/** Under a row's name: what kind of suggestion it is and its one number
 *  ("Continue, step 2 of 4", "Next up, 12 facts", "Next up, 4 of 28 on
 *  the path", "Work on next, 0 of 1 right"). `step` is the Continue
 *  lesson's, once read. */
export function suggestionLine(s: Suggestion, step: LessonStep | null): string {
	if (s.kind === "continue") return step ? `Continue, step ${step.position} of ${step.total}` : "Continue";
	if (s.kind === "next-up") return `Next up, ${s.file.facts} ${s.file.facts === 1 ? "fact" : "facts"}`;
	if (s.kind === "path") return `Next up, ${s.position} of ${s.total} on the path`;
	return `Work on next, ${rightLabel(s.topic)}`;
}

/** The slice of GET /api/chats/:id the step needs. */
export interface LessonStepRecord {
	kind?: LessonKind;
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
