import { memo, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { hasProblems, longDay, studyLabel, type DeadlineProgress } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import { countLeft } from "@/frontend/components/home-page/home-page-model";
import { DoneBlock } from "@/frontend/components/deadline/deadline-block";
import { DeadlineKeys } from "@/frontend/components/deadline/deadline-keys";
import { useReplayOnChange } from "@/frontend/components/motion";
import { Key } from "@/frontend/components/ui/key";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { DeadlineMarks } from "./deadline-marks";
import { deadlineHref, progressWords } from "./overview-model";
import { MAIN_KEY } from "@/frontend/components/ui/big-key";

/**
 * THE NEXT DEADLINE (Progress, top of the side column): the time left as a
 * band across the card's top, the deadline's name (its page) and day, how
 * far it is drawn as blocks (its topics weakest first, or a homework's
 * problems) with one line of words once something is measured, and its
 * key(s) at the end. "Next", after the day, turns the card to the
 * deadline due after this one, and "Mark done" follows the words that
 * say how far it is. One ticked done here stays
 * with the Done stamp, its name struck through and "Undo", as on Home. In a
 * card wider than a side column (a narrow window stacks the columns) the
 * time left is a tile down the card's left side and the keys sit at the
 * right, as on a Deadlines row. With none: one line and "Add a deadline",
 * or, with no deadline at all, one line over the ways to start.
 */
export const NextDeadline = memo(function NextDeadline({
	deadline: d,
	none,
	color,
	nowMs,
	busyOn,
	onStudy,
	onWork,
	onDone,
	onUndo,
	onNext,
	onAddDeadline,
	starts,
}: {
	/** The soonest open deadline, the one "Next" turned to, or one ticked done here; null with none ahead. */
	deadline: DeadlineProgress | null;
	/** What to say with none ahead. */
	none: string;
	/** The space's color. */
	color: string;
	nowMs: number;
	/** The id of the lesson start in flight, if any. */
	busyOn: string | null;
	onStudy: (d: DeadlineProgress) => void;
	onWork: (d: DeadlineProgress) => void;
	onDone: (d: DeadlineProgress) => void;
	onUndo: (d: DeadlineProgress) => void;
	/** Turns to the deadline after this one; absent with no other ahead. */
	onNext?: () => void;
	onAddDeadline: () => void;
	/** With no deadline at all: the ways to start, under the line. */
	starts?: ReactNode;
}) {
	const swap = useRef<HTMLDivElement>(null);
	// Another deadline, or this one ticked or unticked: the card redraws stepped.
	useReplayOnChange(swap, d && `${d.id} ${d.done}`, "lh-set");
	if (!d && starts) {
		return (
			<Pane data-testid="next-deadline-none" className="lh-card">
				<p className="text-item text-ink-2">{none}</p>
				{starts}
			</Pane>
		);
	}
	if (!d) {
		return (
			<Pane data-testid="next-deadline-none" className="lh-card flex-row flex-wrap items-center justify-end gap-4">
				<p className="min-w-0 flex-1 basis-[160px] text-item text-ink-2">{none}</p>
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
			<div ref={swap} className="flex flex-col @[480px]:flex-row">
				{d.done ? (
					<DoneBlock key={d.id} id={d.id} className="h-24 @[480px]:h-auto @[480px]:w-[116px]" />
				) : (
					<CountBlock size="band" color={color} {...countLeft(dueAtMs(d), nowMs)} className="h-24 w-auto @[480px]:h-auto @[480px]:w-[116px]" />
				)}
				{/* Beside the band the keys end the words' row, and drop under them where the name would be squeezed. */}
				<div className="lh-card min-w-0 flex-1 gap-4 @[480px]:flex-row @[480px]:flex-wrap @[480px]:items-end @[480px]:justify-end @[480px]:gap-x-6">
					<div className="flex min-w-0 flex-1 flex-col gap-4 @[480px]:basis-[260px]">
						<div className="flex flex-col gap-1">
							<Link to={deadlineHref(d.id)} data-testid="next-deadline-open" title={d.name} className={cn("line-clamp-2 text-ask leading-ask text-ink hover:underline", d.done && "line-through")}>
								{d.name}
							</Link>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
								<p className="font-count text-lg text-ink-2">{longDay(d.date)}</p>
								{onNext && (
									<button type="button" data-testid="next-deadline-next" onClick={onNext} className="lh-btn lh-btn-quiet lh-btn-small">
										Next
									</button>
								)}
							</div>
						</div>
						<div className="flex flex-col gap-2">
							{words && <DeadlineMarks deadline={d} />}
							{/* How far it is, then the key that says it is all done. */}
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
								{words && (
									<p data-testid="next-deadline-progress" className="text-ui text-ink">
										{words}
									</p>
								)}
								<button type="button" data-testid={d.done ? "next-deadline-undo" : "next-deadline-done"} onClick={() => (d.done ? onUndo(d) : onDone(d))} className="lh-btn lh-btn-quiet lh-btn-small">
									{d.done ? "Undo" : "Mark done"}
								</button>
							</div>
						</div>
					</div>
					{hasProblems(d.kind) ? (
						<DeadlineKeys deadline={d} busyOn={busyOn} onStudy={() => onStudy(d)} onWork={() => onWork(d)} />
					) : (
						!d.done && (
							<Key data-testid="next-deadline-start" busy={busyOn === d.id} disabled={busyOn !== null} onClick={() => onStudy(d)} className={`${MAIN_KEY} self-end`}>
								<span className="min-w-0 truncate">{studyLabel(d.continueStudy)}</span>
							</Key>
						)
					)}
				</div>
			</div>
		</Pane>
	);
});
