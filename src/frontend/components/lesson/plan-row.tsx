import { memo, useState } from "react";
import { classColorVar } from "@/frontend/components/class-color";
import { useClasses } from "@/frontend/components/class-context";
import { cn } from "@/frontend/lib/utils";
import type { HomeworkProblem, LessonKind, PlanStepBar } from "@/shared/core";
import { homeworkRow, practiceRow, stepsRow, type RowBlock, type RowSummary } from "./plan-row-model";
import type { PracticeProgress } from "./practice-progress";
import { ProblemsDialog } from "./problems-dialog";

/**
 * THE PLAN ROW on top of the reading sheet: where the learner is in the
 * lesson. A plan lesson shows "Step 2 of 4" with one block per step and
 * "See the plan"; homework shows "2 of 7 done" with one block per problem
 * and "See the problems"; practice shows its count and blocks alone. A
 * done step's block goes back to that step's first answer.
 */
export const PlanRow = memo(function PlanRow({
	kind,
	classId,
	stepBar,
	homework,
	practice,
	onJump,
	onOpenPlan,
}: {
	kind: LessonKind;
	classId: string | undefined;
	stepBar: PlanStepBar | null;
	homework: { name: string; problems: readonly HomeworkProblem[]; open: string | null } | null;
	practice: PracticeProgress | null;
	onJump: (toolCallId: string) => void;
	onOpenPlan: () => void;
}) {
	const { classes } = useClasses();
	const [problemsOpen, setProblemsOpen] = useState(false);
	const cls = classes.find((c) => c.id === classId);
	const color = cls ? classColorVar(cls.color) : "var(--color-ink)";

	if (homework?.problems.length === 0) {
		return (
			<p data-testid="problems-none" className="text-[15px] text-ink-2">
				The teacher is reading the assignment.
			</p>
		);
	}
	let summary: RowSummary | null;
	let countId = "plan-step-count";
	let action: { label: string; testid: string; onClick: () => void } | null = null;
	if (homework) {
		summary = homeworkRow(homework.problems, homework.open);
		countId = "problems-done";
		action = { label: "See the problems", testid: "problems-open", onClick: () => setProblemsOpen(true) };
	} else if (kind === "practice") {
		summary = practice && practiceRow(practice);
	} else {
		summary = stepBar && stepsRow(stepBar);
		action = { label: "See the plan", testid: "plan-step-open", onClick: onOpenPlan };
	}
	if (!summary) return null;

	return (
		<>
			<div data-testid={kind === "practice" ? "practice-progress" : "plan-row"} className="@container flex min-w-0 shrink-0 items-center gap-3">
				{summary.count && (
					<span data-testid={kind === "practice" ? undefined : countId} className="shrink-0 font-count text-lg text-ink">
						{summary.count}
					</span>
				)}
				<span className="flex min-w-0 gap-1">
					{summary.blocks.map((block) => (
						<Block key={block.key} block={block} color={color} onJump={onJump} />
					))}
				</span>
				{summary.here && <span className="hidden min-w-0 truncate text-[15px] text-ink-2 @[30rem]:block">{summary.here}</span>}
				<span className="flex-1" />
				{action && (
					<button type="button" data-testid={action.testid} onClick={action.onClick} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
						{action.label}
					</button>
				)}
			</div>
			{homework && <ProblemsDialog homework={problemsOpen ? homework : null} onClose={() => setProblemsOpen(false)} />}
		</>
	);
});

/** One block: done in ink, the current one in the class's color, the rest light. */
function Block({ block, color, onJump }: { block: RowBlock; color: string; onJump: (toolCallId: string) => void }) {
	const bar = <span className={cn("block h-2.5 w-full", block.tone === "done" && "bg-ink", block.tone === "later" && "bg-tone-2")} style={block.tone === "current" ? { background: color } : undefined} />;
	const cls = "flex h-5 w-[22px] min-w-[3px] shrink items-center";
	const { jump } = block;
	return jump ? (
		<button type="button" data-testid="plan-block" data-block={block.state} aria-label={block.name} title={block.name} onClick={() => onJump(jump)} className={cls}>
			{bar}
		</button>
	) : (
		<span data-testid="plan-block" data-block={block.state} title={block.name} className={cls}>
			{bar}
		</span>
	);
}
