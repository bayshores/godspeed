import { memo, useCallback, useMemo, type ReactNode } from "react";
import type { SpaceNote, DeadlineProgress, ProgressPayload } from "@/shared/core";
import { SpaceFacts } from "./space-facts";
import { ConfidenceCard } from "./confidence-card";
import { LessonMenuLayer } from "./lesson-menu-layer";
import { LessonRecord } from "./lesson-record";
import { splitLessons } from "./lesson-record-model";
import { MostNeeded } from "./most-needed";
import { NextDeadline } from "./next-deadline";
import { PathBlock } from "./path-block";
import { hasCalibration, mostNeeded, upcomingDeadlines } from "./overview-model";
import { TeacherNote } from "./teacher-note";
import { UnfinishedLessons } from "./unfinished-lessons";
import { useLessonActions } from "./use-lesson-actions";

/**
 * The Progress tab under the space head (pure view, the render-test seam).
 * What to do sits in a narrow side column: the next deadline (or, with none
 * ahead, the path), an interview waiting for its date, the unfinished
 * lessons, the path beside a deadline, and "Most needed". The record sits in
 * the wide column: the teacher's note, the finished lessons, the fact grid
 * and the confidence chart. Each shows only once it has something to show,
 * but for the Lessons heading, which shows while loading too; a space's
 * deadline, path and facts are left out for "Lessons with no space". With
 * nothing in the side column the wide one takes the whole width; in a
 * narrow window the side column goes on top.
 */
export const OverviewBody = memo(function OverviewBody({
	hasSpace,
	color,
	note,
	data,
	nowMs,
	busy,
	startError,
	onStudy,
	onStudyPath,
	onStudyDeadline,
	onWorkDeadline,
	onAddDeadline,
	waiting,
	pickSpace,
}: {
	hasSpace: boolean;
	/** The space's color (grey with no space). */
	color: string;
	note?: SpaceNote;
	data: ProgressPayload | null;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
	/** A lesson is starting. */
	busy: boolean;
	/** Why the last lesson didn't start. */
	startError: string | null;
	/** "Most needed" → Study. */
	onStudy: (topicId: string) => void;
	/** The path's Study, on its next topic. */
	onStudyPath: (topicId: string) => void;
	/** The next deadline's Study. */
	onStudyDeadline: (d: DeadlineProgress) => void;
	/** The next homework's or project's Work on. */
	onWorkDeadline: (d: DeadlineProgress) => void;
	/** "Add a deadline" (opens the Deadlines tab). */
	onAddDeadline: () => void;
	/** An interview waiting for its date (waiting-deadline.tsx). */
	waiting?: ReactNode;
	/** With no space: the spaces to switch to. */
	pickSpace?: ReactNode;
}) {
	const upcoming = useMemo(() => (data && nowMs !== null ? upcomingDeadlines(data.deadlines, nowMs) : []), [data, nowMs]);
	const needed = useMemo(() => mostNeeded(upcoming), [upcoming]);
	const actions = useLessonActions(data?.lessons ?? null, data?.spaceId ?? null);
	const { unfinished, finished } = useMemo(() => splitLessons(actions.shown ?? []), [actions.shown]);
	const problemsOf = useCallback((id: string) => data?.deadlines.find((d) => d.id === id)?.problems, [data]);

	const spaceData = hasSpace && data && nowMs !== null ? data : null;
	const next = upcoming[0] ?? null;
	// With no deadline ahead the path takes the deadline card's place, and its key.
	const pathFirst = !!spaceData?.path && next === null;
	const side = spaceData !== null || unfinished.length > 0 || startError !== null;

	return (
		<div data-testid="space-overview" className="mx-auto flex w-full max-w-(--lh-page-w) flex-col gap-[22px] px-6 pt-[22px] pb-9">
			{pickSpace}
			<div className="flex flex-wrap items-start gap-[22px]">
				{side && (
					<div data-testid="progress-side" className="flex min-w-0 grow basis-[280px] flex-col gap-[22px]">
						{spaceData &&
							(pathFirst ? (
								<PathBlock path={spaceData.path!} main busy={busy} onStudy={onStudyPath} />
							) : (
								<NextDeadline
									deadline={next}
									none={spaceData.deadlines.length === 0 ? "No deadlines yet" : "Nothing is coming up."}
									color={color}
									nowMs={nowMs!}
									busy={busy}
									onStudy={onStudyDeadline}
									onWork={onWorkDeadline}
									onAddDeadline={onAddDeadline}
								/>
							))}
						{hasSpace && waiting}
						{startError && (
							<p role="alert" data-testid="start-error" className="text-[15px] text-ans-wrong">
								{startError}
							</p>
						)}
						{unfinished.length > 0 && <UnfinishedLessons lessons={unfinished} problemsOf={problemsOf} actions={actions} />}
						{spaceData?.path && !pathFirst && <PathBlock path={spaceData.path} main={false} busy={busy} onStudy={onStudyPath} />}
						{hasSpace && needed && <MostNeeded needed={needed} busy={busy} onStudy={onStudy} />}
					</div>
				)}
				<div className="flex min-w-0 grow-[999] basis-[460px] flex-col gap-[22px]">
					{note && <TeacherNote note={note} nowMs={nowMs} />}
					<LessonRecord finished={actions.shown ? finished : null} none={actions.shown?.length === 0} nowMs={nowMs} actions={actions} />
					{hasSpace && data && <SpaceFacts progress={data} />}
					{data && hasCalibration(data.calibration.levels) && <ConfidenceCard calibration={data.calibration} />}
				</div>
			</div>
			<LessonMenuLayer actions={actions} />
		</div>
	);
});
