import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { hasProblems, type DeadlineProgress } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { SpaceDialog } from "@/frontend/components/space-dialog";
import { useMinute } from "@/frontend/components/countdown";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { ADD_DEADLINE_HREF } from "@/frontend/components/space-page/deadlines-tab-model";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useWorker } from "@/frontend/components/work/use-worker";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { highlight, waitForTarget } from "@/frontend/components/teacher/dom";
import { spacesSettled, todayLists } from "./home-page-model";
import { TodayBody } from "./today-body";
import { useNewFiles } from "./use-new-files";
import { useSpacesProgress } from "./use-spaces-progress";

/**
 * TODAY ("/"): reads the open spaces, their deadlines, progress and new
 * files, and hands them to TodayBody. Its Start begins or continues the
 * deadline's lesson; "Add a deadline" opens the dialog on a space's
 * Deadlines tab.
 */
export function HomePage() {
	const { spaces, loaded, setActive } = useSpaces();
	const shown = useMemo(() => spaces.filter((c) => !c.closed), [spaces]);
	const { deadlines, doneToday, error: deadlinesError, markDone, undo, reload: reloadDeadlines } = useOpenDeadlines();
	const shownIds = useMemo(() => shown.map((c) => c.id), [shown]);
	const spacesProgress = useSpacesProgress(shownIds);
	const newFiles = useNewFiles(shown);
	const { worker } = useWorker();
	// The sections' words need each space's progress and new files, so they
	// wait for them the first time and never change under the reader.
	const [progressReady, setProgressReady] = useState(false);
	if (!progressReady && shown.length > 0 && spacesSettled(shownIds, spacesProgress) && newFiles.settled) setProgressReady(true);
	const nowMs = useMinute();
	const navigate = useNavigate();
	const [addingSpace, setAddingSpace] = useState(false);
	// The dialog compares its mode by identity: one object per open.
	const createMode = useMemo(() => (addingSpace ? { kind: "create" as const } : null), [addingSpace]);
	const addDeadline = useCallback(
		(spaceId: string) => {
			setActive(spaceId);
			navigate(ADD_DEADLINE_HREF);
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

	const { studyDeadline, workOnHomework, continueStopped } = lesson;
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
	const lists = useMemo(() => (deadlines && nowMs !== null ? todayLists(deadlines, doneToday, nowMs) : null), [deadlines, doneToday, nowMs]);

	// Back from a lesson's Stop here (?lit=deadline:<id>): its card or row lights once.
	const [params, setParams] = useSearchParams();
	const lit = params.get("lit");
	useEffect(() => {
		if (!lit?.startsWith("deadline:") || !ready) return;
		let alive = true;
		void waitForTarget({ kind: "deadline", id: lit.slice("deadline:".length) }, 3000, () => alive).then((els) => {
			if (!alive) return;
			// The pane, which covers its card or list item.
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
		// A short page sits a little above the middle of the window: the space left over is
		// shared 2 to 3 above and below it.
		<div data-testid="home-page" className="flex h-full flex-col overflow-y-auto before:flex-[2] after:flex-[3]">
			<TodayBody
				nowMs={nowMs}
				ready={ready}
				spaces={shown}
				lists={lists}
				deadlineProgress={deadlineProgress}
				spacesProgress={spacesProgress.progress}
				noSpaceProgress={spacesProgress.noSpace}
				progressErrors={spacesProgress.errors}
				worker={worker}
				newFiles={newFiles.lines}
				busy={lesson.busy}
				lessonError={lesson.error}
				onStart={onStart}
				onDone={markDone}
				onUndo={undo}
				onRetry={() => void reloadDeadlines()}
				onAddSpace={() => setAddingSpace(true)}
				onAddDeadline={addDeadline}
				onOpenSpace={setActive}
			/>
			<SpaceDialog mode={createMode} onClose={() => setAddingSpace(false)} />
		</div>
	);
}
