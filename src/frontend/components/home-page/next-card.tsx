import { Link } from "react-router";
import type { DeadlineProgress, SpaceColor } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { openedFrom } from "@/frontend/components/deadline/deadline-back";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { countLeft, nextCard } from "./home-page-model";
import { CHIP } from "./styles";
import { blockColor } from "./today-row";

/**
 * The next thing to do, first on Today and the only sheet on it: the time
 * left as a big block in its space's color, its space, what to do as the
 * title (which opens the deadline's page), when it is with how far as a
 * chip, what is left of it today, "Mark done" and the page's one main
 * button.
 */
export function NextCard({
	deadline: d,
	progress,
	color,
	nowMs,
	busy,
	onStart,
	onDone,
}: {
	deadline: OpenDeadline;
	progress: DeadlineProgress | undefined;
	color: SpaceColor | undefined;
	nowMs: number;
	/** A lesson is starting. */
	busy: boolean;
	onStart: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
}) {
	const words = nextCard(d, progress, nowMs);
	return (
		<div data-testid="today-card" data-teacher-target={`deadline:${d.id}`}>
			<Pane className="flex min-h-[208px] overflow-hidden">
				<CountBlock size="card" color={blockColor(color)} {...countLeft(dueAtMs(d), nowMs)} />
				<div className="flex min-w-0 flex-1 flex-col justify-between gap-5 px-7 pt-6 pb-6">
					<div className="flex flex-col gap-2">
						<p title={d.spaceName} className="truncate text-base text-ink-2">
							{d.spaceName}
						</p>
						<h2 className="text-[34px] leading-tight break-words text-ink">
							<Link to={deadlineHref(d.id)} state={openedFrom("today")} data-testid="today-card-open" className="hover:underline">
								{words.title}
							</Link>
						</h2>
						<p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[17px] text-ink">
							{words.when}
							{words.ready && (
								<span data-testid="today-card-ready" className={CHIP}>
									{words.ready}
								</span>
							)}
						</p>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
						<p data-testid="today-card-left" className="min-w-0 flex-1 basis-[160px] text-base text-ink-2">
							{words.left}
						</p>
						<span className="flex shrink-0 items-center gap-3">
							<button type="button" data-testid="today-done" onClick={() => onDone(d)} className="lh-btn lh-btn-quiet text-[15px]">
								Mark done
							</button>
							<button type="button" data-testid="today-start" disabled={busy} onClick={() => onStart(d)} className="lh-btn lh-btn-main h-[56px] rounded-[12px] px-7 text-[18px]">
								{words.button}
							</button>
						</span>
					</div>
				</div>
			</Pane>
		</div>
	);
}
