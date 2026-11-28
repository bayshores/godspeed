import { useMemo, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { LoadingBox, useWaited } from "@/frontend/components/loading";
import type { DeadlineProgress, ProgressPayload, RhythmGap, SpaceSummary } from "@/shared/core";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { useLeavingList } from "@/frontend/components/presence";
import { useSheetGlide } from "@/frontend/components/use-sheet-glide";
import { Pane } from "@/frontend/components/ui/pane";
import { DeadlinesCard } from "./deadlines-card";
import { mainRowId, shownCard, type HomeLists } from "./home-page-model";
import { NextCard, NextGap } from "./next-card";
import type { WeekPick } from "./week-columns-model";
import { SpaceList } from "./space-list";
import { StudiedLine } from "./studied-line";
import { StudyLine } from "./study-line";
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
	/** The open spaces' deadlines that look missing, drawn as outlines in the week. */
	outlines: readonly RhythmGap[];
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
	/** Starts a lesson on a typed topic in one space. */
	onStudyTyped: (spaceId: string, title: string) => void;
}

/**
 * TODAY (the render seam of home-page.tsx), from the top of the window
 * down, each part lighter than the one before: the app's name and the days
 * studied, the card with the deadline or outline picked in the week (the
 * next thing to do until one is picked; never an outline), the week with Later, the lessons left unfinished and the topics to work on next, then the spaces. With no
 * space yet, the spaces card alone, with the key for the first.
 */
export function HomeBody(p: HomeBodyProps) {
	// A pick that leaves the lists falls back to the next thing to do.
	const [picked, setPicked] = useState<WeekPick | null>(null);
	const waited = useWaited(p.ready && p.nowMs !== null);
	const outlines = useLeavingList(p.outlines);
	const cardGlide = useSheetGlide(false, true);
	const gap = picked?.kind === "gap" ? (p.outlines.find((g) => g.key === picked.key) ?? null) : null;
	// An outline that has gone is let go, so one that comes back is never shown unasked.
	if (picked?.kind === "gap" && !gap) setPicked(null);
	const card = !gap && p.lists && p.nowMs !== null ? shownCard(p.lists, picked?.kind === "deadline" ? picked.key : null, mainRowId(p.lists.today, p.deadlineProgress, p.nowMs)) : null;
	const shown: WeekPick | null = gap ? { kind: "gap", key: gap.key } : card ? { kind: "deadline", key: card.id } : null;
	const space = (id: string) => p.spaces.find((s) => s.id === id);
	const color = (d: OpenDeadline) => space(d.spaceId)?.color;
	const unfinished = useMemo(() => unfinishedAcross(p.spaces, p.spacesProgress, p.noSpaceProgress), [p.spaces, p.spacesProgress, p.noSpaceProgress]);
	const topics = useMemo(() => topicsToWorkOn(p.spaces, p.spacesProgress), [p.spaces, p.spacesProgress]);
	const head = p.ready && p.nowMs !== null && p.spaces.length > 0 ? p.nowMs : null;
	return (
		<div className="@container/page lh-page flex flex-col gap-(--lh-head-gap) pt-(--lh-page-top) pb-(--lh-page-end)">
			<header className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
				<h1 data-testid="today-title" className="lh-page-title">
					godspeed
				</h1>
				{head !== null && <StudiedLine progress={p.spacesProgress} noSpace={p.noSpaceProgress} nowMs={head} />}
				{head !== null && <StudyLine spaces={p.spaces} busyOn={p.busyOn} onStudy={p.onStudyTyped} />}
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
					<p data-testid="today-empty" className="text-item text-ink-2">
						None yet. A space holds one subject&apos;s files, deadlines and lessons.
					</p>
				</Pane>
			) : (
				<>
					{/* Wide, the spaces take a column beside the card and the week and end level with them; the blocks under run the page's width. */}
					<div className={cn("grid gap-(--lh-gap) @[1100px]/page:grid-cols-[minmax(0,1fr)_340px]", waited && "lh-set")}>
						<div className="flex min-w-0 flex-col gap-(--lh-gap)">
							{p.lessonError && (
								<p role="alert" className="text-ui text-ans-wrong">
									{p.lessonError}
								</p>
							)}
							{/* The card glides to the height of its other form, or of another deadline picked, so the page below moves once. */}
							{(gap || card) && (
								<div ref={cardGlide}>
									{gap && <NextGap gap={gap} color={space(gap.spaceId)?.color} spaceName={space(gap.spaceId)?.name ?? ""} nowMs={p.nowMs} />}
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
								</div>
							)}
							<DeadlinesCard spaces={p.spaces} lists={p.lists} outlines={outlines} nowMs={p.nowMs} picked={shown} onPick={setPicked} onRetry={p.onRetry} onAdd={p.onAddDeadline} />
							<p aria-live="polite" data-testid="today-showing" className="sr-only">
								{picked !== null && (gap || card) ? `Showing ${gap?.label ?? card?.name}` : ""}
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
