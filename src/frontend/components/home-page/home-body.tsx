import { useMemo, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { LoadingBox, useWaited } from "@/frontend/components/loading";
import type { DeadlineProgress, ProgressPayload, SpaceSummary } from "@/shared/core";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { Pane } from "@/frontend/components/ui/pane";
import { DeadlinesCard } from "./deadlines-card";
import { mainRowId, shownCard, type HomeLists } from "./home-page-model";
import { NextCard } from "./next-card";
import { SpaceList } from "./space-list";
import { StudiedLine } from "./studied-line";
import { HomeNext } from "./home-next";
import { topicsToWorkOn, unfinishedAcross } from "./home-next-model";

interface HomeBodyProps {
	/** Null before the first minute tick. */
	nowMs: number | null;
	/** Everything the first view needs is in, so nothing reflows under the reader. */
	ready: boolean;
	/** The open spaces. */
	spaces: readonly SpaceSummary[];
	/** Null when the deadlines failed to load. */
	lists: HomeLists | null;
	deadlineProgress: ReadonlyMap<string, DeadlineProgress>;
	spacesProgress: ReadonlyMap<string, ProgressPayload>;
	/** The lessons with no space; their answers count in the week line. */
	noSpaceProgress: ProgressPayload | null;
	/** Why a space's progress failed to load. */
	progressErrors: ReadonlyMap<string, string>;
	newFiles: ReadonlyMap<string, string>;
	/** The id of the lesson start in flight, if any. */
	busyOn: string | null;
	/** Why the last lesson start failed. */
	lessonError: string | null;
	onStart: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
	onUndo: (d: OpenDeadline) => void;
	onRetry: () => void;
	onAddSpace: () => void;
	onAddDeadline: (spaceId: string) => void;
	onOpenSpace: (spaceId: string) => void;
	/** Starts a lesson on one topic of a space. */
	onStudyTopic: (spaceId: string, topicId: string) => void;
}

/**
 * TODAY (the render seam of home-page.tsx), from the top of the window
 * down, each part lighter than the one before: the app's name and the days
 * studied, the card with the deadline picked in the week (the next thing
 * to do until one is picked), the week with Later, the lessons left unfinished and the topics to work on next, then the spaces. With no
 * space yet, the spaces card alone, with the key for the first.
 */
export function HomeBody(p: HomeBodyProps) {
	// A pick that leaves the lists falls back to the next thing to do.
	const [picked, setPicked] = useState<string | null>(null);
	const waited = useWaited(p.ready && p.nowMs !== null);
	const card = p.lists && p.nowMs !== null ? shownCard(p.lists, picked, mainRowId(p.lists.today, p.deadlineProgress, p.nowMs)) : null;
	const color = (d: OpenDeadline) => p.spaces.find((s) => s.id === d.spaceId)?.color;
	const unfinished = useMemo(() => unfinishedAcross(p.spaces, p.spacesProgress, p.noSpaceProgress), [p.spaces, p.spacesProgress, p.noSpaceProgress]);
	const topics = useMemo(() => topicsToWorkOn(p.spaces, p.spacesProgress), [p.spaces, p.spacesProgress]);
	return (
		<div className="@container/page lh-page flex flex-col gap-(--lh-head-gap) pt-(--lh-page-top) pb-(--lh-page-end)">
			<header className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
				<h1 data-testid="today-title" className="lh-page-title">
					godspeed
				</h1>
				{p.ready && p.nowMs !== null && p.spaces.length > 0 && <StudiedLine progress={p.spacesProgress} noSpace={p.noSpaceProgress} nowMs={p.nowMs} />}
			</header>
			{!p.ready || p.nowMs === null ? (
				<LoadingBox data-testid="home-loading" className="h-[320px] bg-panel" />
			) : p.spaces.length === 0 ? (
				<Pane className="lh-card">
					<div className="lh-card-head">
						<h2 className="lh-card-title">Your spaces</h2>
						<button type="button" data-testid="today-add-space" onClick={p.onAddSpace} className="lh-btn lh-btn-main">
							Add a space
						</button>
					</div>
					<p data-testid="today-empty" className="text-[17px] text-ink-2">
						None yet. A space holds one subject&apos;s files, deadlines and lessons.
					</p>
				</Pane>
			) : (
				<>
					{/* Wide, the spaces take a column beside the card and the week and end level with them; the blocks under run the page's width. */}
					<div className={cn("grid gap-(--lh-gap) @[1100px]/page:grid-cols-[minmax(0,1fr)_340px]", waited && "lh-set")}>
						<div className="flex min-w-0 flex-col gap-(--lh-gap)">
							{p.lessonError && (
								<p role="alert" className="text-[15px] text-ans-wrong">
									{p.lessonError}
								</p>
							)}
							{card && (
								<NextCard
									deadline={card}
									progress={p.deadlineProgress.get(card.id)}
									color={color(card)}
									nowMs={p.nowMs}
									busyOn={p.busyOn}
									onStart={p.onStart}
									onDone={p.onDone}
									onUndo={p.onUndo}
								/>
							)}
							<DeadlinesCard spaces={p.spaces} lists={p.lists} nowMs={p.nowMs} picked={card?.id ?? null} onPick={(d) => setPicked(d.id)} onRetry={p.onRetry} onAdd={p.onAddDeadline} />
							<p aria-live="polite" data-testid="today-showing" className="sr-only">
								{picked !== null && card ? `Showing ${card.name}` : ""}
							</p>
						</div>
						<HomeNext unfinished={unfinished} topics={topics} busyOn={p.busyOn} onOpenSpace={p.onOpenSpace} onStudyTopic={p.onStudyTopic} />
						<div className="grid @[1100px]/page:col-start-2 @[1100px]/page:row-start-1">
							<SpaceList spaces={p.spaces} progress={p.spacesProgress} errors={p.progressErrors} newFiles={p.newFiles} onOpen={p.onOpenSpace} />
						</div>
					</div>
				</>
			)}
		</div>
	);
}
