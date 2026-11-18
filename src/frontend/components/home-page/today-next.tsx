import { Link } from "react-router";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { keyLabel } from "@/frontend/components/overview/lesson-record-model";
import { ROW, StepBlocks } from "@/frontend/components/overview/lesson-rows";
import { STATUS_LEGEND, lessonHref } from "@/frontend/components/overview/overview-model";
import { spaceColorVar } from "@/frontend/components/space-color";
import { Pane } from "@/frontend/components/ui/pane";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { cn } from "@/frontend/lib/utils";
import type { TopicItem, UnfinishedItem } from "./today-next-model";

/** The key of a block's first row; the row's own click does the work, so it lights and sinks with the row. */
const ROW_KEY = "lh-btn shrink-0 group-hover:bg-(--lh-key-hover) group-active:border-t-(length:--lh-lip) group-active:border-b-0";

const ROW_CLASS = "flex w-full flex-col gap-2 px-3 py-2 text-left";

/** A space's colour square; grey for a lesson with no space. */
function Square({ color }: { color: UnfinishedItem["color"] }) {
	return <span aria-hidden className="mt-[7px] size-2.5 shrink-0" style={{ background: color ? spaceColorVar(color) : "var(--border)" }} />;
}

/**
 * The blocks under Today's deadlines: UNFINISHED lessons (newest first) and
 * the topics to WORK ON NEXT, across every open space. A block with nothing
 * to show is not drawn. Each row is its own click; only a block's first row
 * carries a key.
 */
export function TodayNext({
	unfinished,
	topics,
	busy,
	onOpenSpace,
	onStudyTopic,
}: {
	unfinished: readonly UnfinishedItem[];
	topics: readonly TopicItem[];
	/** A lesson is starting. */
	busy: boolean;
	onOpenSpace: (spaceId: string) => void;
	onStudyTopic: (spaceId: string, topicId: string) => void;
}) {
	if (unfinished.length === 0 && topics.length === 0) return null;
	// Two blocks sit side by side from 700 points of room; one keeps a half, never a stretched row.
	return (
		<div className="grid gap-(--lh-gap) @[700px]/page:grid-cols-2">
			{unfinished.length > 0 && (
				<Pane data-testid="today-unfinished" className="lh-card self-start">
					<div className="lh-card-head">
						<h2 className="lh-card-title">Unfinished</h2>
					</div>
					<ul className="-mx-3 flex flex-col gap-1">
						{unfinished.map(({ lesson, spaceId, color, blocks }, i) => (
							<li key={lesson.chatId}>
								<Link
									to={lessonHref(lesson.chatId)}
									data-testid="today-unfinished-row"
									onClick={() => spaceId && onOpenSpace(spaceId)}
									className={cn(ROW, ROW_CLASS)}
								>
									<span className="flex items-start gap-2.5">
										<Square color={color} />
										<span title={lesson.title} className="line-clamp-2 min-w-0 flex-1 text-[17px] leading-snug text-ink">
											{lesson.title}
										</span>
										{/* With no steps to draw, the key sits on the title's line. */}
										{i === 0 && !blocks && <span className={ROW_KEY}>{keyLabel(lesson)}</span>}
									</span>
									{blocks && (
										<span className="flex items-center justify-between gap-3 pl-[22px]">
											<span className="flex items-center gap-2.5">
												<StepBlocks done={blocks.done} total={blocks.total} />
												<span className="font-count text-[15px] text-ink-2">
													{blocks.done} of {blocks.total}
												</span>
											</span>
											{i === 0 && <span className={ROW_KEY}>{keyLabel(lesson)}</span>}
										</span>
									)}
								</Link>
							</li>
						))}
					</ul>
				</Pane>
			)}
			{topics.length > 0 && (
				<Pane data-testid="today-work-on-next" className="lh-card self-start">
					<div className="lh-card-head">
						<h2 className="lh-card-title">Work on next</h2>
					</div>
					<ul className="-mx-3 flex flex-col gap-1">
						{topics.map((t, i) => (
							<li key={`${t.spaceId}:${t.topicId}`}>
								<button type="button" data-testid="today-topic-row" disabled={busy} onClick={() => onStudyTopic(t.spaceId, t.topicId)} className={cn(ROW, ROW_CLASS)}>
									<span className="flex items-start gap-2.5">
										<Square color={t.color} />
										<span className="min-w-0 flex-1 truncate text-[17px] leading-snug text-ink">
											<InlineMath text={t.name} />
										</span>
										<span className="shrink-0 text-[15px] leading-snug text-ink-2">{STATUS_LEGEND.find((s) => s.key === t.status)?.label}</span>
									</span>
									<span className="flex items-center justify-between gap-3 pl-[22px]">
										<ProgressBar share={t.rate ?? 0} className="max-w-[240px] flex-1" />
										{i === 0 && <span className={ROW_KEY}>Study</span>}
									</span>
								</button>
							</li>
						))}
					</ul>
				</Pane>
			)}
		</div>
	);
}
