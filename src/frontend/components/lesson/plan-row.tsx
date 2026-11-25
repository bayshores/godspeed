import { memo, useLayoutEffect, useState } from "react";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useFold } from "@/frontend/components/use-fold";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { cn } from "@/frontend/lib/utils";
import type { FileProblem, LessonKind, LessonStop, PlanStepBar } from "@/shared/core";
import { foldedLine, problemListRow, openingLabel, rowColumns, planArrived, planBranches, planSignature, practiceRow, stepsRow, type RowBlock, type RowStep, type Tone } from "./plan-row-model";
import type { PracticeProgress } from "./practice-progress";

// The map draws with dagre, which loads with the plan blocks, not the lesson.
// Its box (plan-block's MAP_W by MAP_H) is kept from the start, so the steps
// do not narrow when it arrives.
const MAP_BOX = "h-9 w-[140px]";
const PlanMiniMap = lazyComponent(() => import("@/frontend/components/plan-block").then((m) => m.PlanMiniMap));

/** A step cell's width range and the gap between cells, in px. */
const CELL = { min: 150, max: 260 };
const CELL_GAP = 12;

/** A bar's fill by its tone; the current one takes the space's color. */
const TONE: Record<Tone, string> = { done: "bg-ink", current: "", later: "bg-tone-2" };

/** Whether the row is unfolded, kept for every lesson ("1"); folded by default. */
const STEPS_OPEN_KEY = "lh:steps-open";

type Edges = ReadonlyArray<{ from: string; to: string }>;

/**
 * THE PLAN ROW, the step line pinned over the lesson's page: where the learner is in the
 * lesson. A plan lesson or one with a problem list shows one line, "Step 2 of 5", the
 * step's name and a slim bar, which unfolds into every step by name over
 * a bar, with a small map of the plan when it branches; a problem list lists
 * every problem the same way, each full name wrapping in its cell and the
 * lines evenly filled. Practice shows its count and blocks alone. A done
 * step goes back to its first answer. Every problem is a pick: the teacher
 * opens it, done or not, and the open one takes him to his work.
 */
export const PlanRow = memo(function PlanRow({
	kind,
	spaceId,
	stepBar,
	edges,
	stop,
	problemList,
	practice,
	onJump,
	onPick,
	onOpenPlan,
}: {
	kind: LessonKind;
	spaceId: string | undefined;
	stepBar: PlanStepBar | null;
	/** The plan's links, for its map. */
	edges: Edges | null;
	/** The lesson's stop: the row stays on a topic that just ended. */
	stop: LessonStop | null;
	/** `blocked`: why no problem can open yet. */
	problemList: { problems: readonly FileProblem[]; open: string | null; blocked: string | null } | null;
	practice: PracticeProgress | null;
	onJump: (toolCallId: string) => void;
	/** A problem picked (its number), or null for the open one: go to the work. */
	onPick: (number: string | null) => void;
	onOpenPlan: () => void;
}) {
	const { spaces } = useSpaces();
	const space = spaces.find((c) => c.id === spaceId);
	const color = space ? spaceColorVar(space.color) : "var(--color-ink)";
	// No problems yet: the desk shows the assignment once the teacher opens it, or the lesson says why not.
	const steps = problemList ? (problemList.problems.length > 0 ? problemListRow(problemList.problems, problemList.open, problemList.blocked) : null) : kind !== "practice" && stepBar ? stepsRow(stepBar, stop) : null;

	// The row lives as long as the lesson, so it sees a plan arrive or change. It then unfolds
	// without writing the learner's choice; a lesson opened with its plan already there stays as kept.
	const [open, setOpen] = useState(() => readStorage(STEPS_OPEN_KEY) === "1");
	const plan = problemList ? null : planSignature(steps);
	const [planSeen, setPlanSeen] = useState(plan);
	if (plan !== planSeen) {
		setPlanSeen(plan);
		if (planArrived(planSeen, plan)) setOpen(true);
	}
	const toggle = () => {
		setOpen(!open);
		writeStorage(STEPS_OPEN_KEY, open ? null : "1");
	};

	if (problemList || kind !== "practice") {
		return steps && <StepsRow steps={steps} edges={problemList ? null : edges} color={color} onJump={onJump} onPick={problemList ? onPick : null} blocked={problemList?.blocked ?? null} onOpenPlan={onOpenPlan} open={open} onToggle={toggle} />;
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
			<span className={cn("block h-2.5 w-full", TONE[block.tone])} style={block.tone === "current" ? { background: color } : undefined} />
		</span>
	);
}

/** A lesson's steps folded into one line, unfolding into cells on evenly filled lines and the
 *  plan's map when it branches. With `onPick` (a problem list) every cell is a pick, said aloud as it
 *  goes out. */
function StepsRow({
	steps,
	edges,
	color,
	onJump,
	onPick,
	blocked,
	onOpenPlan,
	open,
	onToggle,
}: {
	steps: RowStep[];
	edges: Edges | null;
	color: string;
	onJump: (toolCallId: string) => void;
	onPick: ((number: string | null) => void) | null;
	blocked: string | null;
	onOpenPlan: () => void;
	open: boolean;
	onToggle: () => void;
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
	// Measured once the list is drawn, which a folded row does only when it opens.
	const [list, setList] = useState<HTMLOListElement | null>(null);
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const box = list?.parentElement;
		if (!box) return;
		const measure = () => setWidth(box.clientWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(box);
		return () => ro.disconnect();
	}, [list]);
	const columns = rowColumns(n, width, CELL.min, CELL_GAP);
	const fold = useFold(open);
	const line = foldedLine(steps, onPick !== null);
	return (
		<div className="flex min-w-0 shrink-0 flex-col">
			{/* Folded, the line is its blocks across the page and the count at their end. Unfolded, the row below names the steps. */}
			<button type="button" data-testid="plan-fold" aria-expanded={open} aria-label={open ? undefined : [line.count, line.name].filter(Boolean).join(", ")} onClick={onToggle} className="group flex min-w-0 items-center gap-4 text-left leading-none">
				{!open && (
					<span aria-hidden className="flex min-w-0 flex-1 gap-1">
						{steps.map((s) => (
							<span key={s.key} className={cn("block h-[5px] min-w-0 flex-1", TONE[s.tone])} style={s.tone === "current" ? { background: color } : undefined} />
						))}
					</span>
				)}
				{!open && line.name && <span className="max-w-[45%] min-w-0 truncate text-[15px] text-ink-2 group-hover:text-ink">{line.name}</span>}
				<span className="shrink-0 font-count text-[18px] text-ink-2 group-hover:text-ink">{line.count}</span>
				<PixelIcon name="chevron" className={cn("h-2.5 shrink-0 text-ink-2 transition-transform duration-(--lh-dur) ease-(--lh-ease-out) group-hover:text-ink", open ? "ml-auto -rotate-90" : "rotate-90")} />
			</button>
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
					<div>
						<div data-testid="plan-row" className="flex min-w-0 items-start gap-6 pt-4">
							<ol
								ref={setList}
								aria-label={onPick ? "Problems" : "Plan steps"}
								className="grid min-w-0 flex-1 gap-y-3"
								style={{ columnGap: CELL_GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, maxWidth: columns * CELL.max + (columns - 1) * CELL_GAP }}
							>
								{steps.map((step) => (
									<StepCell key={step.key} step={step} color={color} onJump={onJump} pick={pick} blocked={blocked !== null && step.tone !== "current"} />
								))}
							</ol>
							{mapEdges && (
								<div data-testid="plan-map-box" className={cn("ml-auto flex shrink-0 items-start justify-end", MAP_BOX)}>
									<PlanMiniMap steps={steps} edges={mapEdges} color={color} onOpen={onOpenPlan} />
								</div>
							)}
						</div>
					</div>
				</div>
			)}
			{onPick && (
				<p className="sr-only" aria-live="polite">
					{said}
				</p>
			)}
		</div>
	);
}

/** One step: its number and name over a bar in its tone, a check when done.
 *  A done step that can go back is a button,
 *  and so is every problem; one that can't open yet stays focusable and
 *  says why. */
function StepCell({
	step,
	color,
	onJump,
	pick,
	blocked,
}: {
	step: RowStep;
	color: string;
	onJump: (toolCallId: string) => void;
	pick: ((step: RowStep) => void) | null;
	blocked: boolean;
}) {
	const body = (
		<>
			<span className="flex min-w-0 items-baseline gap-2">
				{step.done && <PixelIcon name="check" className="shrink-0 self-center" />}
				<span className="shrink-0 font-count">{step.number}</span>
				<span className="min-w-0 break-words">{step.name}</span>
			</span>
			<span className={cn("mt-auto block h-1.5 w-full shrink-0", TONE[step.tone])} style={step.tone === "current" ? { background: color } : undefined} />
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
