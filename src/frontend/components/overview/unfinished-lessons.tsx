import { memo, useState } from "react";
import type { LessonProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { UNFINISHED_SHOWN, shownRows, stepBlocks } from "./lesson-record-model";
import { UnfinishedRow } from "./lesson-rows";
import type { LessonActions } from "./use-lesson-actions";

/**
 * UNFINISHED (Progress, the side column): the lessons not at their end yet,
 * newest first, each with its steps as blocks; the first carries the key.
 */
export const UnfinishedLessons = memo(function UnfinishedLessons({
	lessons,
	problemsOf,
	actions,
}: {
	lessons: readonly LessonProgress[];
	/** A deadline's problems, for a homework lesson's blocks. */
	problemsOf: (deadlineId: string) => { done: number; total: number } | undefined;
	actions: LessonActions;
}) {
	const [shownAll, setShownAll] = useState(false);
	const { rows, showAll } = shownRows(lessons, UNFINISHED_SHOWN, shownAll);
	return (
		<Pane data-testid="unfinished-lessons" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Unfinished</h2>
			</div>
			<ul className="-mx-3 flex flex-col gap-1">
				{rows.map((l, i) => (
					<UnfinishedRow key={l.chatId} lesson={l} blocks={stepBlocks(l, problemsOf)} withKey={i === 0} actions={actions} />
				))}
			</ul>
			{showAll !== null && (
				<button type="button" data-testid="unfinished-show-all" onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet self-start text-[15px]">
					Show all {showAll}
				</button>
			)}
		</Pane>
	);
});
