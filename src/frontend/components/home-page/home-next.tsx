import { Link } from "react-router";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { keyLabel } from "@/frontend/components/overview/lesson-record-model";
import { ROW, StepBlocks } from "@/frontend/components/overview/lesson-rows";
import { STATUS_LEGEND, lessonHref } from "@/frontend/components/overview/overview-model";
import { spaceColorVar } from "@/frontend/components/space-color";
import { Pane } from "@/frontend/components/ui/pane";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { cn } from "@/frontend/lib/utils";
import type { TopicItem, UnfinishedItem } from "./home-next-model";

const ROW_CLASS = "flex w-full flex-col gap-2 px-3 py-2 text-left";

/** A space's colour square; grey for a lesson with no space. */
function Square({ color }: { color: UnfinishedItem["color"] }) {
	return <span aria-hidden className="mt-[7px] size-2.5 shrink-0" style={{ background: color ? spaceColorVar(color) : "var(--border)" }} />;
}

/**
 * The blocks under Home's deadlines: UNFINISHED lessons (newest first) and
 * the topics to WORK ON NEXT, across every open space. A block with nothing
 * to show is not drawn. Each row is its own click; the key in a block's head
 * does what its first row does.
 */
export function HomeNext({
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
	// Two blocks sit side by side from 700 points of room; one alone takes the row.
	return (
		<div className="grid gap-(--lh-gap) @[700px]/page:grid-cols-2 @[1100px]/page:col-span-2">
			{unfinished.length > 0 && (
				<Pane data-testid="today-unfinished" className="lh-card self-start only:col-span-full">
					<div className="lh-card-head">
						<h2 className="lh-card-title">Unfinished</h2>
						<Link
							to={lessonHref(unfinished[0]!.lesson.chatId)}
							data-testid="today-unfinished-key"
							onClick={() => unfinished[0]!.spaceId && onOpenSpace(unfinished[0]!.spaceId)}
							className="lh-btn shrink-0"
						>
							{keyLabel(unfinished[0]!.lesson)}
						</Link>
					</div>
					<ul className="-mx-3 flex flex-col gap-1">
						{unfinished.map(({ lesson, spaceId, color, blocks }) => (
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
									</span>
									{blocks && (
										<span className="flex items-center gap-2.5 pl-[22px]">
											<StepBlocks done={blocks.done} total={blocks.total} />
											<span className="font-count text-[15px] text-ink-2">
												{blocks.done} of {blocks.total}
											</span>
										</span>
									)}
								</Link>
							</li>
						))}
					</ul>
				</Pane>
			)}
			{topics.length > 0 && (
				<Pane data-testid="today-work-on-next" className="lh-card self-start only:col-span-full">
					<div className="lh-card-head">
						<h2 className="lh-card-title">Work on next</h2>
						<button type="button" data-testid="today-topic-key" disabled={busy} onClick={() => onStudyTopic(topics[0]!.spaceId, topics[0]!.topicId)} className="lh-btn shrink-0">
							Study
						</button>
					</div>
					<ul className="-mx-3 flex flex-col gap-1">
						{topics.map((t) => (
							<li key={`${t.spaceId}:${t.topicId}`}>
								<button type="button" data-testid="today-topic-row" disabled={busy} onClick={() => onStudyTopic(t.spaceId, t.topicId)} className={cn(ROW, ROW_CLASS)}>
									<span className="flex items-start gap-2.5">
										<Square color={t.color} />
										<span className="min-w-0 flex-1 truncate text-[17px] leading-snug text-ink">
											<InlineMath text={t.name} />
										</span>
										<span className="shrink-0 text-[15px] leading-snug text-ink-2">{STATUS_LEGEND.find((s) => s.key === t.status)?.label}</span>
									</span>
									<span className="flex pl-[22px]">
										<ProgressBar share={t.rate ?? 0} className="max-w-[240px] flex-1" />
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
