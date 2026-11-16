import { localDay, longDay, type DeadlineProgress, type ProgressPayload, type SpaceSummary } from "@/shared/core";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { Pane } from "@/frontend/components/ui/pane";
import { DeadlinesCard } from "./deadlines-card";
import type { TodayLists } from "./home-page-model";
import { SpaceList } from "./space-list";
import { CARD_HEAD, CARD_TITLE } from "./styles";
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
	/** The lessons with no space; their answers count in the week line. */
	noSpaceProgress: ProgressPayload | null;
	/** Why a space's progress failed to load. */
	progressErrors: ReadonlyMap<string, string>;
	/** Who reads files (useWorker). */
	worker: string | null;
	newFiles: ReadonlyMap<string, string>;
	/** A lesson is starting. */
	busy: boolean;
	/** Why the last lesson start failed. */
	lessonError: string | null;
	onStart: (d: OpenDeadline) => void;
	/** The deadline the overdue card asks about, which shows no Mark done. */
	asking: string | null;
	onDone: (d: OpenDeadline) => void;
	onUndo: (d: OpenDeadline) => void;
	onRetry: () => void;
	onAddSpace: () => void;
	onAddDeadline: (spaceId: string) => void;
	onOpenSpace: (spaceId: string) => void;
}

/**
 * TODAY (the render seam of home-page.tsx), from the top of the window
 * down: the head (Today, the date, this week's study days), then the
 * deadlines card with the next thing biggest, then the spaces card. With
 * no space yet, the spaces card alone, with the key for the first.
 */
export function TodayBody(p: TodayBodyProps) {
	return (
		<div className="mx-auto flex w-full max-w-[904px] flex-col gap-10 px-6 pt-14 pb-16">
			<header className="flex flex-col gap-4">
				<div className="flex flex-wrap items-end gap-x-5 gap-y-3">
					<h1 className="text-[56px] leading-none text-ink">Today</h1>
					{p.nowMs !== null && (
						<p data-testid="today-date" className="mb-1 bg-highlight px-2.5 py-1 font-count text-[17px] text-ink">
							{longDay(localDay(p.nowMs))}
						</p>
					)}
				</div>
				{p.ready && p.nowMs !== null && p.spaces.length > 0 && <WeekStrip progress={p.spacesProgress} noSpace={p.noSpaceProgress} nowMs={p.nowMs} />}
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
						<p role="alert" className="-mb-5 text-[15px] text-ans-wrong">
							{p.lessonError}
						</p>
					)}
					<DeadlinesCard
						spaces={p.spaces}
						lists={p.lists}
						progress={p.deadlineProgress}
						nowMs={p.nowMs}
						busy={p.busy}
						onStart={p.onStart}
						asking={p.asking}
						onDone={p.onDone}
						onUndo={p.onUndo}
						onRetry={p.onRetry}
						onAdd={p.onAddDeadline}
					/>
					<SpaceList spaces={p.spaces} progress={p.spacesProgress} errors={p.progressErrors} worker={p.worker} newFiles={p.newFiles} onOpen={p.onOpenSpace} />
				</>
			)}
		</div>
	);
}
