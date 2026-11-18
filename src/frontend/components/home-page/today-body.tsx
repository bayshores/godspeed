import { useEffect, useState } from "react";
import type { DeadlineProgress, ProgressPayload, SpaceSummary } from "@/shared/core";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { Pane } from "@/frontend/components/ui/pane";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { DeadlinesCard } from "./deadlines-card";
import { mainRowId, shownCard, type TodayLists } from "./home-page-model";
import { NextCard } from "./next-card";
import { SpaceList } from "./space-list";
import { StudiedLine } from "./studied-line";
import { CARD_HEAD, CARD_TITLE } from "./styles";

interface TodayBodyProps {
	/** Null before the first minute tick. */
	nowMs: number | null;
	/** Everything the first view needs is in, so nothing reflows under the reader. */
	ready: boolean;
	/** The open spaces. */
	spaces: readonly SpaceSummary[];
	/** Null when the deadlines failed to load. */
	lists: TodayLists | null;
	deadlineProgress: ReadonlyMap<string, DeadlineProgress>;
	spacesProgress: ReadonlyMap<string, ProgressPayload>;
	/** The lessons with no space; their answers count in the week line. */
	noSpaceProgress: ProgressPayload | null;
	/** Why a space's progress failed to load. */
	progressErrors: ReadonlyMap<string, string>;
	newFiles: ReadonlyMap<string, string>;
	/** A lesson is starting. */
	busy: boolean;
	/** Why the last lesson start failed. */
	lessonError: string | null;
	onStart: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
	onUndo: (d: OpenDeadline) => void;
	onRetry: () => void;
	onAddSpace: () => void;
	onAddDeadline: (spaceId: string) => void;
	onOpenSpace: (spaceId: string) => void;
}

/**
 * TODAY (the render seam of home-page.tsx), from the top of the window
 * down, each part lighter than the one before: the date and the days
 * studied, the card with the deadline picked in the week (the next thing
 * to do until one is picked), the week with Later, then the spaces. With no
 * space yet, the spaces card alone, with the key for the first.
 */
export function TodayBody(p: TodayBodyProps) {
	// A pick that leaves the lists falls back to the next thing to do.
	const [picked, setPicked] = useState<string | null>(null);
	const card = p.lists && p.nowMs !== null ? shownCard(p.lists, picked, mainRowId(p.lists.today, p.deadlineProgress, p.nowMs)) : null;
	const color = (d: OpenDeadline) => p.spaces.find((s) => s.id === d.spaceId)?.color;
	// The top bar's overdue ask skips what the card shows: the card asks already.
	const { setOnCard } = useOpenDeadlines();
	const cardId = card?.id ?? null;
	useEffect(() => {
		setOnCard(cardId);
		return () => setOnCard(null);
	}, [cardId, setOnCard]);
	return (
		<div className="mx-auto flex w-full max-w-[1160px] flex-col gap-8 px-6 pt-14 pb-16">
			{/* Narrow, the date steps down so the sentence still fits beside it. */}
			<header className="@container flex min-h-[46px] flex-wrap items-baseline gap-x-6 gap-y-2">
				{p.nowMs !== null && (
					<h1 data-testid="today-date" className="text-[46px] leading-none text-ink @max-[800px]:text-[34px]">
						{new Date(p.nowMs).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
					</h1>
				)}
				{p.ready && p.nowMs !== null && p.spaces.length > 0 && <StudiedLine progress={p.spacesProgress} noSpace={p.noSpaceProgress} nowMs={p.nowMs} />}
			</header>
			{!p.ready || p.nowMs === null ? (
				<div data-testid="home-loading" aria-hidden className="h-[320px] w-full bg-panel" />
			) : p.spaces.length === 0 ? (
				<Pane>
					<div className={CARD_HEAD}>
						<h2 className={CARD_TITLE}>Your spaces</h2>
						<button type="button" data-testid="today-add-space" onClick={p.onAddSpace} className="lh-btn lh-btn-main">
							Add a space
						</button>
					</div>
					<p data-testid="today-empty" className="px-6 pb-6 text-[17px] text-ink-2">
						None yet. A space holds one subject&apos;s files, deadlines and lessons.
					</p>
				</Pane>
			) : (
				<>
					{p.lessonError && (
						<p role="alert" className="-mb-4 text-[15px] text-ans-wrong">
							{p.lessonError}
						</p>
					)}
					{card && (
						<NextCard
							deadline={card}
							progress={p.deadlineProgress.get(card.id)}
							color={color(card)}
							nowMs={p.nowMs}
							busy={p.busy}
							onStart={p.onStart}
							onDone={p.onDone}
							onUndo={p.onUndo}
						/>
					)}
					<DeadlinesCard spaces={p.spaces} lists={p.lists} nowMs={p.nowMs} picked={card?.id ?? null} onPick={(d) => setPicked(d.id)} onRetry={p.onRetry} onAdd={p.onAddDeadline} />
					<p aria-live="polite" data-testid="today-showing" className="sr-only">
						{picked !== null && card ? `Showing ${card.name}` : ""}
					</p>
					<SpaceList spaces={p.spaces} progress={p.spacesProgress} errors={p.progressErrors} newFiles={p.newFiles} onOpen={p.onOpenSpace} />
				</>
			)}
		</div>
	);
}
