import { memo, useState } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { UNFINISHED_SHOWN, keyLabel, shownRows, stepBlocks } from "./lesson-record-model";
import { UnfinishedRow } from "./lesson-rows";
import { lessonHref } from "./overview-model";
import type { LessonActions } from "./use-lesson-actions";

/**
 * UNFINISHED (Progress, the side column): the lessons not at their end yet,
 * newest first, each with its steps as blocks. The key in the card's head
 * opens the first.
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
				{rows[0] && (
					<Link to={lessonHref(rows[0].chatId)} data-testid="unfinished-key" className="lh-btn shrink-0">
						{keyLabel(rows[0])}
					</Link>
				)}
			</div>
			<ul className="-mx-3 flex flex-col gap-1">
				{rows.map((l) => (
					<UnfinishedRow key={l.chatId} lesson={l} blocks={stepBlocks(l, problemsOf)} actions={actions} />
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
