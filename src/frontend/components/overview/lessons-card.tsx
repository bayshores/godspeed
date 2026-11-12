import { memo, useMemo } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { lessonHref, mostMissesTakeaway } from "./overview-model";
import { OUTCOME_BG, ROW, TITLE } from "./styles";

/**
 * HOW LESSONS WENT (Progress): one row per lesson with answers: one
 * square per answer in order (right / wrong / didn't know) and the score.
 * A row opens its lesson.
 */
export const LessonsCard = memo(function LessonsCard({ lessons }: { lessons: readonly LessonProgress[] }) {
	const takeaway = useMemo(() => mostMissesTakeaway(lessons), [lessons]);
	return (
		<Pane data-testid="overview-lessons" className="flex flex-col px-6 pt-[18px] pb-4">
			<h2 className={TITLE}>How lessons went</h2>
			<ul className="flex flex-col">
				{lessons.map((lesson) => (
					<LessonRow key={lesson.chatId} lesson={lesson} />
				))}
			</ul>
			{takeaway && <p className="pt-3 text-[15px] text-ink-2">{takeaway}</p>}
		</Pane>
	);
});

const LessonRow = memo(function LessonRow({ lesson }: { lesson: LessonProgress }) {
	return (
		<li>
			<Link to={lessonHref(lesson.chatId)} data-testid={`overview-lesson-${lesson.chatId}`} className={cn(ROW, "gap-4 py-[11px]")}>
				<span title={lesson.title} className="min-w-0 flex-1 truncate text-lg text-ink">
					{lesson.title}
				</span>
				<span className="flex max-w-[45%] shrink-0 flex-wrap justify-end gap-[3px]" aria-hidden>
					{lesson.answers.map((a) => (
						<span key={a.toolCallId} data-outcome={a.outcome} className={cn("size-3", OUTCOME_BG[a.outcome])} />
					))}
				</span>
				<span className="w-16 shrink-0 font-count text-[15px] text-ink tabular-nums">
					{lesson.right} of {lesson.answered}
				</span>
				<PixelIcon name="chevron" className="h-3.5 text-ink" />
			</Link>
		</li>
	);
});
