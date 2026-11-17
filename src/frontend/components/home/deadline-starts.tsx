import { Fragment } from "react";
import { deadlineStudyLabel, hasProblems, type DeadlineProgress } from "@/shared/core";
import { workLabel } from "@/frontend/components/deadline/deadline-keys";

/** The Study page's one-click Study for each upcoming deadline ("Continue
 *  studying for" while its latest session is unfinished), and Work on
 *  after a homework's or project's. */
export function DeadlineStarts({
	deadlines,
	busy,
	onStudy,
	onWork,
}: {
	deadlines: readonly DeadlineProgress[];
	busy: boolean;
	onStudy: (deadline: DeadlineProgress) => void;
	onWork: (deadline: DeadlineProgress) => void;
}) {
	return (
		<div data-testid="home-deadlines" className="flex flex-wrap gap-2.5">
			{deadlines.map((d) => (
				<Fragment key={d.id}>
					<button type="button" data-testid="home-study-deadline" disabled={busy} onClick={() => onStudy(d)} className="lh-btn text-[15px]">
						{deadlineStudyLabel(d.continueStudy, d.name)}
					</button>
					{hasProblems(d.kind) && (
						<button type="button" data-testid="home-work-deadline" disabled={busy} onClick={() => onWork(d)} className="lh-btn text-[15px]">
							{workLabel(d.name)}
						</button>
					)}
				</Fragment>
			))}
		</div>
	);
}
