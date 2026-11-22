import { memo, useState } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { UNFINISHED_SHOWN, keyLabel, shownRows, stepBlocks } from "./lesson-record-model";
import { UnfinishedRow } from "./lesson-rows";
import { lessonHref } from "./overview-model";
import type { LessonActions } from "./use-lesson-actions";

/**
 * A CARD OF LESSONS, each with its steps as blocks: Progress's Unfinished
 * (the side column, with a key in its head that opens the first) and a
 * deadline's Lessons (under its path, where the path's key opens the
 * first). `name` starts its test ids.
 */
export const LessonCard = memo(function LessonCard({
	title,
	name,
	lessons,
	actions,
	headKey = false,
}: {
	title: string;
	name: "unfinished" | "deadline";
	/** In the order shown. */
	lessons: readonly LessonProgress[];
	actions: LessonActions;
	headKey?: boolean;
}) {
	const [shownAll, setShownAll] = useState(false);
	const { rows, showAll } = shownRows(lessons, UNFINISHED_SHOWN, shownAll);
	return (
		<Pane data-testid={`${name}-lessons`} className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">{title}</h2>
				{headKey && rows[0] && (
					<Link to={lessonHref(rows[0].chatId)} data-testid={`${name}-key`} className="lh-btn shrink-0">
						{keyLabel(rows[0])}
					</Link>
				)}
			</div>
			<ul className="-mx-3 flex flex-col gap-1">
				{rows.map((l) => (
					<UnfinishedRow key={l.chatId} lesson={l} blocks={stepBlocks(l)} actions={actions} />
				))}
			</ul>
			{showAll !== null && (
				<button type="button" data-testid={`${name}-show-all`} onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet self-start">
					Show all {showAll}
				</button>
			)}
		</Pane>
	);
});
