import { memo } from "react";
import { Link } from "react-router";
import type { DeadlineProgress } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { countLeft, longDay } from "@/frontend/components/home-page/home-page-model";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { ProgressBar } from "@/frontend/components/ui/progress-bar";
import { deadlineHref, nextDeadlineButton, progressShare, progressWords } from "./overview-model";

/**
 * THE NEXT DEADLINE (Progress): the space's soonest open deadline with
 * the time left, how far it is and the one button that works on it. Its
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
				<button type="button" data-testid="next-deadline-add" onClick={onAddDeadline} className="lh-btn h-[38px] shrink-0 text-[15px]">
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
					<p className="font-count text-lg text-ink-2">{longDay(d.date)}</p>
					<Link to={deadlineHref(d.id)} data-testid="next-deadline-open" title={d.name} className="truncate text-[40px] leading-[1.2] text-ink hover:underline">
						{d.name}
					</Link>
					<p data-testid="next-deadline-progress" className="text-[17px] text-ink-2">
						{progressWords(d) ?? "Not measured yet"}.
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
