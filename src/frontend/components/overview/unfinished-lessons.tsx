import { memo, useState } from "react";
import type { LessonProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { UNFINISHED_SHOWN, shownRows, stepBlocks } from "./lesson-record-model";
import { UnfinishedRow } from "./lesson-rows";
import { TITLE } from "./styles";
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
		<Pane data-testid="unfinished-lessons" className="flex flex-col gap-1 px-3 pt-4 pb-3">
			<h2 className={`${TITLE} px-2`}>Unfinished</h2>
			<ul className="flex flex-col gap-1">
				{rows.map((l, i) => (
					<UnfinishedRow key={l.chatId} lesson={l} blocks={stepBlocks(l, problemsOf)} withKey={i === 0} actions={actions} />
				))}
			</ul>
			{showAll !== null && (
				<button type="button" data-testid="unfinished-show-all" onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet mt-1 self-start px-2 text-[15px]">
					Show all {showAll}
				</button>
			)}
		</Pane>
	);
});
