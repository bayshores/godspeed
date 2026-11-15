import { memo } from "react";
import { Link } from "react-router";
import { longDay, type DeadlineProgress } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { countLeft } from "@/frontend/components/home-page/home-page-model";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { deadlineHref, nextDeadlineButton, progressShare, progressWords } from "./overview-model";
import { openedFrom } from "@/frontend/components/deadline/deadline-back";

/**
 * THE NEXT DEADLINE (Progress): the space's soonest open deadline with
 * the time left, its day and how far it is (a chip) under its name, and the
 * one button that works on it. Its
 * name opens its page. With none: one line and "Add a deadline".
 */
export const NextDeadline = memo(function NextDeadline({
	deadline: d,
	none,
	color,
	nowMs,
	busy,
	onStart,
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
	onStart: (d: DeadlineProgress) => void;
	onAddDeadline: () => void;
}) {
	if (!d) {
		return (
			<Pane data-testid="next-deadline-none" className="flex flex-wrap items-center gap-4 px-5 py-4">
				<p className="min-w-0 flex-1 text-[17px] text-ink-2">{none}</p>
				<button type="button" data-testid="next-deadline-add" onClick={onAddDeadline} className="lh-btn shrink-0">
					<PixelIcon name="plus" />
					Add a deadline
				</button>
			</Pane>
		);
	}
	const share = progressShare(d);
	return (
		<Pane data-testid="next-deadline" data-teacher-target={`deadline:${d.id}`} className="flex flex-col gap-[18px] p-5">
			<div className="flex gap-7">
				<CountBlock size="square" color={color} {...countLeft(dueAtMs(d), nowMs)} />
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<Link to={deadlineHref(d.id)} state={openedFrom("progress")} data-testid="next-deadline-open" title={d.name} className="truncate text-[40px] leading-[1.2] text-ink hover:underline">
						{d.name}
					</Link>
					<p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
						<span className="font-count text-lg text-ink-2">{longDay(d.date)}</span>
						<span data-testid="next-deadline-progress" className="bg-highlight px-2 py-0.5 text-[15px] leading-snug text-ink">
							{progressWords(d) ?? "Not measured yet"}
						</span>
					</p>
					{share !== null && <ProgressBar share={share} className="w-full max-w-[480px]" />}
				</div>
			</div>
			<button type="button" data-testid="next-deadline-start" disabled={busy} onClick={() => onStart(d)} className="lh-btn lh-btn-main h-[53px] w-full justify-center gap-2.5 px-[22px] text-[17px]">
				<span className="min-w-0 truncate">{nextDeadlineButton(d)}</span>
			</button>
		</Pane>
	);
});
