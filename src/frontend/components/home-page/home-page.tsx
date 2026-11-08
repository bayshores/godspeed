"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClassSummary, DeadlineProgress } from "@/shared/core";
import { useClasses } from "@/frontend/components/class-context";
import { ClassDialog, type ClassDialogMode } from "@/frontend/components/class-dialog";
import { ClassIcon } from "@/frontend/components/class-icon";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useMinute } from "@/frontend/components/countdown";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { TopBar } from "@/frontend/components/app-bar";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { ActivityPane } from "./activity-pane";
import { ClassFacts } from "./class-facts";
import { ComingUp } from "./coming-up";
import { DueNext } from "./due-next";
import { classesSettled, classSlot } from "./home-page-model";
import { useClassesProgress } from "./use-classes-progress";

/**
 * HOME ("/"): the deadline due next (from every class) with its study
 * button and big countdown, then the rest coming up, one fact grid per
 * class and the activity log. The top bar's "+ deadline" opens a class's
 * Edit class with a new deadline row (a menu picks the class when there
 * are several).
 */
export function HomePage() {
	const router = useRouter();
	const { classes, loaded, setActive } = useClasses();
	const shown = useMemo(() => classes.filter((c) => !c.archived), [classes]);
	const { deadlines, error: deadlinesError, leaving, markDone, reload: reloadDeadlines } = useOpenDeadlines();
	const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
	const classesProgress = useClassesProgress(shownIds);
	// The panes fill in together the first time; a class added later
	// shows its own box until its progress arrives.
	const [blocksReady, setBlocksReady] = useState(false);
	if (!blocksReady && shown.length > 0 && classesSettled(shownIds, classesProgress)) setBlocksReady(true);
	const nowMs = useMinute();
	const [dialog, setDialog] = useState<ClassDialogMode | null>(null);
	const halley = useHalley();
	const lesson = useLessonStart();

	// Each deadline's ready % and unfinished session, from its class's progress.
	const deadlineProgress = useMemo(() => {
		const map = new Map<string, DeadlineProgress>();
		for (const p of classesProgress.progress.values()) for (const d of p.deadlines) map.set(d.id, d);
		return map;
	}, [classesProgress]);

	const { studyDeadline } = lesson;
	const onStudy = useCallback(
		(d: OpenDeadline) => {
			setActive(d.classId);
			void studyDeadline({ id: d.id, continueStudy: deadlineProgress.get(d.id)?.continueStudy }, d.classId);
		},
		[setActive, studyDeadline, deadlineProgress],
	);
	const onOpenFiles = useCallback(
		(classId: string) => {
			setActive(classId);
			router.push("/class/files");
		},
		[router, setActive],
	);
	const onNewClass = useCallback(() => setDialog({ kind: "create" }), []);

	const ready = nowMs !== null && loaded && (deadlines !== null || deadlinesError !== null) && (shown.length === 0 || blocksReady);
	const [next, ...later] = deadlines ?? [];

	return (
		<div data-testid="home-page" className="flex h-full min-h-0 flex-col">
			<TopBar inClass={false} path={[{ label: "home", href: null }]}>
				{shown.length > 0 && <AddDeadline classes={shown} onPick={(classId) => setDialog({ kind: "edit", classId, deadline: "new" })} />}
			</TopBar>
			<div className="@container min-h-0 flex-1 overflow-y-auto">
				{!ready ? (
					<div className="px-5 py-6">
						<LoadingBox height="h-[320px]" />
					</div>
				) : (
					<div className="flex flex-col gap-[22px] px-5 pt-6 pb-6">
						{deadlines ? (
							<DueNext
								deadline={next ?? null}
								progress={next ? (deadlineProgress.get(next.id) ?? null) : null}
								leaving={!!next && leaving.has(next.id)}
								hasClasses={shown.length > 0}
								busy={lesson.busy}
								error={lesson.error}
								onStudy={onStudy}
								onDone={markDone}
								onNewClass={onNewClass}
							/>
						) : (
							<LoadFailed message="Couldn't load your deadlines." onRetry={() => void reloadDeadlines()} />
						)}
						<div className="flex flex-col gap-[22px] @5xl:flex-row">
							<div className="flex min-w-0 flex-1 flex-col gap-[22px]">
								{next && <ComingUp deadlines={later} progress={deadlineProgress} leaving={leaving} />}
								{shown.length > 0 && (
									<div className="grid items-start gap-4 @2xl:grid-cols-2">
										{shown.map((c) => {
											const slot = classSlot(c.id, classesProgress, blocksReady);
											const p = classesProgress.progress.get(c.id);
											if (slot === "block" && p) return <ClassFacts key={c.id} cls={c} progress={p} onOpenFiles={onOpenFiles} />;
											return slot === "failed" ? (
												<LoadFailed key={c.id} message={`Couldn't load ${c.name}.`} onRetry={classesProgress.reload} />
											) : (
												<LoadingBox key={c.id} height="h-[222px]" />
											);
										})}
									</div>
								)}
							</div>
							{halley && <ActivityPane actions={halley.recent} nowMs={nowMs} onGo={halley.go} className="@5xl:w-[400px] @5xl:shrink-0" />}
						</div>
					</div>
				)}
			</div>
			<ClassDialog mode={dialog} onClose={() => setDialog(null)} />
		</div>
	);
}

/** A plain card-coloured box shown until Home's data arrives, so nothing
 *  appears in a half-loaded state and then jumps. */
function LoadingBox({ height }: { height: string }) {
	return <div data-testid="home-loading" aria-hidden className={`w-full bg-panel ${height}`} />;
}

/** "+ deadline": one class opens its Edit class at once; several open a
 *  menu of classes first. */
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
				className="lh-btn"
			>
				+ deadline
			</button>
			{!single && (
				<MenuShell
					open={open}
					anchorRef={anchorRef}
					testid="home-add-deadline-menu"
					preferredSide="down"
					align="right"
					menuClass="lh-popup flex w-[236px] flex-col gap-0.5 p-1.5"
				>
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
							className="lh-press flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13.5px] text-ink hover:bg-tone"
						>
							<ClassIcon icon={c.icon} className="size-4 shrink-0 text-ink-2" />
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
