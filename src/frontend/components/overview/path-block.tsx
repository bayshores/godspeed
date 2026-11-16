import { memo, useState } from "react";
import type { PathProgress } from "@/shared/core";
import { RampRow } from "@/frontend/components/deadline/ramp-row";
import { SHEET, SHEET_TITLE } from "@/frontend/components/deadline/styles";
import { Pane } from "@/frontend/components/ui/pane";
import { pathBlockView } from "./path-block-model";

/**
 * THE PATH (Progress, first): the space's path toward its goal, the topic
 * Study takes with what it covers, the next three, and "Show all" for the
 * rest. The agent writes and changes the path; the learner tells it how.
 */
export const PathBlock = memo(function PathBlock({ path, busy, onStudy }: { path: PathProgress; busy: boolean; onStudy: (topicId: string) => void }) {
	const [shownAll, setShownAll] = useState(false);
	const view = pathBlockView(path, shownAll);
	const next = view.next;
	return (
		<Pane data-testid="space-path" className={SHEET}>
			<h2 className={SHEET_TITLE}>{view.title}</h2>
			{view.allStrong && <p className="text-base text-ink-2">Every topic is strong. Study them to keep it that way.</p>}
			{next && (
				<>
					<div data-testid="space-path-next" className="flex flex-col gap-0.5 py-1">
						<RampRow name={next.name} rate={next.rate} tally={next} />
						<p className="text-base text-ink-2">{next.covers}</p>
					</div>
					<button type="button" data-testid="space-path-study" disabled={busy} onClick={() => onStudy(next.id)} className="lh-btn lh-btn-main h-11 w-full justify-center text-[15px]">
						Study
					</button>
				</>
			)}
			{view.rows.length > 0 && (
				<ul data-testid="space-path-rows" className="flex flex-col gap-1 pt-1">
					{view.rows.map((t) => (
						<li key={t.id}>
							<RampRow name={t.name} rate={t.rate} tally={t} />
						</li>
					))}
				</ul>
			)}
			{view.showAll !== null && (
				<button type="button" data-testid="space-path-show-all" onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet self-start px-1 text-[15px]">
					Show all {view.showAll}
				</button>
			)}
		</Pane>
	);
});
