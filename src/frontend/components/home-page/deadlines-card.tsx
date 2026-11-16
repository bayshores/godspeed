import { DEFAULT_TEACHER_NAME, type DeadlineProgress, type SpaceSummary } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { AddDeadline } from "./add-deadline";
import { todaySections, type TodayLists } from "./home-page-model";
import { NextCard } from "./next-card";
import { CARD_HEAD, CARD_TITLE, ROW_LIST } from "./styles";
import { DoneRow, LaterRow, TodayRow } from "./today-row";

/** The solid rule that starts each group in the card. */
const GROUP = "border-t-2 border-line";

/**
 * Today's deadlines in one card, its groups split by solid rules: the next
 * thing as a big band with the page's main button, the rest of this week
 * and what was ticked done today as rows with small buttons, then Later.
 * "Add" sits in the card's head; with nothing to show, a sentence takes the
 * groups' place.
 */
export function DeadlinesCard({
	spaces,
	lists,
	progress,
	nowMs,
	busy,
	onStart,
	onDone,
	onUndo,
	onRetry,
	onAdd,
}: {
	spaces: readonly SpaceSummary[];
	/** Null when the deadlines failed to load. */
	lists: TodayLists | null;
	progress: ReadonlyMap<string, DeadlineProgress>;
	nowMs: number;
	/** A lesson is starting. */
	busy: boolean;
	onStart: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
	onUndo: (d: OpenDeadline) => void;
	onRetry: () => void;
	onAdd: (spaceId: string) => void;
}) {
	const color = (d: OpenDeadline) => spaces.find((s) => s.id === d.spaceId)?.color;
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const sections = lists && todaySections(lists, progress, nowMs, teacher);
	return (
		<Pane data-testid="today-deadlines" className="@container overflow-hidden">
			<div className={CARD_HEAD}>
				<h2 className={CARD_TITLE}>Deadlines</h2>
				{lists && <AddDeadline spaces={spaces} onPick={onAdd} />}
			</div>
			{!lists || !sections ? (
				<LoadFailed message="Couldn't load your deadlines." onRetry={onRetry} className={cn(GROUP, "py-10")} />
			) : (
				<>
					{sections.empty && (
						<p data-testid="today-empty" className="px-6 pb-6 text-[17px] text-ink-2">
							{sections.empty}
						</p>
					)}
					{sections.card && (
						<NextCard
							deadline={sections.card}
							progress={progress.get(sections.card.id)}
							color={color(sections.card)}
							nowMs={nowMs}
							busy={busy}
							onStart={onStart}
							onDone={onDone}
						/>
					)}
					{sections.due.length + lists.done.length > 0 && (
						<ul data-testid="today-list" className={cn(ROW_LIST, GROUP, "py-1")}>
							{sections.due.map((d) => (
								<TodayRow key={d.id} deadline={d} progress={progress.get(d.id)} color={color(d)} nowMs={nowMs} busy={busy} onStart={onStart} onDone={onDone} />
							))}
							{lists.done.map((d) => (
								<DoneRow key={d.id} deadline={d} onUndo={onUndo} />
							))}
						</ul>
					)}
					{lists.later.length > 0 && (
						<section className={cn(GROUP, "pt-5 pb-1")}>
							<h3 className="px-6 pb-1 text-[17px] leading-snug text-ink">Later</h3>
							<ul data-testid="later-list" className={ROW_LIST}>
								{lists.later.map((d) => (
									<LaterRow key={d.id} deadline={d} progress={progress.get(d.id)} nowMs={nowMs} />
								))}
							</ul>
						</section>
					)}
				</>
			)}
		</Pane>
	);
}
