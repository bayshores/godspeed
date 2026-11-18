import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { useReplayOnChange } from "@/frontend/components/motion";
import { cn } from "@/frontend/lib/utils";
import type { AgentWork } from "./agent-at-work-model";
import type { Arrive } from "./arrivals";
import { PageStage, PaperStack } from "./page-stage";
import { planLines, type DeskState, type PlanLine } from "./wait-model";

/**
 * THE DESK: where the reply will appear, while the teacher works on it. It shows paper, the
 * learner's own files, from the moment the turn starts; once the teacher has a plan or takes a
 * step it splits in place into the plan on the left and the paper on the right, the file the
 * teacher opened on top. It says nothing the top bar's pill says. `foot` is Stop and the lines
 * typed to the teacher that wait for it.
 */
export function AgentAtWork({
	state,
	work,
	split,
	paper,
	arrive,
	foot,
}: {
	state: DeskState;
	work: AgentWork | null;
	split: boolean;
	paper: { path: string | null; edges: number };
	arrive: Arrive;
	foot: ReactNode;
}) {
	// Each desk's own arrival slots, so the next turn's desk steps in again.
	const slot = useId();
	const ref = useRef<HTMLDivElement>(null);
	useReplayOnChange(ref, split, "lh-block-in");
	const reading = split ? (work?.reading ?? null) : null;
	return (
		<div ref={ref} data-testid="agent-at-work" data-state={state} className="lh-desk @container/desk flex flex-col gap-4">
			<div className={cn("flex h-[340px] gap-7 @max-[360px]/desk:h-auto", split && "@max-[560px]/desk:h-auto @max-[560px]/desk:flex-col")}>
				{split && work && <WorkList work={work} slot={slot} arrive={arrive} />}
				<div className={cn("flex min-w-0 flex-1 flex-col @max-[360px]/desk:hidden", split && "@max-[560px]/desk:h-[220px] @max-[560px]/desk:flex-none")}>
					{reading ? (
						<PageStage key={reading.path} reading={reading} className={cn(arrive(`${slot}:file:${reading.path}`) && "lh-block-in")} />
					) : (
						<PaperStack path={paper.path} edges={paper.edges} still={state === "waiting"} slot={slot} arrive={arrive} />
					)}
				</div>
			</div>
			{foot}
		</div>
	);
}

/** The plan, each item stepping in after the one above it, with the newest step under the
 *  current item; with no plan, the newest step alone. Only the current item spins. */
function WorkList({ work, slot, arrive }: { work: AgentWork; slot: string; arrive: Arrive }) {
	const lines = work.plan ? planLines(work.plan) : [];
	const n = work.steps.length;
	const step = n > 0 && (
		<span key={n} className={cn("line-clamp-2 font-count text-[15px] leading-5 break-words text-ink-2", arrive(`${slot}:step:${n}`) && "lh-block-in")} style={{ "--lh-block-delay": "60ms" } as CSSProperties}>
			{work.steps[n - 1]}
		</span>
	);
	const hasNow = lines.some((line) => line.state === "now");
	return (
		<ol data-testid="desk-plan" className="flex w-[260px] shrink-0 flex-col gap-3 @max-[560px]/desk:w-full">
			{lines.map((line, i) => (
				<li key={line.key} className={cn("flex gap-2.5", arrive(`${slot}:plan:${line.key}`) && "lh-block-in")} style={{ "--lh-block-delay": `${i * 40}ms` } as CSSProperties}>
					<Mark state={line.state} />
					<div className="flex min-w-0 flex-col gap-2">
						<LineText line={line} />
						{line.state === "now" && step}
					</div>
				</li>
			))}
			{!hasNow && step && (
				<li className="flex gap-2.5">
					<Mark state="now" />
					<div className="min-w-0">{step}</div>
				</li>
			)}
		</ol>
	);
}

function Mark({ state }: { state: PlanLine["state"] }) {
	return (
		<span className="flex h-5 w-4 shrink-0 items-center justify-center">
			{(state === "done" || state === "folded") && <PixelIcon name="check" className="text-ink-2" />}
			{state === "now" && <BrailleSpinner label="Working" />}
			{state === "next" && <span className="size-1.5 bg-tone-2" />}
		</span>
	);
}

function LineText({ line }: { line: PlanLine }) {
	if (line.state === "folded") return <span className="font-count text-[15px] leading-5 text-ink-2">{line.count} done</span>;
	return <span className={cn("line-clamp-2 text-[15px] leading-5 break-words", line.state === "now" ? "text-ink" : "text-ink-2")}>{line.text}</span>;
}
