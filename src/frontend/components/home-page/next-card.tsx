import { Link } from "react-router";
import type { DeadlineProgress, SpaceColor } from "@/shared/core";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { Pane } from "@/frontend/components/ui/pane";
import { nextCard } from "./home-page-model";
import { blockColor } from "./today-row";

/**
 * The next thing to do, first on Today: its space, what to do as the
 * title (which opens the deadline's page), when it is and how far, what is
 * left of it today, "Mark done" and the page's one main button.
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
			<Pane className="flex flex-col gap-5 overflow-hidden px-7 pt-6 pb-6">
				<span aria-hidden className="absolute inset-y-0 left-0 w-2" style={{ background: blockColor(color) }} />
				<div className="flex flex-col gap-2">
					<p title={d.spaceName} className="truncate text-[17px] text-ink-2">
						{d.spaceName}
					</p>
					<h2 className="text-[34px] leading-tight break-words text-ink">
						<Link to={deadlineHref(d.id)} data-testid="today-card-open" className="hover:underline">
							{words.title}
						</Link>
					</h2>
					<p className="text-lg text-ink">{words.when}</p>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
					<p data-testid="today-card-left" className="min-w-0 flex-1 basis-[220px] text-lg text-ink-2">
						{words.left}
					</p>
					<span className="flex shrink-0 items-center gap-2">
						<button type="button" data-testid="today-done" onClick={() => onDone(d)} className="lh-btn lh-btn-quiet h-[38px] text-[15px]">
							Mark done
						</button>
						<button type="button" data-testid="today-start" disabled={busy} onClick={() => onStart(d)} className="lh-btn lh-btn-main h-[53px] px-[22px] text-[17px]">
							{words.button}
						</button>
					</span>
				</div>
			</Pane>
		</div>
	);
}
