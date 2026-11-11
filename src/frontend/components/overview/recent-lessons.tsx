import { memo } from "react";
import Link from "next/link";
import type { LessonProgress } from "@/shared/core";
import { lessonAge } from "@/frontend/components/lessons/lessons-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { lessonHref, scoreLine } from "./overview-model";
import { ROW, TITLE } from "./styles";

/** PICK UP WHERE YOU LEFT OFF (Progress): the lessons worked on last, each
 *  with its score and age. A row opens its lesson. */
export const RecentLessons = memo(function RecentLessons({
	lessons,
	color,
	nowMs,
}: {
	lessons: readonly LessonProgress[];
	/** The class's color. */
	color: string;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
}) {
	return (
		<section data-testid="recent-lessons" className="flex flex-col">
			<h2 className={TITLE}>Pick up where you left off</h2>
			<ul className="flex flex-col">
				{lessons.map((l) => (
					<li key={l.chatId}>
						<Link href={lessonHref(l.chatId)} prefetch={false} data-testid={`recent-lesson-${l.chatId}`} className={cn(ROW, "py-3.5")}>
							<span aria-hidden className="h-[38px] w-2 shrink-0" style={{ background: color }} />
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span title={l.title} className="truncate text-[17px] text-ink">
									{l.title}
								</span>
								<span className="text-base text-ink-2">{scoreLine(l)}</span>
							</span>
							{nowMs !== null && <span className="shrink-0 font-count text-[15px] text-ink-2">{lessonAge(l.updatedAt, new Date(nowMs))}</span>}
							<PixelIcon name="chevron" className="h-3.5 text-ink" />
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
});
