/**
 * The Study page's "Suggested for <space>" rows, derived from the
 * space's ProgressPayload (src/shared/core/progress.ts). Pure, unit-tested.
 *
 *  - Continue: the newest lesson the server marks unfinished (lessons
 *    come newest first); with none, there is no Continue row.
 *  - Next up: in a space with a path, the topic its Study takes; else the
 *    earliest study file not studied yet (payload.nextUp).
 *  - Work on next: the first two topics of the soonest open deadline
 *    that has files, or the space-wide list when none is ahead.
 */
import type {
	DeadlineProgress,
	FileCoverage,
	LessonProgress,
	PathTopicProgress,
	ProgressPayload,
	TopicProgress,
	WorkOnNextItem,
} from "@/shared/core";
import { pathNext } from "@/shared/core";
import { rightLabel } from "@/frontend/components/deadline/deadline-model";

/** How many "Work on next" rows the Study page shows. */
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

/** The "Work on next" list the Study page draws from. */
export function workOnNextList(data: Pick<ProgressPayload, "deadlines" | "overall">): WorkOnNextItem[] {
	return upcomingDeadline(data.deadlines)?.workOnNext ?? data.overall.workOnNext;
}

export function studyPageSuggestions(data: ProgressPayload | null): Suggestion[] {
	if (!data) return [];
	const out: Suggestion[] = [];
	const unfinished = data.lessons.find((l) => l.unfinished);
	if (unfinished) out.push({ kind: "continue", lesson: unfinished });
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

/** Under a row's name: what kind of suggestion it is and its one number
 *  ("Continue, step 2 of 4", "Next up, 12 facts", "Next up, 4 of 28 on
 *  the path", "Work on next, 0 of 1 right"). A Continue lesson's step is
 *  the one its step bar shows. */
export function suggestionLine(s: Suggestion): string {
	if (s.kind === "continue") {
		const { step } = s.lesson;
		return step && step.done > 0 ? `Continue, step ${step.done} of ${step.total}` : "Continue";
	}
	if (s.kind === "next-up") return `Next up, ${s.file.facts} ${s.file.facts === 1 ? "fact" : "facts"}`;
	if (s.kind === "path") return `Next up, ${s.position} of ${s.total} on the path`;
	return `Work on next, ${rightLabel(s.topic)}`;
}
