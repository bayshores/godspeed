import { localDay, type DeadlineProgress, type ProgressPayload, type SpaceSummary } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { AddDeadline } from "./add-deadline";
import { longDay, todaySections, type TodayLists } from "./home-page-model";
import { NextCard } from "./next-card";
import { SpaceList } from "./space-list";
import { ROW_LIST, SECTION_TITLE } from "./styles";
import { DoneRow, LaterRow, TodayRow } from "./today-row";
import { WeekStrip } from "./week-strip";

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
	/** Who reads files (useWorker). */
	worker: string | null;
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
 * TODAY (the render seam of home-page.tsx) in three levels: the next
 * thing as the one card with the page's main button; the rest of what is
 * due this week and what was ticked done today as a framed list; the
 * spaces and Later (with "Add a deadline") as plain rows. This week's
 * study days are a quiet line under the title.
 */
export function TodayBody(p: TodayBodyProps) {
	return (
		<div className="mx-auto flex w-full max-w-[808px] shrink-0 flex-col gap-10 px-6 pt-12 pb-10">
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
					<h1 className="text-[56px] leading-none text-ink">Today</h1>
					{p.nowMs !== null && (
						<p data-testid="today-date" className="bg-highlight px-2.5 py-1 font-count text-[17px] text-ink">
							{longDay(localDay(p.nowMs))}
						</p>
					)}
				</div>
				{p.ready && p.nowMs !== null && p.spaces.length > 0 && <WeekStrip payloads={[...p.spacesProgress.values()]} nowMs={p.nowMs} />}
			</div>
			{!p.ready || p.nowMs === null ? (
				<div data-testid="home-loading" aria-hidden className="h-[320px] w-full bg-panel" />
			) : p.spaces.length === 0 ? (
				<div className="flex flex-col items-start gap-4">
					<p data-testid="today-empty" className="text-[17px] text-ink-2">
						No spaces yet. Add one, then add its deadlines.
					</p>
					<button type="button" data-testid="today-add-space" onClick={p.onAddSpace} className="lh-btn lh-btn-main">
						Add a space
					</button>
				</div>
			) : (
				<Sections {...p} nowMs={p.nowMs} />
			)}
		</div>
	);
}

function Sections(p: TodayBodyProps & { nowMs: number }) {
	const { nowMs, lists, deadlineProgress } = p;
	const color = (d: OpenDeadline) => p.spaces.find((s) => s.id === d.spaceId)?.color;
	const sections = lists && todaySections(lists, deadlineProgress, nowMs);
	return (
		<>
			{p.lessonError && (
				<p role="alert" className="-mb-4 text-[15px] text-ans-wrong">
					{p.lessonError}
				</p>
			)}
			{!sections ? (
				<LoadFailed message="Couldn't load your deadlines." onRetry={p.onRetry} />
			) : sections.card ? (
				<NextCard
					deadline={sections.card}
					progress={deadlineProgress.get(sections.card.id)}
					color={color(sections.card)}
					nowMs={nowMs}
					busy={p.busy}
					onStart={p.onStart}
					onDone={p.onDone}
				/>
			) : (
				sections.empty && (
					<p data-testid="today-empty" className="text-[17px] text-ink-2">
						{sections.empty}
					</p>
				)
			)}
			{lists && sections && sections.due.length + lists.done.length > 0 && (
				<section className="flex flex-col gap-2">
					<h2 className={SECTION_TITLE}>Due this week</h2>
					<ul data-testid="today-list" className={`${ROW_LIST} border-y-2 border-line`}>
						{sections.due.map((d) => (
							<TodayRow key={d.id} deadline={d} progress={deadlineProgress.get(d.id)} color={color(d)} nowMs={nowMs} busy={p.busy} onStart={p.onStart} onDone={p.onDone} />
						))}
						{lists.done.map((d) => (
							<DoneRow key={d.id} deadline={d} onUndo={p.onUndo} />
						))}
					</ul>
				</section>
			)}
			<SpaceList spaces={p.spaces} progress={p.spacesProgress} worker={p.worker} newFiles={p.newFiles} onOpen={p.onOpenSpace} />
			{lists && (
				<section className="flex flex-col gap-2">
					<div className="flex min-h-9 items-center justify-between gap-4">
						<h2 className={SECTION_TITLE}>{lists.later.length > 0 && "Later"}</h2>
						<AddDeadline spaces={p.spaces} onPick={p.onAddDeadline} />
					</div>
					{lists.later.length > 0 && (
						<ul data-testid="later-list" className={ROW_LIST}>
							{lists.later.map((d) => (
								<LaterRow key={d.id} deadline={d} progress={deadlineProgress.get(d.id)} nowMs={nowMs} />
							))}
						</ul>
					)}
				</section>
			)}
		</>
	);
}
