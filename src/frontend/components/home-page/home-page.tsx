"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hasProblems, localDay, type ClassSummary, type DeadlineProgress } from "@/shared/core";
import { classColorVar } from "@/frontend/components/class-color";
import { useClasses } from "@/frontend/components/class-context";
import { ClassDialog } from "@/frontend/components/class-dialog";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useMinute } from "@/frontend/components/countdown";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { classesSettled, longDay, todayLists } from "./home-page-model";
import { DoneRow, LaterRow, TodayRow } from "./today-row";
import { useClassesProgress } from "./use-classes-progress";

/**
 * TODAY ("/"): the deadlines of every class as one list. Under "Today",
 * the ones due within a week or overdue, each with its one main button,
 * then the ones ticked done today; under "Later", the rest. "Add a
 * deadline" opens a class's Deadlines tab (a menu picks the class when
 * there are several).
 */
export function HomePage() {
	const { classes, loaded, setActive } = useClasses();
	const shown = useMemo(() => classes.filter((c) => !c.archived), [classes]);
	const { deadlines, doneToday, error: deadlinesError, markDone, undo, reload: reloadDeadlines } = useOpenDeadlines();
	const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
	const classesProgress = useClassesProgress(shownIds);
	// The rows' words need each class's progress, so they wait for it the
	// first time and never change under the reader.
	const [progressReady, setProgressReady] = useState(false);
	if (!progressReady && shown.length > 0 && classesSettled(shownIds, classesProgress)) setProgressReady(true);
	const nowMs = useMinute();
	const router = useRouter();
	const [addingClass, setAddingClass] = useState(false);
	// The dialog compares its mode by identity: one object per open.
	const createMode = useMemo(() => (addingClass ? { kind: "create" as const } : null), [addingClass]);
	const addDeadline = useCallback(
		(classId: string) => {
			setActive(classId);
			router.push("/class/deadlines");
		},
		[setActive, router],
	);
	const lesson = useLessonStart();

	// Each deadline's topics, problems and unfinished session, from its class's progress.
	const deadlineProgress = useMemo(() => {
		const map = new Map<string, DeadlineProgress>();
		for (const p of classesProgress.progress.values()) for (const d of p.deadlines) map.set(d.id, d);
		return map;
	}, [classesProgress]);
	const colors = useMemo(() => new Map(shown.map((c) => [c.id, c.color])), [shown]);

	const { studyDeadline, workOnHomework } = lesson;
	const onStart = useCallback(
		(d: OpenDeadline) => {
			setActive(d.classId);
			const progress = deadlineProgress.get(d.id);
			if (hasProblems(d.kind)) void workOnHomework({ id: d.id, continueHomework: progress?.continueHomework }, d.classId);
			else void studyDeadline({ id: d.id, continueStudy: progress?.continueStudy }, d.classId);
		},
		[setActive, studyDeadline, workOnHomework, deadlineProgress],
	);

	const ready = nowMs !== null && loaded && (deadlines !== null || deadlinesError !== null) && (shown.length === 0 || progressReady);
	const lists = useMemo(() => (deadlines && nowMs !== null ? todayLists(deadlines, doneToday, nowMs) : null), [deadlines, doneToday, nowMs]);

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
									No classes yet. Add one, then add its deadlines.
								</p>
								<button type="button" data-testid="today-add-class" onClick={() => setAddingClass(true)} className="lh-btn lh-btn-main">
									Add a class
								</button>
							</div>
						) : lists.today.length + lists.done.length === 0 ? (
							<p data-testid="today-empty" className="text-[17px] text-ink-2">
								{lists.later.length === 0 ? "No deadlines yet. Your agent can add them from the syllabus." : "Nothing is due in the next 7 days."}
							</p>
						) : (
							<ul data-testid="today-list" className="flex flex-col gap-3">
								{lists.today.map((d) => (
									<TodayRow
										key={d.id}
										deadline={d}
										progress={deadlineProgress.get(d.id)}
										color={colors.get(d.classId)}
										nowMs={nowMs}
										busy={lesson.busy}
										onStart={onStart}
										onDone={markDone}
									/>
								))}
								{lists.done.map((d) => (
									<DoneRow key={d.id} deadline={d} onUndo={undo} />
								))}
							</ul>
						)}
						{shown.length > 0 && (
							<section className="flex flex-col gap-4">
								<div className="flex min-h-9 items-center justify-between gap-4">
									<h2 className="text-[24px] leading-snug text-ink">{lists.later.length > 0 && "Later"}</h2>
									<AddDeadline classes={shown} onPick={addDeadline} />
								</div>
								{lists.later.length > 0 && (
									<ul data-testid="later-list" className="flex flex-col gap-3">
										{lists.later.map((d) => (
											<LaterRow key={d.id} deadline={d} progress={deadlineProgress.get(d.id)} color={colors.get(d.classId)} nowMs={nowMs} />
										))}
									</ul>
								)}
							</section>
						)}
					</>
				)}
			</div>
			<ClassDialog mode={createMode} onClose={() => setAddingClass(false)} />
		</div>
	);
}

/** "Add a deadline": one class opens its Deadlines tab at once; several open
 *  a menu of classes first. */
function AddDeadline({ classes, onPick }: { classes: readonly ClassSummary[]; onPick: (classId: string) => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);

	const single = classes.length === 1 ? classes[0]! : null;
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
					<span className="px-2.5 py-1 text-sm text-ink-2">Which class?</span>
					{classes.map((c) => (
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
							<span aria-hidden className="size-3 shrink-0" style={{ background: classColorVar(c.color) }} />
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
