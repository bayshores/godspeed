import { deadlineStudyLabel, type DeadlineProgress } from "@/shared/core";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/** The Study page's one-click Study for each upcoming deadline ("Continue
 *  studying for" while its latest session is unfinished). */
export function DeadlineStarts({
	deadlines,
	busy,
	onStudy,
}: {
	deadlines: readonly DeadlineProgress[];
	busy: boolean;
	onStudy: (deadline: DeadlineProgress) => void;
}) {
	return (
		<div data-testid="home-deadlines" className="flex flex-wrap gap-2.5">
			{deadlines.map((d) => (
				<button key={d.id} type="button" data-testid="home-study-deadline" disabled={busy} onClick={() => onStudy(d)} className="lh-btn text-[15px]">
					<PixelIcon name="play" />
					{deadlineStudyLabel(d.continueStudy, d.name)}
				</button>
			))}
		</div>
	);
}
