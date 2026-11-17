import { memo, useLayoutEffect, useRef, useState } from "react";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { cn } from "@/frontend/lib/utils";
import type { HomeworkProblem, LessonKind, LessonStop, PlanStepBar } from "@/shared/core";
import { COMPACT_ABOVE, homeworkRow, openingLabel, rowColumns, planBranches, practiceRow, stepsRow, type RowBlock, type RowStep } from "./plan-row-model";
import type { PracticeProgress } from "./practice-progress";

// The map draws with dagre, which loads with the plan blocks, not the lesson.
// Its box (plan-block's MAP_W by MAP_H) is kept from the start, so the steps
// do not narrow when it arrives.
const MAP_BOX = "h-9 w-[140px]";
const PlanMiniMap = lazyComponent(() => import("@/frontend/components/plan-block").then((m) => m.PlanMiniMap));

/** A step cell's width range and the gap between cells, in px; a compact
 *  cell holds only the number over its bar. */
const CELL = { min: 150, max: 260 };
const COMPACT_CELL = { min: 40, max: 64 };
const CELL_GAP = 12;

type Edges = ReadonlyArray<{ from: string; to: string }>;

/**
 * THE PLAN ROW on top of the reading sheet: where the learner is in the
 * lesson. A plan lesson lists every step by name over a bar, with a small
 * map of the plan when it branches; homework lists every problem the same
 * way, each full name wrapping in its cell and the lines evenly filled;
 * practice shows its count and blocks alone. A done step goes back to its
 * first answer. Every problem is a pick: the teacher opens it, done or not,
 * and the open one takes him to his work. A long row shows numbers only,
 * with the names on hover.
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
	onPick,
	onOpenPlan,
	busy,
}: {
	kind: LessonKind;
	spaceId: string | undefined;
	stepBar: PlanStepBar | null;
	/** The plan's links, for its map. */
	edges: Edges | null;
	/** The lesson's stop: the row stays on a topic that just ended. */
	stop: LessonStop | null;
	/** `blocked`: why no problem can open yet. */
	homework: { problems: readonly HomeworkProblem[]; open: string | null; blocked: string | null } | null;
	practice: PracticeProgress | null;
	onJump: (toolCallId: string) => void;
	/** A problem picked (its number), or null for the open one: go to the work. */
	onPick: (number: string | null) => void;
	onOpenPlan: () => void;
	/** The teacher is writing in this lesson. */
	busy: boolean;
}) {
	const { spaces } = useSpaces();
	const space = spaces.find((c) => c.id === spaceId);
	const color = space ? spaceColorVar(space.color) : "var(--color-ink)";

	// No problems yet: the teacher is reading the assignment, or it said in the lesson why not.
	if (homework?.problems.length === 0) {
		return (
			busy && (
			<p data-testid="problems-none" className="text-[15px] text-ink-2">
				The teacher is reading the assignment.
			</p>
			)
		);
	}
	if (homework || kind !== "practice") {
		const steps = homework ? homeworkRow(homework.problems, homework.open, homework.blocked) : stepBar && stepsRow(stepBar, stop);
		return steps && <StepsRow steps={steps} edges={homework ? null : edges} color={color} onJump={onJump} onPick={homework ? onPick : null} blocked={homework?.blocked ?? null} onOpenPlan={onOpenPlan} />;
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

/** A lesson's steps in cells on evenly filled lines, and the plan's map when it branches.
 *  With `onPick` (homework) every cell is a pick, said aloud as it goes out. */
function StepsRow({
	steps,
	edges,
	color,
	onJump,
	onPick,
	blocked,
	onOpenPlan,
}: {
	steps: RowStep[];
	edges: Edges | null;
	color: string;
	onJump: (toolCallId: string) => void;
	onPick: ((number: string | null) => void) | null;
	blocked: string | null;
	onOpenPlan: () => void;
}) {
	const [said, setSaid] = useState("");
	const pick =
		onPick &&
		((step: RowStep) => {
			if (step.tone === "current") return onPick(null);
			if (blocked) return;
			setSaid(openingLabel(step.number));
			onPick(step.number);
		});
	const n = steps.length;
	// A plan that is one chain shows no map: the row already says everything.
	const mapEdges = edges && planBranches(steps.map((s) => s.key), edges) ? edges : null;
	const compact = n > COMPACT_ABOVE;
	const cell = compact ? COMPACT_CELL : CELL;
	const list = useRef<HTMLOListElement>(null);
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const box = list.current?.parentElement;
		if (!box) return;
		const measure = () => setWidth(box.clientWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(box);
		return () => ro.disconnect();
	}, []);
	const columns = rowColumns(n, width, cell.min, CELL_GAP);
	return (
		<div data-testid="plan-row" className="flex min-w-0 shrink-0 items-start gap-6">
			<ol
				ref={list}
				aria-label={onPick ? "Problems" : "Plan steps"}
				className="grid min-w-0 flex-1 gap-y-3"
				style={{ columnGap: CELL_GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxWidth: columns * cell.max + (columns - 1) * CELL_GAP }}
			>
				{steps.map((step) => (
					<StepCell key={step.key} step={step} compact={compact} color={color} onJump={onJump} pick={pick} blocked={blocked !== null && step.tone !== "current"} />
				))}
			</ol>
			{onPick && (
				<p className="sr-only" aria-live="polite">
					{said}
				</p>
			)}
			{mapEdges && (
				<div data-testid="plan-map-box" className={cn("ml-auto flex shrink-0 items-start justify-end", MAP_BOX)}>
					<PlanMiniMap steps={steps} edges={mapEdges} color={color} onOpen={onOpenPlan} />
				</div>
			)}
		</div>
	);
}

/** One step: its number and name over a bar in its tone, a check when done
 *  (compact: the number alone). A done step that can go back is a button,
 *  and so is every problem; one that can't open yet stays focusable and
 *  says why. */
function StepCell({
	step,
	compact,
	color,
	onJump,
	pick,
	blocked,
}: {
	step: RowStep;
	compact: boolean;
	color: string;
	onJump: (toolCallId: string) => void;
	pick: ((step: RowStep) => void) | null;
	blocked: boolean;
}) {
	const body = (
		<>
			<span className="flex min-w-0 items-baseline gap-2">
				{!compact && step.done && <PixelIcon name="check" className="shrink-0 self-center" />}
				<span className="shrink-0 font-count">{step.number}</span>
				{!compact && <span className="min-w-0 break-words">{step.name}</span>}
			</span>
			<span className={cn("mt-auto block h-1.5 w-full shrink-0", step.tone === "done" && "bg-ink", step.tone === "later" && "bg-tone-2")} style={step.tone === "current" ? { background: color } : undefined} />
		</>
	);
	const cls = cn("flex h-full w-full min-w-0 flex-col gap-1.5 text-left text-[15px] leading-snug", step.tone === "current" ? "text-ink" : "text-ink-2");
	const { jump } = step;
	return (
		<li data-testid="plan-step" data-status={step.state} aria-current={step.tone === "current" ? "step" : undefined} title={step.hint} className="flex min-w-0">
			{pick ? (
				<button type="button" data-testid="problem-pick" aria-label={step.label} aria-disabled={blocked || undefined} onClick={() => pick(step)} className={cn(cls, !blocked && "hover:text-ink", blocked && "cursor-default")}>
					{body}
				</button>
			) : jump ? (
				<button type="button" onClick={() => onJump(jump)} className={cn(cls, "hover:text-ink")}>
					{body}
				</button>
			) : (
				<div className={cls}>{body}</div>
			)}
		</li>
	);
}
