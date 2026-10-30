import { memo } from "react";
import { ChevronDownIcon, GitForkIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PlanStep, PlanStepBar, StepAnswer } from "@/core";

const STATUS_WORD: Record<PlanStep["status"], string> = {
	visited: "Done",
	current: "Current",
	upcoming: "Upcoming",
};

/** One answer as a small block: right / wrong / didn't know; explain
 *  answers (the teacher grades them in words) sit in the neutral tone. */
export function answerBlockClass(a: StepAnswer): string {
	if (a.outcome === "right") return "bg-ans-right";
	if (a.outcome === "wrong") return "bg-ans-wrong";
	if (a.outcome === "dontKnow") return "bg-ans-dontknow";
	return "bg-tone-2";
}

/** "2 of 2 right" over the graded answers (explain answers are not graded). */
export function rightCountLabel(answers: readonly StepAnswer[]): string | null {
	const graded = answers.filter((a) => a.outcome !== "ungraded");
	if (graded.length === 0) return null;
	return `${graded.filter((a) => a.outcome === "right").length} of ${graded.length} right`;
}

/** The step a done-step click jumps to: its first answered question. */
export function jumpTarget(step: PlanStep): string | null {
	if (step.status !== "visited") return null;
	return step.answers.find((a) => a.toolCallId)?.toolCallId ?? null;
}

/**
 * THE PLAN STEP BAR: one small block per plan
 * step — gray when done, white and wide for the current step, dark when
 * upcoming — then "11 / 14", the step name and a chevron that opens the
 * full plan map. Hovering (or focusing) a step shows its answers; clicking
 * a done step scrolls back to it.
 */
export const StepBar = memo(function StepBar({
	bar,
	onJump,
	onOpenPlan,
}: {
	bar: PlanStepBar;
	onJump: (toolCallId: string) => void;
	onOpenPlan: () => void;
}) {
	const { steps, currentIndex } = bar;
	const current = currentIndex >= 0 ? steps[currentIndex] : undefined;
	const position = currentIndex >= 0 ? currentIndex + 1 : steps.filter((s) => s.status === "visited").length;
	return (
		<div data-testid="plan-step-bar" className="flex min-w-0 items-center gap-3 bg-panel px-3 py-[3px]">
			<GitForkIcon aria-hidden className="size-3.5 shrink-0 text-ink-3" />
			<TooltipProvider>
				<div className="flex shrink-0 items-center gap-[3px]" role="list" aria-label="Plan steps">
					{steps.map((step, i) => (
						<StepBlock key={step.id} step={step} number={i + 1} onJump={onJump} />
					))}
				</div>
			</TooltipProvider>
			<button
				type="button"
				data-testid="plan-step-open"
				onClick={onOpenPlan}
				aria-label="Open the plan map"
				className="lh-press flex min-w-0 items-center gap-1.5 py-1 text-left"
			>
				<span data-testid="plan-step-count" className="shrink-0 font-mono text-[12.5px] text-ink-3 tabular-nums">
					{position} / {steps.length}
				</span>
				<span className="min-w-0 truncate text-[13.5px] font-bold text-ink">{current?.title ?? "Plan"}</span>
				<ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-ink-2" />
			</button>
		</div>
	);
});

function StepBlock({ step, number, onJump }: { step: PlanStep; number: number; onJump: (toolCallId: string) => void }) {
	const target = jumpTarget(step);
	const right = rightCountLabel(step.answers);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					role="listitem"
					data-testid="plan-step"
					data-status={step.status}
					aria-label={`Step ${number}: ${step.title} (${STATUS_WORD[step.status]})`}
					onClick={target ? () => onJump(target) : undefined}
					className={cn("group flex h-6 items-center outline-none", target ? "cursor-pointer" : "cursor-default")}
				>
					<span
						aria-hidden
						className={cn(
							"block transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
							step.status === "current" ? "h-2.5 w-[22px] bg-ink" : "h-1.5 w-2.5",
							step.status === "visited" && "bg-ink-2 group-hover:bg-ink group-focus-visible:bg-ink",
							step.status === "upcoming" && "bg-tone-2 group-hover:bg-ink-3 group-focus-visible:bg-ink-3",
						)}
					/>
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom" align="start" className="w-56">
				<>
					<div className="flex items-center gap-2 text-ink-3">
						<span className="font-mono">Step {number}</span>
						<span>{STATUS_WORD[step.status]}</span>
					</div>
					<div className="text-sm font-bold text-ink">{step.title}</div>
					{right && (
						<div className="flex items-center gap-2">
							<span className="flex gap-0.5" aria-hidden>
								{step.answers.map((a, i) => (
									<span key={i} className={cn("block h-3 w-2", answerBlockClass(a))} />
								))}
							</span>
							<span className="font-mono text-ink-2">{right}</span>
						</div>
					)}
				</>
			</TooltipContent>
		</Tooltip>
	);
}
