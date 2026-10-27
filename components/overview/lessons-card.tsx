import { memo, useMemo } from "react";
import Link from "next/link";
import type { LessonProgress } from "@/src/core";
import { lessonHref, mostMissesTakeaway } from "./overview-model";
import { CARD, CARD_TITLE, OUTCOME_BG } from "./styles";

/**
 * HOW LESSONS WENT (Class Overview): one row per lesson with answers —
 * one block per answer in order (right / wrong / didn't know) and the
 * score. A row opens its lesson.
 */
export const LessonsCard = memo(function LessonsCard({ lessons }: { lessons: readonly LessonProgress[] }) {
	const takeaway = useMemo(() => mostMissesTakeaway(lessons), [lessons]);
	return (
		<section data-testid="overview-lessons" className={CARD}>
			<h2 className={CARD_TITLE}>How lessons went</h2>
			<ul className="-my-[7px] flex w-full flex-col">
				{lessons.map((lesson) => (
					<LessonRow key={lesson.chatId} lesson={lesson} />
				))}
			</ul>
			{takeaway && <p className="text-[13.5px] text-ink-3">{takeaway}</p>}
		</section>
	);
});

const LessonRow = memo(function LessonRow({ lesson }: { lesson: LessonProgress }) {
	return (
		<li>
			<Link
				href={lessonHref(lesson.chatId)}
				data-testid={`overview-lesson-${lesson.chatId}`}
				className="lh-press -mx-2 flex items-center gap-3.5 px-2 py-[7px] hover:bg-tone focus-visible:bg-tone"
			>
				<span className="w-[200px] shrink-0 truncate text-[14.5px] font-bold text-ink">{lesson.title}</span>
				<span className="flex min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
					{lesson.answers.map((a) => (
						<span key={a.toolCallId} data-outcome={a.outcome} className={`h-[18px] min-w-0.5 shrink basis-3.5 ${OUTCOME_BG[a.outcome]}`} />
					))}
				</span>
				<span className="shrink-0 font-mono text-[13px] tabular-nums text-ink-2">
					{lesson.right} / {lesson.answered}
				</span>
			</Link>
		</li>
	);
});
