import { memo, useMemo, type ReactNode } from "react";
import { useWaited } from "@/frontend/components/loading";
import { cn } from "@/frontend/lib/utils";
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
import { NotesCard } from "./notes-card";
import { TeacherNote } from "./teacher-note";
import { LessonCard } from "./lesson-card";
import { useLessonActions } from "./use-lesson-actions";
import { useStickyTop } from "./use-sticky-top";

/**
 * The Progress tab under the space head (pure view, the render-test seam).
 * What to do sits in a narrow side column: the next deadline (or, with none
 * ahead, the path), an interview waiting for its date, the unfinished
 * lessons, the path beside a deadline, and "Most needed". The record sits in
 * the wide column: the teacher's note, the finished lessons, the fact grid
 * and the confidence chart. Each shows only once it has something to show,
 * but for the Lessons heading, which shows while loading too; a space's
 * deadline, path and facts are left out for "Lessons with no space". With
 * nothing in the side column the wide one takes the whole width. The side
 * column sticks while the record scrolls, so what to do stays in view; in
 * a narrow window it goes on top instead.
 */
export const OverviewBody = memo(function OverviewBody({
	hasSpace,
	color,
	note,
	data,
	nowMs,
	busyOn,
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
	/** The id of the lesson start in flight, if any. */
	busyOn: string | null;
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
	const waited = useWaited(data !== null && nowMs !== null);
	const needed = useMemo(() => mostNeeded(upcoming), [upcoming]);
	const actions = useLessonActions(data?.lessons ?? null, data?.spaceId ?? null);
	const { unfinished, finished } = useMemo(() => splitLessons(actions.shown ?? []), [actions.shown]);

	const spaceData = hasSpace && data && nowMs !== null ? data : null;
	const next = upcoming[0] ?? null;
	// With no deadline ahead the path takes the deadline card's place, and its key.
	const pathFirst = !!spaceData?.path && next === null;
	const side = spaceData !== null || unfinished.length > 0 || startError !== null;
	const [sideRef, sideTop] = useStickyTop();

	return (
		<div data-testid="space-overview" className="@container lh-page flex flex-col gap-(--lh-gap) pt-(--lh-gap) pb-(--lh-page-end)">
			{pickSpace}
			{/* Two columns once both fit: the side's 280 points, the gap and the record's 460. Wide, the
			    side grows to 340 so a deadline's name and a lesson's keep to fewer lines. */}
			<div className="flex flex-col gap-(--lh-gap) @[762px]:flex-row @[762px]:items-start">
				{side && (
					<div ref={sideRef} data-testid="progress-side" style={{ top: sideTop }} className={cn("flex min-w-0 flex-col gap-(--lh-gap) @[762px]:sticky @[762px]:w-[280px] @[762px]:shrink-0 @[1200px]:w-[340px]", waited && "lh-set")}>
						{spaceData &&
							(pathFirst ? (
								<PathBlock path={spaceData.path!} main busyOn={busyOn} onStudy={onStudyPath} />
							) : (
								<NextDeadline
									deadline={next}
									none={spaceData.deadlines.length === 0 ? "No deadlines yet" : "Nothing is coming up."}
									color={color}
									nowMs={nowMs!}
									busyOn={busyOn}
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
						{data && unfinished.length > 0 && <LessonCard title="Unfinished" name="unfinished" lessons={unfinished} actions={actions} headKey />}
						{spaceData?.path && !pathFirst && <PathBlock path={spaceData.path} main={false} busyOn={busyOn} onStudy={onStudyPath} />}
						{hasSpace && needed && <MostNeeded needed={needed} busyOn={busyOn} onStudy={onStudy} />}
					</div>
				)}
				<div className={cn("flex min-w-0 flex-1 flex-col gap-(--lh-gap)", waited && "lh-set")}>
					{note && <TeacherNote note={note} nowMs={nowMs} />}
					{hasSpace && <NotesCard spaceId={data?.spaceId ?? null} />}
					<LessonRecord finished={actions.shown ? finished : null} none={actions.shown?.length === 0} nowMs={nowMs} actions={actions} />
					{hasSpace && data && <SpaceFacts progress={data} />}
					{data && hasCalibration(data.calibration.levels) && <ConfidenceCard calibration={data.calibration} />}
				</div>
			</div>
			<LessonMenuLayer actions={actions} />
		</div>
	);
});
