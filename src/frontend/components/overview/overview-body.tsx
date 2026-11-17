import { memo, useMemo, type ReactNode } from "react";
import type { SpaceNote, DeadlineProgress, ProgressPayload } from "@/shared/core";
import { SpaceFacts } from "./space-facts";
import { ConfidenceCard } from "./confidence-card";
import { LessonRecord } from "./lesson-record";
import { MostNeeded } from "./most-needed";
import { NextDeadline } from "./next-deadline";
import { PathBlock } from "./path-block";
import { hasCalibration, mostNeeded, upcomingDeadlines } from "./overview-model";
import { TeacherNote } from "./teacher-note";

/**
 * The Progress tab under the space head (pure view, the render-test seam),
 * top to bottom: the space's path, the teacher's note, the next deadline
 * (with no deadline at all the path takes its place), "Most needed",
 * Lessons, the fact grid and the confidence chart. Each shows only once it
 * has something to show, but for the Lessons heading, which shows while
 * loading too; a space's deadline, topic and facts are left out for
 * "Lessons with no space".
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
	return (
		<div data-testid="space-overview" className="mx-auto flex w-full max-w-[908px] flex-col gap-[22px] px-6 pt-[22px] pb-9">
			{pickSpace}
			{hasSpace && data?.path && <PathBlock path={data.path} busy={busy} onStudy={onStudyPath} />}
			{note && <TeacherNote note={note} nowMs={nowMs} />}
			{waiting}
			{hasSpace && data && nowMs !== null && !(data.path && data.deadlines.length === 0) && (
				<NextDeadline
					deadline={upcoming[0] ?? null}
					none={data.deadlines.length === 0 ? "No deadlines yet" : "Nothing is coming up."}
					color={color}
					nowMs={nowMs}
					busy={busy}
					onStudy={onStudyDeadline}
					onWork={onWorkDeadline}
					onAddDeadline={onAddDeadline}
				/>
			)}
			{startError && (
				<p role="alert" data-testid="start-error" className="text-[15px] text-ans-wrong">
					{startError}
				</p>
			)}
			{hasSpace && needed && <MostNeeded needed={needed} busy={busy} onStudy={onStudy} />}
			<LessonRecord lessons={data?.lessons ?? null} spaceId={data?.spaceId ?? null} nowMs={nowMs} />
			{hasSpace && data && <SpaceFacts progress={data} />}
			{data && hasCalibration(data.calibration.levels) && <ConfidenceCard calibration={data.calibration} />}
		</div>
	);
});
