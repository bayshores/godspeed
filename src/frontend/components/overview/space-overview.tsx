import { useCallback } from "react";
import { useNavigate } from "react-router";
import type { DeadlineProgress } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useMinute } from "@/frontend/components/countdown";
import { useLessonStart } from "@/frontend/components/study-page/use-lesson-start";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useProgress } from "@/frontend/components/use-progress";
import { PickSpace } from "@/frontend/components/pick-space";
import { useSpaceRecord } from "@/frontend/components/files/space-record";
import { addDeadlineHref } from "@/frontend/components/space-page/deadlines-tab-model";
import { WaitingDeadline } from "@/frontend/components/space-page/waiting-deadline";
import { OverviewBody } from "./overview-body";

/**
 * THE SPACE'S PROGRESS TAB: the body reads the active space's progress
 * (useProgress).
 *
 * With no space and no lessons outside one, it offers the spaces to pick.
 * The path's Study starts a session on its next topic. An interview with
 * no date yet offers "Add the date". The next
 * deadline's button works on it or studies for it, and its "Mark done"
 * and "Undo" save through the open deadlines' one owner; "Most needed"
 * → Study starts a study session on that topic (useLessonStart, in the
 * active space).
 */
export function SpaceOverview() {
	const { active, activeSpace } = useSpaces();
	const { data, error, refresh } = useProgress();
	const navigate = useNavigate();
	const lesson = useLessonStart();
	const nowMs = useMinute();
	const { record } = useSpaceRecord(active);

	// Progress for a space the window just left is never shown.
	const current = data && data.spaceId === active ? data : null;

	const { studyTopics, studyPathTopic, studyDeadline, workOnHomework } = lesson;
	const study = useCallback((topicId: string) => void studyTopics([topicId]), [studyTopics]);
	const studyPath = useCallback((topicId: string) => void studyPathTopic(topicId), [studyPathTopic]);
	const studyFor = useCallback((d: DeadlineProgress) => void studyDeadline(d), [studyDeadline]);
	const workOn = useCallback((d: DeadlineProgress) => void workOnHomework(d), [workOnHomework]);
	const { markDone, undo } = useOpenDeadlines();
	// A deadline is only drawn for the active space. Progress is read again at once, so the card does not wait for the save's event.
	const done = useCallback((d: DeadlineProgress) => void (active && markDone({ spaceId: active, id: d.id }).then(refresh)), [active, markDone, refresh]);
	const notDone = useCallback((d: DeadlineProgress) => void (active && undo({ spaceId: active, id: d.id }).then(refresh)), [active, undo, refresh]);

	return (
		<div className="h-full overflow-y-auto">
			<OverviewBody
				key={active ?? "none"}
				hasSpace={!!activeSpace}
				color={activeSpace ? spaceColorVar(activeSpace.color) : "var(--border)"}
				note={activeSpace?.note}
				data={current}
				nowMs={nowMs}
				busyOn={lesson.busyOn}
				startError={lesson.error}
				onStudy={study}
				onStudyPath={studyPath}
				onStudyDeadline={studyFor}
				onWorkDeadline={workOn}
				onDeadlineDone={done}
				onDeadlineUndo={notDone}
				onAddDeadline={() => navigate(addDeadlineHref())}
				waiting={<WaitingDeadline record={record} />}
				pickSpace={!active && current?.lessons.length === 0 ? <PickSpace line="Pick a space to see how it's going." /> : undefined}
			/>
			{!current && error && <LoadFailed message="Couldn't load this space's progress." onRetry={refresh} className="lh-page pt-(--lh-gap)" />}
		</div>
	);
}
