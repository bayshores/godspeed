import { memo, useState } from "react";
import type { PathProgress } from "@/shared/core";
import { RampRow } from "@/frontend/components/deadline/ramp-row";
import { Key } from "@/frontend/components/ui/key";
import { Pane } from "@/frontend/components/ui/pane";
import { pathBlockView } from "./path-block-model";
import { MAIN_KEY } from "./styles";

/**
 * THE PATH (Progress, side column): the space's path toward its goal, the
 * topic Study takes with what it covers, the next three, and "Show all" for
 * the rest. With no deadline ahead it is the page's first card and its Study
 * the page's one dark key; beside a deadline its Study is grey. The agent
 * writes and changes the path; the learner tells it how.
 */
export const PathBlock = memo(function PathBlock({ path, main, busyOn, onStudy }: { path: PathProgress; main: boolean; busyOn: string | null; onStudy: (topicId: string) => void }) {
	const [shownAll, setShownAll] = useState(false);
	const view = pathBlockView(path, shownAll);
	const next = view.next;
	return (
		<Pane data-testid="space-path" className="lh-card">
			<div className="lh-card-head">
				{/* The count stays whole, so "of 7" never sits alone on a line. */}
				<h2 className="lh-card-title">
					{view.title}
					{view.count && <span className="font-count text-base whitespace-nowrap text-ink-2">{` ${view.count}`}</span>}
				</h2>
			</div>
			{view.allStrong && <p className="text-base text-ink-2">Every topic is strong. Study them to keep it that way.</p>}
			{next && (
				<div className="flex flex-wrap items-end justify-end gap-x-6 gap-y-3">
					<div data-testid="space-path-next" className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
						<RampRow name={next.name} rate={next.rate} tally={next} />
						<p className="text-base text-ink-2">{next.covers}</p>
					</div>
					<Key
						data-testid="space-path-study"
						busy={busyOn === next.id}
						disabled={busyOn !== null}
						onClick={() => onStudy(next.id)}
						className={main ? MAIN_KEY : "shrink-0"}
					>
						Study
					</Key>
				</div>
			)}
			{view.rows.length > 0 && (
				<ul data-testid="space-path-rows" className="flex flex-col gap-1">
					{view.rows.map((t) => (
						<li key={t.id}>
							<RampRow name={t.name} rate={t.rate} tally={t} />
						</li>
					))}
				</ul>
			)}
			{view.showAll !== null && (
				<button type="button" data-testid="space-path-show-all" onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet self-start text-[15px]">
					Show all {view.showAll}
				</button>
			)}
		</Pane>
	);
});
