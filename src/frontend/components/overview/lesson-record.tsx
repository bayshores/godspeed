import { memo, useState } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { CARD_HEAD, CARD_TITLE } from "@/frontend/components/home-page/styles";
import { Pane } from "@/frontend/components/ui/pane";
import { FINISHED_SHOWN, dayWord, shownRows } from "./lesson-record-model";
import { FinishedRow } from "./lesson-rows";
import type { LessonActions } from "./use-lesson-actions";

/**
 * LESSONS (Progress, the wide column): "Study something new", then the
 * finished lessons newest first as an answer sheet, the day said once where
 * it changes, with "Show all" for the rest. The unfinished ones sit in the
 * side column, never here too.
 */
export const LessonRecord = memo(function LessonRecord({
	finished,
	none,
	nowMs,
	actions,
}: {
	/** null while the payload is loading or failed. */
	finished: readonly LessonProgress[] | null;
	/** The space has no lesson at all, finished or not. */
	none: boolean;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
	actions: LessonActions;
}) {
	const [shownAll, setShownAll] = useState(false);
	const { rows, showAll } = shownRows(finished ?? [], FINISHED_SHOWN, shownAll);
	const days = rows.map((l) => (nowMs !== null ? dayWord(l.updatedAt, nowMs) : ""));
	return (
		<Pane data-testid="lesson-record" className="flex flex-col pb-4">
			<div className={CARD_HEAD}>
				<h2 className={CARD_TITLE}>Lessons</h2>
				<Link to="/new" data-testid="study-something-new" className="lh-btn shrink-0">
					Study something new
				</Link>
			</div>
			{none && <p className="px-6 pb-1 text-base text-ink-2">No lessons yet.</p>}
			{rows.length > 0 && (
				<ul className="flex flex-col gap-0.5 px-3">
					{rows.map((l, i) => {
						const newDay = i === 0 || days[i] !== days[i - 1];
						return <FinishedRow key={l.chatId} lesson={l} day={newDay ? days[i]! : null} spaced={newDay && i > 0} actions={actions} />;
					})}
				</ul>
			)}
			{showAll !== null && (
				<button type="button" data-testid="lesson-show-all" onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet mt-1.5 ml-[18px] self-start px-1.5 text-[15px]">
					Show all {showAll}
				</button>
			)}
		</Pane>
	);
});
