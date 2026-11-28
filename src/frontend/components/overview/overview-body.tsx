import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { useWaited } from "@/frontend/components/loading";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { useSheetGlide } from "@/frontend/components/use-sheet-glide";
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
import { StartCard, StartTiles } from "./start-tiles";
import { deadlineAfter, hasCalibration, mostNeeded, shownDeadline, upcomingDeadlines } from "./overview-model";
import { NotesCard } from "./notes-card";
import { TeacherNote } from "./teacher-note";
import { LessonCard } from "./lesson-card";
import { useLessonActions } from "./use-lesson-actions";
import { useStickyTop } from "./use-sticky-top";
import { ErrorLine } from "@/frontend/components/error-line";

/**
 * The Progress tab under the space head (pure view, the render-test seam).
 * What to do sits in a narrow side column: the next deadline (the one its
 * "Next" turned to, or one just ticked done; with none, the path), an
 * interview waiting for its date, the unfinished
 * lessons, the path beside a deadline, and "Most needed". The record sits in
 * the wide column: the teacher's note, the finished lessons, the fact grid
 * and the confidence chart. Each shows only once it has something to show,
 * but for the Lessons heading, which shows while loading too; a space's
 * deadline, path and facts are left out for "Lessons with no space". With
 * nothing in the side column the wide one takes the whole width. A space with
 * no files, deadline, path or lesson shows only the card of ways to start; one
 * with no deadline and no path offers the ways to add them where the deadline
 * would be. The side column sticks while the record scrolls, so what to do
 * stays in view; in a narrow window it goes on top instead.
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
	onDeadlineDone,
	onDeadlineUndo,
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
	/** The next deadline's Mark done and Undo. */
	onDeadlineDone: (d: DeadlineProgress) => void;
	onDeadlineUndo: (d: DeadlineProgress) => void;
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
	// The card goes with its last lesson, holding it while both fade.
	const unfinishedCard = useLastWhileClosing(data && unfinished.length > 0 ? unfinished : null);

	const spaceData = hasSpace && data && nowMs !== null ? data : null;
	// The deadline "Next" turned the card to, or the one ticked done on it; back to the soonest on a new visit.
	const [pickedId, setPickedId] = useState<string | null>(null);
	const next = data ? shownDeadline(data.deadlines, upcoming, pickedId) : null;
	const afterId = next && deadlineAfter(upcoming, next)?.id;
	const turnToNext = useCallback(() => setPickedId(afterId ?? null), [afterId]);
	// A ticked one leaves the ones ahead, so it is picked to stay on the card with its Undo.
	const markDone = useCallback(
		(d: DeadlineProgress) => {
			setPickedId(d.id);
			onDeadlineDone(d);
		},
		[onDeadlineDone],
	);
	const cardGlide = useSheetGlide(false, true);
	// With no deadline ahead the path takes the deadline card's place, and its key.
	const pathFirst = !!spaceData?.path && next === null;
	const side = spaceData !== null || unfinished.length > 0 || startError !== null;
	const [sideRef, sideTop] = useStickyTop();
	// A space with nothing in it: one card of ways to start, in place of the empty boxes.
	const blank = !!spaceData && spaceData.files.length === 0 && spaceData.deadlines.length === 0 && !spaceData.path && spaceData.lessons.length === 0;
	if (blank) {
		return (
			<div data-testid="space-overview" className="@container lh-page flex flex-col gap-(--lh-gap) pt-(--lh-gap) pb-(--lh-page-end)">
				<StartCard color={color} onAddDeadline={onAddDeadline} />
			</div>
		);
	}

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
								// The card glides to the height of another deadline, or of its done form, so the column below moves once.
								<div ref={cardGlide}>
									<NextDeadline
										deadline={next}
										none={spaceData.deadlines.length === 0 ? "No deadlines yet" : "Nothing is coming up."}
										color={color}
										nowMs={nowMs!}
										busyOn={busyOn}
										onStudy={onStudyDeadline}
										onWork={onWorkDeadline}
										onDone={markDone}
										onUndo={onDeadlineUndo}
										onNext={afterId ? turnToNext : undefined}
										onAddDeadline={onAddDeadline}
										starts={spaceData.deadlines.length === 0 ? <StartTiles ways={["deadline", "path"]} color={color} onAddDeadline={onAddDeadline} /> : undefined}
									/>
								</div>
							))}
						{hasSpace && waiting}
						<ErrorLine error={startError} data-testid="start-error" className="text-ui text-ans-wrong" />
						{unfinishedCard.mounted && unfinishedCard.shown && (
							<LessonCard title="Unfinished" name="unfinished" lessons={unfinishedCard.shown} actions={actions} headKey leaving={unfinishedCard.state === "closed"} />
						)}
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
