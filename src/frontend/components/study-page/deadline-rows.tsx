import { Link } from "react-router";
import { deadlineStudyLabel, hasProblems, studyLabel, type DeadlineProgress } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { WORK_ON_IT, workLabel } from "@/frontend/components/deadline/deadline-keys";
import { countLeft, dueThisWeek } from "@/frontend/components/home-page/home-page-model";
import { DeadlineMarks } from "@/frontend/components/overview/deadline-marks";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { deadlineLine } from "@/frontend/components/space-page/deadlines-tab-model";
import { homeworkStartId } from "@/frontend/components/study-page/use-lesson-start";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Key } from "@/frontend/components/ui/key";
import { Pane } from "@/frontend/components/ui/pane";

/** How many deadlines the Study page shows. */
export const COMING_UP_ROWS = 3;

/**
 * "Coming up" on the Study page: the soonest deadlines as rows, each with
 * its days left on the space's color, its name (its page), the line a
 * Deadlines row has, how far it is drawn as blocks, and Study ("Continue" while its latest session
 * is unfinished), with "Work on it" for a homework or project. "All <n>"
 * opens the Deadlines tab when there are more.
 */
export function DeadlineRows({
	deadlines,
	color,
	nowMs,
	busyOn,
	onStudy,
	onWork,
}: {
	/** Every open deadline ahead, soonest first. */
	deadlines: readonly DeadlineProgress[];
	/** The space's color. */
	color: string;
	nowMs: number;
	busyOn: string | null;
	onStudy: (deadline: DeadlineProgress) => void;
	onWork: (deadline: DeadlineProgress) => void;
}) {
	return (
		<section className="flex flex-col gap-3">
			<div className="lh-card-head">
				<h2 className="lh-card-title">Coming up</h2>
				{deadlines.length > COMING_UP_ROWS && (
					<Link to="/space/deadlines" data-testid="home-deadlines-all" className="lh-btn lh-btn-quiet lh-btn-small">
						All {deadlines.length}
					</Link>
				)}
			</div>
			<ul data-testid="home-deadlines" className="flex flex-1 flex-col gap-(--lh-gap)">
				{deadlines.slice(0, COMING_UP_ROWS).map((d) => (
					<li key={d.id} className="flex flex-1">
						<Pane data-teacher-target={`deadline:${d.id}`} className="flex min-h-[84px] w-full items-center overflow-hidden">
							<CountBlock size="list" color={color} pale={!dueThisWeek(d, nowMs)} {...countLeft(dueAtMs(d), nowMs)} />
							<span className="flex min-w-0 flex-1 flex-col gap-1.5 px-(--lh-inset) py-3">
								<Link to={deadlineHref(d.id)} title={d.name} className="truncate text-xl leading-tight text-ink hover:underline">
									{d.name}
								</Link>
								<span className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-base leading-snug text-ink-2">
									{deadlineLine(d, d, nowMs)}
									<DeadlineMarks deadline={d} />
								</span>
							</span>
							<span className="flex shrink-0 items-center gap-2.5 pr-(--lh-inset)">
								<Key data-testid="home-study-deadline" title={deadlineStudyLabel(d.continueStudy, d.name)} busy={busyOn === d.id} disabled={busyOn !== null} onClick={() => onStudy(d)} className="lh-btn-small">
									{studyLabel(d.continueStudy)}
								</Key>
								{hasProblems(d.kind) && (
									<Key data-testid="home-work-deadline" title={workLabel(d.name)} busy={busyOn === homeworkStartId(d.id)} disabled={busyOn !== null} onClick={() => onWork(d)} className="lh-btn-small">
										{WORK_ON_IT}
									</Key>
								)}
							</span>
						</Pane>
					</li>
				))}
			</ul>
		</section>
	);
}
