import { memo, useMemo, type ReactNode } from "react";
import type { SpaceNote, DeadlineProgress, ProgressPayload } from "@/shared/core";
import { SpaceFacts } from "./space-facts";
import { ConfidenceCard } from "./confidence-card";
import { LessonsCard } from "./lessons-card";
import { MostNeeded } from "./most-needed";
import { NextDeadline } from "./next-deadline";
import { answeredLessons, hasCalibration, mostNeeded, recentLessons, upcomingDeadlines } from "./overview-model";
import { RecentLessons } from "./recent-lessons";
import { TeacherNote } from "./teacher-note";

/**
 * The Progress tab under the space head (pure view, the render-test seam),
 * top to bottom: the teacher's note, the next deadline, "Most needed",
 * "Pick up where you left off", the fact grid, "How lessons went" and the
 * confidence chart. Each shows only once it has something to show; a
 * space's deadline, topic and facts are left out for "Lessons with no space".
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
	onStartDeadline,
	onAddDeadline,
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
	/** The next deadline's button. */
	onStartDeadline: (d: DeadlineProgress) => void;
	/** "Add a deadline" (opens the Deadlines tab). */
	onAddDeadline: () => void;
	/** With no space: the spaces to switch to. */
	pickSpace?: ReactNode;
}) {
	const answered = useMemo(() => answeredLessons(data?.lessons ?? []), [data?.lessons]);
	const recent = useMemo(() => recentLessons(data?.lessons ?? []), [data?.lessons]);
	const upcoming = useMemo(() => (data && nowMs !== null ? upcomingDeadlines(data.deadlines, nowMs) : []), [data, nowMs]);
	const needed = useMemo(() => mostNeeded(upcoming), [upcoming]);
	return (
		<div data-testid="space-overview" className="mx-auto flex w-full max-w-[908px] flex-col gap-[22px] px-6 pt-[22px] pb-9">
			{pickSpace}
			{note && <TeacherNote note={note} nowMs={nowMs} />}
			{hasSpace && data && nowMs !== null && (
				<NextDeadline
					deadline={upcoming[0] ?? null}
					none={data.deadlines.length === 0 ? "No deadlines yet" : "Nothing is coming up."}
					color={color}
					nowMs={nowMs}
					busy={busy}
					onStart={onStartDeadline}
					onAddDeadline={onAddDeadline}
				/>
			)}
			{startError && (
				<p role="alert" data-testid="start-error" className="text-[15px] text-ans-wrong">
					{startError}
				</p>
			)}
			{hasSpace && needed && <MostNeeded needed={needed} busy={busy} onStudy={onStudy} />}
			{recent.length > 0 && <RecentLessons lessons={recent} color={color} nowMs={nowMs} />}
			{hasSpace && data && <SpaceFacts progress={data} />}
			{answered.length > 0 && <LessonsCard lessons={answered} />}
			{data && hasCalibration(data.calibration.levels) && <ConfidenceCard calibration={data.calibration} />}
		</div>
	);
});
