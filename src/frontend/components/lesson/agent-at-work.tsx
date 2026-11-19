import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useReplayOnChange } from "@/frontend/components/motion";
import { cn } from "@/frontend/lib/utils";
import type { AgentWork } from "./agent-at-work-model";
import type { Arrive } from "./arrivals";
import { PageStage } from "./page-stage";
import { planLines, type DeskState, type PlanLine } from "./wait-model";

/**
 * THE DESK: where the reply will appear, while the teacher works on it. It shows only what the
 * teacher is doing in this reply: its plan, and once it opens a file, that file's pages beside
 * the plan, filling the sheet down to its foot. `foot` rests under it: Stop and the lines typed
 * to the teacher that wait for it. It says nothing the top bar's pill says.
 */
export function AgentAtWork({
	state,
	work,
	arrive,
	foot,
}: {
	state: DeskState;
	work: AgentWork;
	arrive: Arrive;
	foot: ReactNode;
}) {
	// Each desk's own arrival slots, so the next turn's desk steps in again.
	const slot = useId();
	const ref = useRef<HTMLDivElement>(null);
	const reading = work.reading;
	useReplayOnChange(ref, reading !== null, "lh-block-in");
	return (
		<div ref={ref} data-testid="agent-at-work" data-state={state} className={cn("lh-desk @container/desk flex flex-col gap-6", reading && "flex-1")}>
			<div className={cn("flex gap-7 @max-[560px]/desk:flex-col", reading && "min-h-[420px] flex-1 @max-[560px]/desk:min-h-0")}>
				<WorkList work={work} slot={slot} arrive={arrive} />
				{reading && (
					<div className="flex min-w-0 flex-1 flex-col @max-[560px]/desk:h-[220px] @max-[560px]/desk:flex-none @max-[360px]/desk:hidden">
						<PageStage key={reading.path} reading={reading} className={cn(arrive(`${slot}:file:${reading.path}`) && "lh-block-in")} />
					</div>
				)}
			</div>
			{foot}
		</div>
	);
}

/** The plan, each item stepping in after the one above it. The current item lies on a tile with
 *  the newest step under it; with no plan, the newest step alone is that tile. Only the current
 *  item spins. */
function WorkList({ work, slot, arrive }: { work: AgentWork; slot: string; arrive: Arrive }) {
	const lines = work.plan ? planLines(work.plan) : [];
	const n = work.steps.length;
	const step = n > 0 && (
		<span key={n} className={cn("line-clamp-3 font-count text-[14px] leading-5 break-words text-ink-2", arrive(`${slot}:step:${n}`) && "lh-block-in")} style={{ "--lh-block-delay": "60ms" } as CSSProperties}>
			{work.steps[n - 1]}
		</span>
	);
	const hasNow = lines.some((line) => line.state === "now");
	return (
		<ol data-testid="desk-plan" className="flex w-[300px] shrink-0 flex-col gap-1 @max-[560px]/desk:w-full">
			{lines.map((line, i) => (
				<li key={line.key} className={cn(ROW, line.state === "now" && NOW, arrive(`${slot}:plan:${line.key}`) && "lh-block-in")} style={{ "--lh-block-delay": `${i * 40}ms` } as CSSProperties}>
					<Mark state={line.state} />
					<div className="flex min-w-0 flex-col gap-1.5">
						<LineText line={line} />
						{line.state === "now" && step}
					</div>
				</li>
			))}
			{!hasNow && step && (
				<li className={cn(ROW, NOW)}>
					<Mark state="now" />
					<div className="min-w-0">{step}</div>
				</li>
			)}
		</ol>
	);
}

/** Every row is padded like the tile, so the plan's words stay in one column. */
const ROW = "flex gap-3 px-3 py-2.5";
/** The current item: a tile in the well's shade, the paper's own ground. */
const NOW = "lh-desk-well lh-sheet";

function Mark({ state }: { state: PlanLine["state"] }) {
	return (
		<span className="flex h-5 w-5 shrink-0 items-center justify-center">
			{(state === "done" || state === "folded") && <PixelIcon name="check" className="text-ink-2" />}
			{state === "now" && <BrailleSpinner className="h-5" label="Working" />}
			{state === "next" && <span className="size-2 bg-tone-2" />}
		</span>
	);
}

function LineText({ line }: { line: PlanLine }) {
	if (line.state === "folded") return <span className="font-count text-[15px] leading-5 text-ink-2">{line.count} done</span>;
	return <span className={cn("line-clamp-2 text-[15px] leading-5 break-words", line.state === "now" ? "text-ink" : "text-ink-2")}>{line.text}</span>;
}
