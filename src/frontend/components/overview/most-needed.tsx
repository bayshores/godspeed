import { memo } from "react";
import { joinAnd, type MostNeeded as Needed } from "./overview-model";
import { TITLE } from "./styles";

/** MOST NEEDED (Progress): the weakest topic on the deadlines ahead, the
 *  deadlines it is on, and "Study" to start a lesson on it. */
export const MostNeeded = memo(function MostNeeded({ needed, busy, onStudy }: { needed: Needed; busy: boolean; onStudy: (topicId: string) => void }) {
	return (
		<section data-testid="most-needed" className="flex flex-col">
			<h2 className={TITLE}>Most needed</h2>
			<div className="flex items-center gap-3.5 px-1 py-[13px]">
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span title={needed.name} className="truncate text-[17px] text-ink">
						{needed.name}
					</span>
					<span className="truncate text-base text-ink-2">On {joinAnd(needed.deadlines)}</span>
				</span>
				<button type="button" data-testid="most-needed-study" disabled={busy} onClick={() => onStudy(needed.topicId)} className="lh-btn h-[38px] shrink-0 text-[15px]">
					Study
				</button>
			</div>
		</section>
	);
});
