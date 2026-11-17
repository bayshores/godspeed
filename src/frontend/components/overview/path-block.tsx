import { memo, useState } from "react";
import type { PathProgress } from "@/shared/core";
import { RampRow } from "@/frontend/components/deadline/ramp-row";
import { SHEET_TITLE } from "@/frontend/components/deadline/styles";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { pathBlockView } from "./path-block-model";

/**
 * THE PATH (Progress, side column): the space's path toward its goal, the
 * topic Study takes with what it covers, the next three, and "Show all" for
 * the rest. With no deadline ahead it is the page's first card and its Study
 * the page's one dark key; beside a deadline its Study is grey. The agent
 * writes and changes the path; the learner tells it how.
 */
export const PathBlock = memo(function PathBlock({ path, main, busy, onStudy }: { path: PathProgress; main: boolean; busy: boolean; onStudy: (topicId: string) => void }) {
	const [shownAll, setShownAll] = useState(false);
	const view = pathBlockView(path, shownAll);
	const next = view.next;
	return (
		<Pane data-testid="space-path" className="flex flex-col gap-2.5 p-5">
			<h2 className={SHEET_TITLE}>{view.title}</h2>
			{view.allStrong && <p className="text-base text-ink-2">Every topic is strong. Study them to keep it that way.</p>}
			{next && (
				<div className="flex flex-wrap items-end justify-end gap-x-6 gap-y-3 py-1">
					<div data-testid="space-path-next" className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
						<RampRow name={next.name} rate={next.rate} tally={next} />
						<p className="text-base text-ink-2">{next.covers}</p>
					</div>
					<button
						type="button"
						data-testid="space-path-study"
						disabled={busy}
						onClick={() => onStudy(next.id)}
						className={cn("lh-btn shrink-0", main && "lh-btn-main h-[52px] px-8 text-[17px]")}
					>
						Study
					</button>
				</div>
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
