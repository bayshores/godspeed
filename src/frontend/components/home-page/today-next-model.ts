/** The two blocks under Today's deadlines: the unfinished lessons and the topics to work on next,
 *  each across every open space. Pure. */
import type { LessonProgress, ProgressPayload, SpaceColor, TopicStatus } from "@/shared/core";
import { workOnNextList } from "@/frontend/components/home/suggestions-model";
import { stepBlocks } from "@/frontend/components/overview/lesson-record-model";

/** Rows in each block. */
const TODAY_NEXT_ROWS = 3;

/** A space that has progress to read: its id and colour. */
interface SpaceRef {
	id: string;
	color: SpaceColor;
}

export interface UnfinishedItem {
	lesson: LessonProgress;
	/** Null for a lesson with no space. */
	spaceId: string | null;
	/** The space's colour; undefined with no space. */
	color: SpaceColor | undefined;
	/** The lesson's steps, or a homework's problems. */
	blocks: { done: number; total: number } | null;
}

/** The newest unfinished lessons across the spaces and the lessons with no space, newest first. */
export function unfinishedAcross(spaces: readonly SpaceRef[], progress: ReadonlyMap<string, ProgressPayload>, noSpace: ProgressPayload | null): UnfinishedItem[] {
	const sources: { spaceId: string | null; color: SpaceColor | undefined; payload: ProgressPayload }[] = spaces.flatMap((s) => {
		const payload = progress.get(s.id);
		return payload ? [{ spaceId: s.id, color: s.color, payload }] : [];
	});
	if (noSpace) sources.push({ spaceId: null, color: undefined, payload: noSpace });
	return sources
		.flatMap(({ spaceId, color, payload }) => {
			const problemsOf = (deadlineId: string) => payload.deadlines.find((d) => d.id === deadlineId)?.problems;
			return payload.lessons.filter((l) => l.unfinished).map((lesson) => ({ lesson, spaceId, color, blocks: stepBlocks(lesson, problemsOf) }));
		})
		.sort((a, b) => b.lesson.updatedAt.localeCompare(a.lesson.updatedAt))
		.slice(0, TODAY_NEXT_ROWS);
}

export interface TopicItem {
	spaceId: string;
	color: SpaceColor;
	topicId: string;
	name: string;
	status: TopicStatus;
	/** The right rate, 0 to 1; null before the first answer. */
	rate: number | null;
}

/** Weak first, then shaky, then the rest. */
const STATUS_ORDER: Record<TopicStatus, number> = { weak: 0, shaky: 1, untested: 2, strong: 2 };

/** The topics each space's Study page offers to work on next, merged: weak, then shaky, then the
 *  rest, the lowest rate first (untested counts as 0). A tie keeps the space order. */
export function topicsToWorkOn(spaces: readonly SpaceRef[], progress: ReadonlyMap<string, ProgressPayload>): TopicItem[] {
	const items = spaces.flatMap((s): TopicItem[] => {
		const payload = progress.get(s.id);
		if (!payload) return [];
		const rates = new Map(payload.topics.map((t) => [t.id, t.rate]));
		return workOnNextList(payload).map((w) => ({ spaceId: s.id, color: s.color, topicId: w.topicId, name: w.name, status: w.status, rate: rates.get(w.topicId) ?? null }));
	});
	return items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.rate ?? 0) - (b.rate ?? 0)).slice(0, TODAY_NEXT_ROWS);
}
