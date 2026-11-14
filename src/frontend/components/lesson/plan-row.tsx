import { memo, useState } from "react";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { cn } from "@/frontend/lib/utils";
import type { HomeworkProblem, LessonKind, LessonStop, PlanStepBar } from "@/shared/core";
import { homeworkRow, planBranches, practiceRow, stepsRow, type RowBlock, type RowStep, type RowSummary } from "./plan-row-model";
import type { PracticeProgress } from "./practice-progress";
import { ProblemsDialog } from "./problems-dialog";

// The map draws with dagre, which loads with the plan blocks, not the lesson.
const PlanMiniMap = lazyComponent(() => import("@/frontend/components/plan-block").then((m) => m.PlanMiniMap));

/** A step cell's width range and the gap between cells, in px. */
const CELL_MIN = 132;
const CELL_MAX = 260;
const CELL_GAP = 12;

type Edges = ReadonlyArray<{ from: string; to: string }>;

/**
 * THE PLAN ROW on top of the reading sheet: where the learner is in the
 * lesson. A plan lesson lists every step by name over a bar, with a small
 * map of the plan when it branches; homework shows "2 of 7 done" with one
 * block per problem and "See the problems"; practice shows its count and
 * blocks alone. A done step goes back to that step's first answer.
 */
export const PlanRow = memo(function PlanRow({
	kind,
	spaceId,
	stepBar,
	edges,
	stop,
	homework,
	practice,
	onJump,
	onOpenPlan,
}: {
	kind: LessonKind;
	spaceId: string | undefined;
	stepBar: PlanStepBar | null;
	/** The plan's links, for its map. */
	edges: Edges | null;
	/** The lesson's stop: the row stays on a topic that just ended. */
	stop: LessonStop | null;
	homework: { name: string; problems: readonly HomeworkProblem[]; open: string | null } | null;
	practice: PracticeProgress | null;
	onJump: (toolCallId: string) => void;
	onOpenPlan: () => void;
}) {
	const { spaces } = useSpaces();
	const [problemsOpen, setProblemsOpen] = useState(false);
	const space = spaces.find((c) => c.id === spaceId);
	const color = space ? spaceColorVar(space.color) : "var(--color-ink)";

	if (homework?.problems.length === 0) {
		return (
			<p data-testid="problems-none" className="text-[15px] text-ink-2">
				The teacher is reading the assignment.
			</p>
		);
	}
	if (!homework && kind !== "practice") {
		const steps = stepBar && stepsRow(stepBar, stop);
		return steps && <StepsRow steps={steps} edges={edges} color={color} onJump={onJump} onOpenPlan={onOpenPlan} />;
	}
	const summary: RowSummary | null = homework ? homeworkRow(homework.problems, homework.open) : practice && practiceRow(practice);
	if (!summary) return null;

	return (
		<>
			<div data-testid={homework ? "plan-row" : "practice-progress"} className="@container flex min-w-0 shrink-0 items-center gap-3">
				{summary.count && (
					<span data-testid={homework ? "problems-done" : undefined} className="shrink-0 font-count text-lg text-ink">
						{summary.count}
					</span>
				)}
				<span className="flex min-w-0 gap-1">
					{summary.blocks.map((block) => (
						<Block key={block.key} block={block} color={color} />
					))}
				</span>
				{summary.here && <span className="hidden min-w-0 truncate text-[15px] text-ink-2 @[30rem]:block">{summary.here}</span>}
				<span className="flex-1" />
				{homework && (
					<button type="button" data-testid="problems-open" onClick={() => setProblemsOpen(true)} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
						See the problems
					</button>
				)}
			</div>
			{homework && <ProblemsDialog homework={problemsOpen ? homework : null} onClose={() => setProblemsOpen(false)} />}
		</>
	);
});

/** One block: done in ink, the current one in the space's color, the rest light. */
function Block({ block, color }: { block: RowBlock; color: string }) {
	return (
		<span data-testid="plan-block" data-block={block.state} title={block.name} className="flex h-5 w-[22px] min-w-[3px] shrink items-center">
			<span className={cn("block h-2.5 w-full", block.tone === "done" && "bg-ink", block.tone === "later" && "bg-tone-2")} style={block.tone === "current" ? { background: color } : undefined} />
		</span>
	);
}

/** A plan lesson's steps in cells that wrap onto more lines, and the plan's map when it branches. */
function StepsRow({ steps, edges, color, onJump, onOpenPlan }: { steps: RowStep[]; edges: Edges | null; color: string; onJump: (toolCallId: string) => void; onOpenPlan: () => void }) {
	const n = steps.length;
	// A plan that is one chain shows no map: the row already says everything.
	const mapEdges = edges && planBranches(steps.map((s) => s.key), edges) ? edges : null;
	return (
		<div data-testid="plan-row" className="flex min-w-0 shrink-0 items-start gap-6">
			<ol
				aria-label="Plan steps"
				className="grid min-w-0 flex-1 gap-y-2"
				style={{ columnGap: CELL_GAP, gridTemplateColumns: `repeat(auto-fit, minmax(${CELL_MIN}px, 1fr))`, maxWidth: n * CELL_MAX + (n - 1) * CELL_GAP }}
			>
				{steps.map((step, i) => (
					<StepCell key={step.key} step={step} number={i + 1} color={color} onJump={onJump} />
				))}
			</ol>
			{mapEdges && (
				<div className="ml-auto shrink-0">
					<PlanMiniMap steps={steps} edges={mapEdges} color={color} onOpen={onOpenPlan} />
				</div>
			)}
		</div>
	);
}

/** One step: its mark, number and name over a bar in its tone. A done
 *  step with an answer is a button back to its first answer. */
function StepCell({ step, number, color, onJump }: { step: RowStep; number: number; color: string; onJump: (toolCallId: string) => void }) {
	const body = (
		<>
			<span className="flex min-w-0 items-center gap-2">
				{step.tone !== "later" && <PixelIcon name={step.tone === "done" ? "check" : "chevron"} />}
				<span className="shrink-0 font-count">{number}</span>
				<span className="min-w-0 truncate">{step.name}</span>
			</span>
			<span className={cn("mt-1.5 block h-1.5 w-full", step.tone === "done" && "bg-ink", step.tone === "later" && "bg-tone-2")} style={step.tone === "current" ? { background: color } : undefined} />
		</>
	);
	const cls = cn("flex w-full min-w-0 flex-col text-left text-[15px]", step.tone === "current" ? "text-ink" : "text-ink-2");
	const { jump } = step;
	return (
		<li data-testid="plan-step" data-status={step.state} aria-current={step.tone === "current" ? "step" : undefined} title={step.hint} className="min-w-0">
			{jump ? (
				<button type="button" onClick={() => onJump(jump)} className={cn(cls, "hover:text-ink")}>
					{body}
				</button>
			) : (
				<div className={cls}>{body}</div>
			)}
		</li>
	);
}
