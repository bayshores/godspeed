import { Fragment } from "react";
import { deadlineStudyLabel, hasProblems, type DeadlineProgress } from "@/shared/core";
import { workLabel } from "@/frontend/components/deadline/deadline-keys";
import { homeworkStartId } from "@/frontend/components/study-page/use-lesson-start";
import { Key } from "@/frontend/components/ui/key";

/** The Study page's one-click Study for each upcoming deadline ("Continue
 *  studying for" while its latest session is unfinished), and Work on
 *  after a homework's or project's. */
export function DeadlineStarts({
	deadlines,
	busyOn,
	onStudy,
	onWork,
}: {
	deadlines: readonly DeadlineProgress[];
	busyOn: string | null;
	onStudy: (deadline: DeadlineProgress) => void;
	onWork: (deadline: DeadlineProgress) => void;
}) {
	return (
		<div data-testid="home-deadlines" className="flex flex-wrap gap-2.5">
			{deadlines.map((d) => (
				<Fragment key={d.id}>
					<Key data-testid="home-study-deadline" busy={busyOn === d.id} disabled={busyOn !== null} onClick={() => onStudy(d)} className="text-[15px]">
						{deadlineStudyLabel(d.continueStudy, d.name)}
					</Key>
					{hasProblems(d.kind) && (
						<Key data-testid="home-work-deadline" busy={busyOn === homeworkStartId(d.id)} disabled={busyOn !== null} onClick={() => onWork(d)} className="text-[15px]">
							{workLabel(d.name)}
						</Key>
					)}
				</Fragment>
			))}
		</div>
	);
}
