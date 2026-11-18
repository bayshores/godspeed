import { memo } from "react";
import { Pane } from "@/frontend/components/ui/pane";
import { joinAnd, type MostNeeded as Needed } from "./overview-model";

/** MOST NEEDED (Progress, side column): the weakest topic on the deadlines
 *  ahead, the deadlines it is on, and "Study" to start a lesson on it. */
export const MostNeeded = memo(function MostNeeded({ needed, busy, onStudy }: { needed: Needed; busy: boolean; onStudy: (topicId: string) => void }) {
	return (
		<Pane data-testid="most-needed" className="lh-card">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Most needed</h2>
			</div>
			<div className="flex items-end gap-3.5">
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span title={needed.name} className="line-clamp-2 text-[17px] leading-snug text-ink">
						{needed.name}
					</span>
					<span className="text-base text-ink-2">On {joinAnd(needed.deadlines)}</span>
				</span>
				<button type="button" data-testid="most-needed-study" disabled={busy} onClick={() => onStudy(needed.topicId)} className="lh-btn shrink-0">
					Study
				</button>
			</div>
		</Pane>
	);
});
