import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { hasProblems, isRhythmGap, type DeadlineProgress, type RhythmGap } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { useOpenInSpace } from "@/frontend/components/use-join-space";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { useMinute } from "@/frontend/components/countdown";
import { useLessonStart } from "@/frontend/components/study-page/use-lesson-start";
import { addDeadlineHref } from "@/frontend/components/space-page/deadlines-tab-model";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { highlight, waitForTarget } from "@/frontend/components/teacher/dom";
import { spacesSettled, homeLists } from "./home-page-model";
import { HomeBody } from "./home-body";
import { useNewFiles } from "./use-new-files";
import { useSpacesProgress } from "./use-spaces-progress";

/**
 * TODAY ("/"): reads the open spaces, their deadlines, progress and new
 * files, and hands them to HomeBody. Its Start begins or continues the
 * deadline's lesson; "Add a deadline" opens the dialog on a space's
 * Deadlines tab.
 */
export function HomePage() {
	const { spaces, loaded, setActive } = useSpaces();
	const shown = useMemo(() => spaces.filter((c) => !c.closed), [spaces]);
	const { deadlines, doneToday, gaps, error: deadlinesError, markDone, undo, reload: reloadDeadlines } = useOpenDeadlines();
	const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
	const outlines = useMemo(() => gaps.filter((g): g is RhythmGap => isRhythmGap(g) && shownIds.includes(g.spaceId)), [gaps, shownIds]);
	const spacesProgress = useSpacesProgress(shownIds);
	const newFiles = useNewFiles(shown);
	// The sections' words need each space's progress and new files, so they
	// wait for them the first time and never change under the reader.
	const [progressReady, setProgressReady] = useState(false);
	if (!progressReady && shown.length > 0 && spacesSettled(shownIds, spacesProgress) && newFiles.settled) setProgressReady(true);
	const nowMs = useMinute();
	const openInSpace = useOpenInSpace();
	const [addingSpace, setAddingSpace] = useState(false);
	// The dialog compares its mode by identity: one object per open.
	const createMode = useMemo(() => (addingSpace ? { kind: "create" as const } : null), [addingSpace]);
	const addDeadline = useCallback(
		(spaceId: string) => {
			openInSpace(spaceId, addDeadlineHref());
		},
		[openInSpace],
	);
	const lesson = useLessonStart();

	// Each deadline's topics, problems and unfinished session, from its space's progress.
	const deadlineProgress = useMemo(() => {
		const map = new Map<string, DeadlineProgress>();
		for (const p of spacesProgress.progress.values()) for (const d of p.deadlines) map.set(d.id, d);
		return map;
	}, [spacesProgress]);

	const { studyDeadline, workOnHomework, continueStopped, studyTopics, start } = lesson;
	const onStudyTopic = useCallback(
		(spaceId: string, topicId: string) => {
			setActive(spaceId);
			void studyTopics([topicId], spaceId);
		},
		[setActive, studyTopics],
	);
	const onStudyTyped = useCallback(
		(spaceId: string, title: string) => {
			setActive(spaceId);
			void start({ title, spaceId });
		},
		[setActive, start],
	);
	const onStart = useCallback(
		(d: OpenDeadline) => {
			setActive(d.spaceId);
			const progress = deadlineProgress.get(d.id);
			const next = progress?.continueStudy;
			if (hasProblems(d.kind)) void workOnHomework({ id: d.id, continueHomework: progress?.continueHomework }, d.spaceId);
			// Continue at a stop goes on from it: the next topic's opener shows.
			else if (next?.stop) void continueStopped(next.chatId);
			else void studyDeadline({ id: d.id, continueStudy: next }, d.spaceId);
		},
		[setActive, studyDeadline, workOnHomework, continueStopped, deadlineProgress],
	);

	const ready = nowMs !== null && loaded && (deadlines !== null || deadlinesError !== null) && (shown.length === 0 || progressReady);
	const lists = useMemo(() => (deadlines && nowMs !== null ? homeLists(deadlines, doneToday, nowMs) : null), [deadlines, doneToday, nowMs]);

	// Back from a lesson's Done for today (?lit=deadline:<id>): its card lights once.
	const [params, setParams] = useSearchParams();
	const lit = params.get("lit");
	useEffect(() => {
		if (!lit?.startsWith("deadline:") || !ready) return;
		let alive = true;
		void waitForTarget({ kind: "deadline", id: lit.slice("deadline:".length) }, 3000, () => alive).then((els) => {
			if (!alive) return;
			// What it holds: the card's face or a week block.
			const row = els[0]?.firstElementChild;
			if (row instanceof HTMLElement) highlight(row);
			setParams(
				(p) => {
					p.delete("lit");
					return p;
				},
				{ replace: true },
			);
		});
		return () => {
			alive = false;
		};
	}, [lit, ready, setParams]);

	return (
		<div data-testid="home-page" className="h-full overflow-y-auto">
			<HomeBody
				nowMs={nowMs}
				ready={ready}
				spaces={shown}
				lists={lists}
				outlines={outlines}
				deadlineProgress={deadlineProgress}
				spacesProgress={spacesProgress.progress}
				noSpaceProgress={spacesProgress.noSpace}
				progressErrors={spacesProgress.errors}
				newFiles={newFiles.lines}
				busyOn={lesson.busyOn}
				lessonError={lesson.error}
				onStart={onStart}
				onDone={markDone}
				onUndo={undo}
				onRetry={() => void reloadDeadlines()}
				onAddSpace={() => setAddingSpace(true)}
				onAddDeadline={addDeadline}
				onOpenSpace={setActive}
				onStudyTopic={onStudyTopic}
				onStudyTyped={onStudyTyped}
			/>
			<SpaceDialog mode={createMode} onClose={() => setAddingSpace(false)} />
		</div>
	);
}
