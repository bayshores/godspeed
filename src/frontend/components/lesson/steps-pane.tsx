import { memo, useEffect } from "react";
import { useHoverBar } from "@/frontend/components/ui/hover-bar";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { stepPosition, type PlanStep, type PlanStepBar, type StepAnswer } from "@/shared/core";

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

const MARK: Record<PlanStep["status"], string> = { visited: "✓", current: "▸", upcoming: " " };

/**
 * THE STEPS PANE, atop the lesson's right column: the plan's steps in
 * order, done ones ticked with how many answers were right, the current
 * one marked and bold, the rest dim. A done step goes back to its first
 * answer; "plan map" opens the whole plan.
 */
export const StepsPane = memo(function StepsPane({ bar, onJump, onOpenPlan }: { bar: PlanStepBar; onJump: (toolCallId: string) => void; onOpenPlan: () => void }) {
	const { steps, currentIndex } = bar;
	const hover = useHoverBar<HTMLOListElement>();
	const listRef = hover.ref;
	// A long plan scrolls; the current step stays in view.
	useEffect(() => {
		listRef.current?.querySelector('[data-status="current"]')?.scrollIntoView({ block: "nearest" });
	}, [currentIndex]);
	const name = (
		<>
			steps{" "}
			<span data-testid="plan-step-count" className="text-ink-3 tabular-nums">
				{stepPosition(steps)} of {steps.length}
			</span>
		</>
	);
	return (
		<Pane name={name} data-testid="steps-pane" className="[&>h2]:px-2 [&>h2]:pt-0 shrink-0 px-3 pt-3 pb-3">
			<button
				type="button"
				data-testid="plan-step-open"
				onClick={onOpenPlan}
				className="absolute -top-[9px] right-3 bg-background px-1.5 text-xs leading-4 text-ink-2 hover:text-ink"
			>
				plan map
			</button>
			<ol ref={listRef} onPointerOver={hover.onPointerOver} onPointerLeave={hover.onPointerLeave} aria-label="Plan steps" className="relative flex max-h-[168px] flex-col overflow-y-auto">
				{hover.bar}
				{steps.map((step) => (
					<Step key={step.id} step={step} onJump={onJump} />
				))}
			</ol>
		</Pane>
	);
});

function Step({ step, onJump }: { step: PlanStep; onJump: (toolCallId: string) => void }) {
	const target = jumpTarget(step);
	const right = rightCountLabel(step.answers);
	const row = (
		<>
			<span aria-hidden className={cn("w-[1ch] shrink-0", step.status === "visited" ? "text-ans-right" : "text-tint")}>
				{MARK[step.status]}
			</span>
			<span
				title={step.title}
				className={cn(
					"min-w-0 flex-1 truncate",
					step.status === "visited" && "text-ink-2",
					step.status === "current" && "font-bold text-ink",
					step.status === "upcoming" && "text-ink-3",
				)}
			>
				{step.title}
			</span>
			{right && <span className="shrink-0 text-xs text-ink-3 tabular-nums">{right}</span>}
		</>
	);
	const cls = "flex h-6 w-full items-center gap-[1ch] px-2 text-left text-base";
	return (
		<li data-testid="plan-step" data-status={step.status}>
			{target ? (
				<button type="button" data-row="" onClick={() => onJump(target)} className={cn(cls, "relative")}>
					{row}
				</button>
			) : (
				<div className={cls}>{row}</div>
			)}
		</li>
	);
}
