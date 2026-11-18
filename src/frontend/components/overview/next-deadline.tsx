import { memo } from "react";
import { Link } from "react-router";
import { hasProblems, longDay, rampColor, studyLabel, type DeadlineProgress } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { countLeft } from "@/frontend/components/home-page/home-page-model";
import { DeadlineKeys } from "@/frontend/components/deadline/deadline-keys";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { StepBlocks } from "./lesson-rows";
import { deadlineHref, progressWords } from "./overview-model";
import { MAIN_KEY, SHEET } from "./styles";

/**
 * THE NEXT DEADLINE (Progress, top of the side column): the time left as a
 * band across the card's top, the deadline's name (its page) and day, how
 * far it is drawn as blocks (its topics weakest first, or a homework's
 * problems) with one line of words once something is measured, and its
 * key(s) at the end. In a card wider than a side column (a narrow window
 * stacks the columns) the time left is a tile down the card's left side and
 * the keys sit at the right, as on a Deadlines row. With none: one line and
 * "Add a deadline".
 */
export const NextDeadline = memo(function NextDeadline({
	deadline: d,
	none,
	color,
	nowMs,
	busy,
	onStudy,
	onWork,
	onAddDeadline,
}: {
	/** The soonest open deadline; null with none ahead. */
	deadline: DeadlineProgress | null;
	/** What to say with none ahead. */
	none: string;
	/** The space's color. */
	color: string;
	nowMs: number;
	/** A lesson is starting. */
	busy: boolean;
	onStudy: (d: DeadlineProgress) => void;
	onWork: (d: DeadlineProgress) => void;
	onAddDeadline: () => void;
}) {
	if (!d) {
		return (
			<Pane data-testid="next-deadline-none" className={`flex flex-wrap items-center justify-end gap-4 ${SHEET}`}>
				<p className="min-w-0 flex-1 basis-[160px] text-[17px] text-ink-2">{none}</p>
				<button type="button" data-testid="next-deadline-add" onClick={onAddDeadline} className="lh-btn shrink-0">
					<PixelIcon name="plus" />
					Add a deadline
				</button>
			</Pane>
		);
	}
	const words = progressWords(d);
	return (
		// Cut to the sheet's corners, so the band follows them.
		<Pane data-testid="next-deadline" data-teacher-target={`deadline:${d.id}`} className="@container overflow-hidden">
			<div className="flex flex-col @[480px]:flex-row">
				<CountBlock size="band" color={color} {...countLeft(dueAtMs(d), nowMs)} className="h-24 w-auto @[480px]:h-auto @[480px]:w-[116px]" />
				<div className={`flex min-w-0 flex-1 flex-col gap-4 @[480px]:flex-row @[480px]:items-end @[480px]:gap-6 ${SHEET}`}>
					<div className="flex min-w-0 flex-1 flex-col gap-4">
						<div className="flex flex-col gap-1">
							<Link to={deadlineHref(d.id)} data-testid="next-deadline-open" title={d.name} className="line-clamp-2 text-[28px] leading-[1.3] text-ink hover:underline">
								{d.name}
							</Link>
							<p className="font-count text-lg text-ink-2">{longDay(d.date)}</p>
						</div>
						{words && (
							<div data-testid="next-deadline-progress" className="flex flex-col gap-2">
								{d.problems ? (
									<StepBlocks done={d.problems.done} total={d.problems.total} />
								) : (
									d.topics.length > 0 && (
										<span aria-hidden className="flex flex-wrap gap-[3px]">
											{d.topics.map((t) => (
												<span key={t.id} title={t.name} className="size-3" style={{ background: rampColor(t.rate) }} />
											))}
										</span>
									)
								)}
								<p className="text-[15px] text-ink">{words}</p>
							</div>
						)}
					</div>
					{hasProblems(d.kind) ? (
						<DeadlineKeys deadline={d} busy={busy} narrow onStudy={() => onStudy(d)} onWork={() => onWork(d)} />
					) : (
						<button type="button" data-testid="next-deadline-start" disabled={busy} onClick={() => onStudy(d)} className={`${MAIN_KEY} self-end`}>
							<span className="min-w-0 truncate">{studyLabel(d.continueStudy)}</span>
						</button>
					)}
				</div>
			</div>
		</Pane>
	);
});
