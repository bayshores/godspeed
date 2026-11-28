import { memo, useMemo, useState } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { useListMotion } from "@/frontend/components/presence";
import { KeyHint, keyShortcutProps } from "@/frontend/components/ui/key-hint";
import { Pane } from "@/frontend/components/ui/pane";
import { FINISHED_SHOWN, dayWord, shownRows } from "./lesson-record-model";
import { FINISHED_LIST, FinishedRow, lessonItems } from "./lesson-rows";
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
	const { rows, showAll } = useMemo(() => shownRows(finished ?? [], FINISHED_SHOWN, shownAll), [finished, shownAll]);
	// Every loaded lesson is seen, so the rows "Show all" uncovers are simply there.
	const listed = useListMotion(
		useMemo(() => lessonItems(rows), [rows]),
		{ drawn: finished !== null, seen: (finished ?? []).map((l) => l.chatId) },
	);
	const days = listed.map(({ item }) => (nowMs !== null ? dayWord(item.lesson.updatedAt, nowMs) : ""));
	return (
		<Pane data-testid="lesson-record" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Lessons</h2>
				<Link to="/new" data-testid="study-something-new" {...keyShortcutProps("new-session")} className="lh-btn shrink-0">
					Study something new
					<KeyHint action="new-session" />
				</Link>
			</div>
			{none && <p className="text-ui text-ink-2">No lessons yet.</p>}
			{listed.length > 0 && (
				<ul className={`-mx-3 ${FINISHED_LIST}`}>
					{listed.map(({ item, ...moves }, i) => (
						<FinishedRow key={item.key} lesson={item.lesson} day={i === 0 || days[i] !== days[i - 1] ? days[i]! : null} actions={actions} {...moves} />
					))}
				</ul>
			)}
			{showAll !== null && (
				<button type="button" data-testid="lesson-show-all" onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet lh-btn-flush self-start">
					Show all {showAll}
				</button>
			)}
		</Pane>
	);
});
