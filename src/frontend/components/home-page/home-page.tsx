import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { hasProblems, localDay, type SpaceSummary, type DeadlineProgress } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useMinute } from "@/frontend/components/countdown";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { TodayWork } from "@/frontend/components/work/today-work";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { byDue, spacesSettled, longDay, prepDays, todayLists, type PrepDay } from "./home-page-model";
import { DoneRow, LaterRow, PrepLaterRow, PrepTodayRow, TodayRow } from "./today-row";
import { useSpacesProgress } from "./use-spaces-progress";

/**
 * TODAY ("/"): the spaces the teacher is reading files of, then the
 * deadlines of every space as one list, with each prep that has a day.
 * Under "Today", the ones due within a week or overdue, each with its one
 * main button, then the ones ticked done today; under "Later", the rest.
 * "Add a deadline" opens a space's Deadlines tab (a menu picks the space when
 * there are several).
 */
export function HomePage() {
	const { spaces, loaded, setActive } = useSpaces();
	const shown = useMemo(() => spaces.filter((c) => !c.archived), [spaces]);
	const { deadlines, doneToday, error: deadlinesError, markDone, undo, reload: reloadDeadlines } = useOpenDeadlines();
	const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
	const spacesProgress = useSpacesProgress(shownIds);
	// The rows' words need each space's progress, so they wait for it the
	// first time and never change under the reader.
	const [progressReady, setProgressReady] = useState(false);
	if (!progressReady && shown.length > 0 && spacesSettled(shownIds, spacesProgress)) setProgressReady(true);
	const nowMs = useMinute();
	const navigate = useNavigate();
	const [addingSpace, setAddingSpace] = useState(false);
	// The dialog compares its mode by identity: one object per open.
	const createMode = useMemo(() => (addingSpace ? { kind: "create" as const } : null), [addingSpace]);
	const addDeadline = useCallback(
		(spaceId: string) => {
			setActive(spaceId);
			navigate("/space/deadlines");
		},
		[setActive, navigate],
	);
	const lesson = useLessonStart();

	// Each deadline's topics, problems and unfinished session, from its space's progress.
	const deadlineProgress = useMemo(() => {
		const map = new Map<string, DeadlineProgress>();
		for (const p of spacesProgress.progress.values()) for (const d of p.deadlines) map.set(d.id, d);
		return map;
	}, [spacesProgress]);
	const colors = useMemo(() => new Map(shown.map((c) => [c.id, c.color])), [shown]);

	const { studyDeadline, workOnHomework, studyPrep } = lesson;
	const openPrep = useCallback((p: PrepDay) => setActive(p.spaceId), [setActive]);
	const onStudyPrep = useCallback(
		(p: PrepDay) => {
			setActive(p.spaceId);
			void studyPrep([], p.spaceId);
		},
		[setActive, studyPrep],
	);
	const onStart = useCallback(
		(d: OpenDeadline) => {
			setActive(d.spaceId);
			const progress = deadlineProgress.get(d.id);
			if (hasProblems(d.kind)) void workOnHomework({ id: d.id, continueHomework: progress?.continueHomework }, d.spaceId);
			else void studyDeadline({ id: d.id, continueStudy: progress?.continueStudy }, d.spaceId);
		},
		[setActive, studyDeadline, workOnHomework, deadlineProgress],
	);

	const ready = nowMs !== null && loaded && (deadlines !== null || deadlinesError !== null) && (shown.length === 0 || progressReady);
	const lists = useMemo(() => (deadlines && nowMs !== null ? todayLists(deadlines, doneToday, nowMs) : null), [deadlines, doneToday, nowMs]);
	const preps = useMemo(() => (nowMs !== null ? prepDays(shown, nowMs) : { today: [], later: [] }), [shown, nowMs]);
	// A prep has no Deadlines tab.
	const withDeadlines = useMemo(() => shown.filter((c) => !c.prep), [shown]);
	const laterCount = (lists?.later.length ?? 0) + preps.later.length;

	return (
		<div data-testid="home-page" className="h-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-[808px] flex-col gap-8 px-6 pt-12 pb-10">
				<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
					<h1 className="text-[56px] leading-none text-ink">Today</h1>
					{nowMs !== null && (
						<p data-testid="today-date" className="bg-highlight px-2.5 py-1 font-count text-[17px] text-ink">
							{longDay(localDay(nowMs))}
						</p>
					)}
				</div>
				<TodayWork spaces={shown} />
				{!ready || nowMs === null ? (
					<div data-testid="home-loading" aria-hidden className="h-[320px] w-full bg-panel" />
				) : !lists ? (
					<LoadFailed message="Couldn't load your deadlines." onRetry={() => void reloadDeadlines()} />
				) : (
					<>
						{lesson.error && (
							<p role="alert" className="text-[15px] text-ans-wrong">
								{lesson.error}
							</p>
						)}
						{shown.length === 0 ? (
							<div className="flex flex-col items-start gap-4">
								<p data-testid="today-empty" className="text-[17px] text-ink-2">
									No spaces yet. Add one, then add its deadlines.
								</p>
								<button type="button" data-testid="today-add-space" onClick={() => setAddingSpace(true)} className="lh-btn lh-btn-main">
									Add a space
								</button>
							</div>
						) : lists.today.length + lists.done.length + preps.today.length === 0 ? (
							<p data-testid="today-empty" className="text-[17px] text-ink-2">
								{laterCount === 0 ? "No deadlines yet. Your agent can add them from your files." : "Nothing is due in the next 7 days."}
							</p>
						) : (
							<ul data-testid="today-list" className="flex flex-col gap-3">
								{byDue(lists.today, preps.today).map((item) =>
									"prep" in item ? (
										<PrepTodayRow key={item.prep.spaceId} prep={item.prep} nowMs={nowMs} busy={lesson.busy} onOpen={openPrep} onStudy={onStudyPrep} />
									) : (
										<TodayRow
											key={item.deadline.id}
											deadline={item.deadline}
											progress={deadlineProgress.get(item.deadline.id)}
											color={colors.get(item.deadline.spaceId)}
											nowMs={nowMs}
											busy={lesson.busy}
											onStart={onStart}
											onDone={markDone}
										/>
									),
								)}
								{lists.done.map((d) => (
									<DoneRow key={d.id} deadline={d} onUndo={undo} />
								))}
							</ul>
						)}
						{shown.length > 0 && (
							<section className="flex flex-col gap-4">
								<div className="flex min-h-9 items-center justify-between gap-4">
									<h2 className="text-[24px] leading-snug text-ink">{laterCount > 0 && "Later"}</h2>
									{withDeadlines.length > 0 && <AddDeadline spaces={withDeadlines} onPick={addDeadline} />}
								</div>
								{laterCount > 0 && (
									<ul data-testid="later-list" className="flex flex-col gap-3">
										{byDue(lists.later, preps.later).map((item) =>
											"prep" in item ? (
												<PrepLaterRow key={item.prep.spaceId} prep={item.prep} nowMs={nowMs} onOpen={openPrep} />
											) : (
												<LaterRow key={item.deadline.id} deadline={item.deadline} progress={deadlineProgress.get(item.deadline.id)} color={colors.get(item.deadline.spaceId)} nowMs={nowMs} />
											),
										)}
									</ul>
								)}
							</section>
						)}
					</>
				)}
			</div>
			<SpaceDialog mode={createMode} onClose={() => setAddingSpace(false)} />
		</div>
	);
}

/** "Add a deadline": one space opens its Deadlines tab at once; several open
 *  a menu of spaces first. */
function AddDeadline({ spaces, onPick }: { spaces: readonly SpaceSummary[]; onPick: (spaceId: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);

	const single = spaces.length === 1 ? spaces[0]! : null;
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="home-add-deadline"
				aria-haspopup={single ? undefined : "menu"}
				aria-expanded={single ? undefined : open}
				onClick={() => (single ? onPick(single.id) : setOpen((v) => !v))}
				className="lh-btn lh-btn-quiet h-[38px] text-[15px]"
			>
				<PixelIcon name="plus" />
				Add a deadline
			</button>
			{!single && (
				<MenuShell open={open} anchorRef={anchorRef} testid="home-add-deadline-menu" preferredSide="down" align="right" menuClass="lh-popup flex w-[236px] flex-col gap-0.5 p-1.5">
					<span className="px-2.5 py-1 text-sm text-ink-2">Which space?</span>
					{spaces.map((c) => (
						<button
							role="menuitem"
							key={c.id}
							type="button"
							data-testid={`home-add-deadline-${c.id}`}
							onClick={() => {
								setOpen(false);
								onPick(c.id);
							}}
							className="lh-press flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[15px] text-ink hover:bg-tone"
						>
							<span aria-hidden className="size-3 shrink-0" style={{ background: spaceColorVar(c.color) }} />
							<span title={c.name} className="min-w-0 flex-1 truncate">
								{c.name}
							</span>
						</button>
					))}
				</MenuShell>
			)}
		</>
	);
}
