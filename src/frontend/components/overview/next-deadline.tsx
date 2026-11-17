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

/**
 * THE NEXT DEADLINE (Progress, top of the side column): the time left
 * across the card, the deadline's name (its page) and day, how far it is
 * drawn as blocks (its topics weakest first, or a homework's problems) with
 * one line of words, and its key(s) at the end. In a card wider than a side
 * column (a narrow window stacks the columns) the time left sits at the left
 * and the keys at the right. With none: one line and "Add a
 * deadline".
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
			<Pane data-testid="next-deadline-none" className="flex flex-wrap items-center justify-end gap-4 p-5">
				<p className="min-w-0 flex-1 basis-[160px] text-[17px] text-ink-2">{none}</p>
				<button type="button" data-testid="next-deadline-add" onClick={onAddDeadline} className="lh-btn shrink-0">
					<PixelIcon name="plus" />
					Add a deadline
				</button>
			</Pane>
		);
	}
	const words = progressWords(d) ?? "Not measured yet";
	return (
		<Pane data-testid="next-deadline" data-teacher-target={`deadline:${d.id}`} className="@container">
			<div className="flex flex-col gap-5 p-5 @[480px]:flex-row @[480px]:items-end @[480px]:gap-6">
				<div className="flex min-w-0 flex-1 flex-col gap-4 @[480px]:flex-row @[480px]:gap-6">
					<CountBlock size="card" color={color} {...countLeft(dueAtMs(d), nowMs)} className="w-full py-4 @[480px]:w-[150px]" />
					<div className="flex min-w-0 flex-col gap-4">
						<div className="flex flex-col gap-1">
							<Link to={deadlineHref(d.id)} data-testid="next-deadline-open" title={d.name} className="line-clamp-2 text-[28px] leading-tight text-ink hover:underline">
								{d.name}
							</Link>
							<p className="font-count text-lg text-ink-2">{longDay(d.date)}</p>
						</div>
						<div data-testid="next-deadline-progress" className="flex flex-col gap-2">
							{d.problems ? (
								<StepBlocks done={d.problems.done} total={d.problems.total} className="h-[18px] w-6" />
							) : (
								d.topics.length > 0 && (
									<span aria-hidden className="flex flex-wrap gap-[3px]">
										{d.topics.map((t) => (
											<span key={t.id} title={t.name} className="size-[18px]" style={{ background: rampColor(t.rate) }} />
										))}
									</span>
								)
							)}
							<p className="text-[15px] text-ink">{words}</p>
						</div>
					</div>
				</div>
				{hasProblems(d.kind) ? (
					<DeadlineKeys deadline={d} busy={busy} narrow onStudy={() => onStudy(d)} onWork={() => onWork(d)} />
				) : (
					<button type="button" data-testid="next-deadline-start" disabled={busy} onClick={() => onStudy(d)} className="lh-btn lh-btn-main h-[52px] max-w-full self-end px-8 text-[17px]">
						<span className="min-w-0 truncate">{studyLabel(d.continueStudy)}</span>
					</button>
				)}
			</div>
		</Pane>
	);
});
