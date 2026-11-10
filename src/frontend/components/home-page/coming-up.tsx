import { memo } from "react";
import Link from "next/link";
import { rampColor, type DeadlineProgress } from "@/shared/core";
import { Countdown } from "@/frontend/components/countdown";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref, percent } from "@/frontend/components/overview/runway-model";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { useHoverBar } from "@/frontend/components/ui/hover-bar";
import { DoneBar } from "@/frontend/components/ui/done-bar";
import { readyBlocks } from "./home-page-model";

/** A bar fills in 400 ms, a block at a time. */
const BLOCK_STEP_MS = 40;

/**
 * COMING UP (Home): the open deadlines after the one due next, soonest
 * first. A row: a 10-block ready bar (deadlines with files), or for
 * homework with problems a done bar and "2/7", the name, the
 * class (when more than one class has deadlines) and the live countdown.
 * A row opens its deadline's page.
 */
export const ComingUp = memo(function ComingUp({
	deadlines,
	progress,
	leaving,
	fixedNow,
}: {
	deadlines: readonly OpenDeadline[];
	/** Each class's deadline progress by deadline id (ready %). */
	progress: ReadonlyMap<string, DeadlineProgress>;
	leaving: ReadonlySet<string>;
	/** A fixed moment for the countdowns (tests). */
	fixedNow?: number;
}) {
	const manyClasses = new Set(deadlines.map((d) => d.classId)).size > 1;
	const hover = useHoverBar<HTMLUListElement>();
	return (
		<Pane name="coming up" data-testid="coming-up" className="px-3 pt-5 pb-3">
			{deadlines.length === 0 ? (
				<p data-testid="coming-up-empty" className="px-2 pb-1 text-sm text-ink-2">
					Nothing else is due.
				</p>
			) : (
				<ul ref={hover.ref} onPointerOver={hover.onPointerOver} onPointerLeave={hover.onPointerLeave} className="relative flex flex-col">
					{hover.bar}
					{deadlines.map((d) => (
						<Row key={d.id} deadline={d} ready={progress.get(d.id)?.ready ?? null} problems={progress.get(d.id)?.problems} showClass={manyClasses} leaving={leaving.has(d.id)} fixedNow={fixedNow} />
					))}
				</ul>
			)}
		</Pane>
	);
});

function Row({
	deadline: d,
	ready,
	problems,
	showClass,
	leaving,
	fixedNow,
}: {
	deadline: OpenDeadline;
	ready: number | null;
	problems: DeadlineProgress["problems"];
	showClass: boolean;
	leaving: boolean;
	fixedNow?: number;
}) {
	return (
		<li data-testid={`coming-up-row-${d.id}`} data-halley-target={`deadline:${d.id}`} className={cn("transition-opacity duration-[var(--lh-dur)]", leaving && "pointer-events-none opacity-0")}>
			<Link href={deadlineHref(d.id)} prefetch={false} data-row="" className="relative flex h-[34px] items-center gap-4 px-2 text-base">
				{problems ? (
					<span className="flex w-[88px] shrink-0 items-center gap-1.5">
						<DoneBar done={problems.done} total={problems.total} className="gap-px" blockClassName="h-2.5 w-1" />
						<span aria-hidden className="text-[12px] text-ink-2 tabular-nums">
							{problems.done}/{problems.total}
						</span>
					</span>
				) : (
					<ReadyBar ready={ready} />
				)}
				<span title={d.name} className="min-w-0 flex-1 truncate text-ink">
					{d.name}
				</span>
				{showClass && (
					<span data-testid="coming-up-class" title={d.className} className="w-[12ch] shrink-0 truncate text-ink-2">
						{d.className.toLowerCase()}
					</span>
				)}
				<Countdown due={d} now={fixedNow} className="w-[11ch] shrink-0 text-ink" clockClassName="w-[11ch] shrink-0" />
			</Link>
		</li>
	);
}

/** Ten blocks, the ready share filled in its ramp color one block at a
 *  time; blank space when the deadline has nothing to be ready on. */
function ReadyBar({ ready }: { ready: number | null }) {
	if (ready === null) return <span aria-hidden className="w-[88px] shrink-0" />;
	const filled = readyBlocks(ready);
	return (
		<span data-testid="coming-up-ready" role="img" aria-label={`${percent(ready)}% ready`} className="flex w-[88px] shrink-0 gap-0.5">
			{Array.from({ length: 10 }, (_, i) => (
				<span
					key={i}
					className={cn("h-2.5 w-[7px]", i < filled && "lh-block-in")}
					style={{ background: i < filled ? rampColor(ready) : "var(--border)", "--lh-block-delay": `${i * BLOCK_STEP_MS}ms` } as React.CSSProperties}
				/>
			))}
		</span>
	);
}
