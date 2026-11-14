import { memo } from "react";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { cn } from "@/frontend/lib/utils";
import type { HomeworkProblem, LessonKind, LessonStop, PlanStepBar } from "@/shared/core";
import { COMPACT_ABOVE, homeworkRow, planBranches, practiceRow, stepsRow, type RowBlock, type RowStep } from "./plan-row-model";
import type { PracticeProgress } from "./practice-progress";

// The map draws with dagre, which loads with the plan blocks, not the lesson.
// Its box (plan-block's MAP_W by MAP_H) is kept from the start, so the steps
// do not narrow when it arrives.
const MAP_BOX = "h-9 w-[140px]";
const PlanMiniMap = lazyComponent(() => import("@/frontend/components/plan-block").then((m) => m.PlanMiniMap));

/** A step cell's width range and the gap between cells, in px; a compact
 *  cell holds only the number over its bar. */
const CELL = { min: 132, max: 260 };
const COMPACT_CELL = { min: 40, max: 64 };
const CELL_GAP = 12;

type Edges = ReadonlyArray<{ from: string; to: string }>;

/**
 * THE PLAN ROW on top of the reading sheet: where the learner is in the
 * lesson. A plan lesson lists every step by name over a bar, with a small
 * map of the plan when it branches; homework lists every problem the same
 * way; practice shows its count and blocks alone. A done step goes back to
 * its first answer, a done problem to its card. A long row shows numbers
 * only, with the names on hover.
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
	/** `cards`: each problem's first card by number. */
	homework: { problems: readonly HomeworkProblem[]; open: string | null; cards: Readonly<Record<string, string>> } | null;
	practice: PracticeProgress | null;
	onJump: (toolCallId: string) => void;
	onOpenPlan: () => void;
}) {
	const { spaces } = useSpaces();
	const space = spaces.find((c) => c.id === spaceId);
	const color = space ? spaceColorVar(space.color) : "var(--color-ink)";

	if (homework?.problems.length === 0) {
		return (
			<p data-testid="problems-none" className="text-[15px] text-ink-2">
				The teacher is reading the assignment.
			</p>
		);
	}
	if (homework || kind !== "practice") {
		const steps = homework ? homeworkRow(homework.problems, homework.open, homework.cards) : stepBar && stepsRow(stepBar, stop);
		return steps && <StepsRow steps={steps} edges={homework ? null : edges} color={color} onJump={onJump} onOpenPlan={onOpenPlan} />;
	}
	const summary = practice && practiceRow(practice);
	if (!summary) return null;

	return (
		<div data-testid="practice-progress" className="flex min-w-0 shrink-0 items-center gap-3">
			{summary.count && <span className="shrink-0 font-count text-lg text-ink">{summary.count}</span>}
			<span className="flex min-w-0 gap-1">
				{summary.blocks.map((block) => (
					<Block key={block.key} block={block} color={color} />
				))}
			</span>
		</div>
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

/** A lesson's steps in cells that wrap onto more lines, and the plan's map when it branches. */
function StepsRow({ steps, edges, color, onJump, onOpenPlan }: { steps: RowStep[]; edges: Edges | null; color: string; onJump: (toolCallId: string) => void; onOpenPlan: () => void }) {
	const n = steps.length;
	// A plan that is one chain shows no map: the row already says everything.
	const mapEdges = edges && planBranches(steps.map((s) => s.key), edges) ? edges : null;
	const compact = n > COMPACT_ABOVE;
	const cell = compact ? COMPACT_CELL : CELL;
	return (
		<div data-testid="plan-row" className="flex min-w-0 shrink-0 items-start gap-6">
			<ol
				aria-label="Plan steps"
				className="grid min-w-0 flex-1 gap-y-2"
				style={{ columnGap: CELL_GAP, gridTemplateColumns: `repeat(auto-fit, minmax(${cell.min}px, 1fr))`, maxWidth: n * cell.max + (n - 1) * CELL_GAP }}
			>
				{steps.map((step) => (
					<StepCell key={step.key} step={step} compact={compact} color={color} onJump={onJump} />
				))}
			</ol>
			{mapEdges && (
				<div data-testid="plan-map-box" className={cn("ml-auto flex shrink-0 items-start justify-end", MAP_BOX)}>
					<PlanMiniMap steps={steps} edges={mapEdges} color={color} onOpen={onOpenPlan} />
				</div>
			)}
		</div>
	);
}

/** One step: its mark, number and name over a bar in its tone (compact:
 *  the number alone). A done step that can go back is a button. */
function StepCell({ step, compact, color, onJump }: { step: RowStep; compact: boolean; color: string; onJump: (toolCallId: string) => void }) {
	const body = (
		<>
			<span className="flex min-w-0 items-center gap-2">
				{!compact && step.tone !== "later" && <PixelIcon name={step.tone === "done" ? "check" : "chevron"} />}
				<span className="shrink-0 font-count">{step.number}</span>
				{!compact && <span className="min-w-0 truncate">{step.name}</span>}
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
