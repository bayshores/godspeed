import { MAIN_KEY } from "@/frontend/components/overview/styles";
import { Link } from "react-router";
import type { DeadlineProgress, SpaceColor } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { DoneBlock } from "@/frontend/components/deadline/deadline-block";
import { blockColor } from "@/frontend/components/space-color";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { countLeft, nextCard } from "./home-page-model";
import { CHIP } from "./styles";

/** A narrow card puts the tile above the words as a strip. */
const STRIP = "@max-[539px]:w-full @max-[539px]:flex-row @max-[539px]:items-baseline @max-[539px]:gap-3 @max-[539px]:py-2";

/**
 * Now, the biggest card on Home: the deadline picked in the week (the
 * next thing to do until one is picked). Its tile, flush with the card's
 * left edge as on a space's Deadlines list, holds the time left (or how
 * late it is) in its space's color. Beside it its name as the title (which
 * opens its page) with one line under it, and at the row's end, on the
 * title's center line, "Mark done" and the page's one main key. One ticked
 * done today shows the Done stamp and its name struck through, with Undo
 * and no main key.
 */
export function NextCard({
	deadline: d,
	progress,
	color,
	nowMs,
	busy,
	onStart,
	onDone,
	onUndo,
}: {
	deadline: OpenDeadline;
	progress: DeadlineProgress | undefined;
	color: SpaceColor | undefined;
	nowMs: number;
	/** A lesson is starting. */
	busy: boolean;
	onStart: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
	onUndo: (d: OpenDeadline) => void;
}) {
	const words = nextCard(d, progress, nowMs);
	return (
		<Pane data-testid="today-card" data-teacher-target={`deadline:${d.id}`} className="@container overflow-hidden">
			<div className="flex min-h-[104px] flex-col @min-[540px]:flex-row @min-[540px]:items-center">
				{d.done ? (
					<DoneBlock className={cn("w-[112px] self-stretch py-2", STRIP)} />
				) : (
					<CountBlock size="card" color={blockColor(color)} {...countLeft(dueAtMs(d), nowMs)} className={STRIP} />
				)}
				{/* The title's ink sits low in its line box, so the words sit 4px high to center on the keys. */}
				<div className="flex min-w-0 flex-1 flex-col gap-1 px-(--lh-inset) pt-3 pb-5">
					<h2 className={cn("text-[28px] leading-tight break-words text-ink", d.done && "line-through")}>
						<Link to={deadlineHref(d.id)} data-testid="today-card-open" className="hover:underline">
							{words.title}
						</Link>
					</h2>
					<p data-testid="today-card-line" className="text-[17px] leading-snug text-ink-2">
						{words.line}
						{words.ready && (
							<span data-testid="today-card-ready" className={cn(CHIP, "ml-3 align-[1px]")}>
								{words.ready}
							</span>
						)}
					</p>
				</div>
				{words.button ? (
					<span className="flex shrink-0 items-center gap-3 px-(--lh-inset) pb-5 @min-[540px]:py-4 @min-[540px]:pl-0">
						<button type="button" data-testid="today-done" onClick={() => onDone(d)} className="lh-btn lh-btn-quiet">
							Mark done
						</button>
						<button type="button" data-testid="today-start" disabled={busy} onClick={() => onStart(d)} className={MAIN_KEY}>
							{words.button}
						</button>
					</span>
				) : (
					<span className="flex shrink-0 px-6 pb-5 @min-[540px]:py-4 @min-[540px]:pl-0">
						<button type="button" data-testid="today-undo" onClick={() => onUndo(d)} className="lh-btn lh-btn-quiet">
							Undo
						</button>
					</span>
				)}
			</div>
		</Pane>
	);
}
