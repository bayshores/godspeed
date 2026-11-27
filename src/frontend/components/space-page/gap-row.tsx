import type { RhythmGap, SpaceColor } from "@/shared/core";
import { gapDueMs } from "@/frontend/components/countdown-model";
import { countLeft } from "@/frontend/components/home-page/home-page-model";
import { useAnswerGap } from "@/frontend/components/use-open-deadlines";
import { OutlineRow } from "./outline-row";

/**
 * The space's outline in "Coming up": a deadline that looks missing, on the day it was expected,
 * with the server's words. "Add it myself" opens Add a deadline filled in; the quiet key waves it
 * off. The tab's head asks the teacher, so the row does not.
 */
export function GapRow({ gap, color, nowMs, onAdd }: { gap: RhythmGap; color: SpaceColor; nowMs: number; onAdd: () => void }) {
	const answering = useAnswerGap(gap);
	return (
		<OutlineRow
			testid="gap-row"
			color={color}
			count={countLeft(gapDueMs(gap), nowMs)}
			name={gap.label}
			line={
				answering.error ? (
					<span role="alert" className="text-ans-wrong">
						{answering.error}
					</span>
				) : (
					gap.line
				)
			}
			keys={
				<>
					<button type="button" data-testid="gap-row-answer" disabled={answering.busy} onClick={answering.answer} className="lh-btn lh-btn-small lh-btn-quiet">
						{gap.answer}
					</button>
					<button type="button" data-testid="gap-row-add" disabled={answering.busy} onClick={onAdd} className="lh-btn lh-btn-small">
						Add it myself
					</button>
				</>
			}
		/>
	);
}
