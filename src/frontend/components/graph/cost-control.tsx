/**
 * "Graph costs" in the Graph page's bar: a click toggles the popup with
 * the plan that paid, each stage's tokens and the latest runs; an outside
 * click or Escape closes it. The popup is viewport-capped and scrolls.
 */
import { useRef, useState } from "react";
import type { GraphCostSummary } from "@/shared/core";
import { useMinute } from "@/frontend/components/countdown";
import { usePopoverDismiss } from "@/frontend/components/popover-dismiss";
import { usePresence } from "@/frontend/components/presence";
import { displayUnpricedRuns, fmtTokens, planLine, runName, timeAgo } from "./cost-model.ts";

export function GraphCostControl({ costs }: { costs: GraphCostSummary }) {
	const [open, setOpen] = useState(false);
	// The root wraps button and popup, so the toggle itself keeps working.
	const rootRef = useRef<HTMLDivElement>(null);
	usePopoverDismiss(rootRef, open, () => setOpen(false));
	const panel = usePresence(open);
	return (
		<div ref={rootRef} className="relative shrink-0">
			<button type="button" data-testid="graph-costs" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="lh-btn text-[15px]">
				Graph costs
			</button>
			{panel.mounted && (
				<div data-state={panel.state} className="lh-pop absolute right-0 top-full z-20 mt-2 max-h-[60vh] overflow-y-auto">
					<GraphCostPanel costs={costs} />
				</div>
			)}
		</div>
	);
}

function GraphCostPanel({ costs }: { costs: GraphCostSummary }) {
	const nowMs = useMinute();
	const stages: [string, GraphCostSummary["stages"]["extraction"]][] = [
		["Building facts", costs.stages.extraction],
		["Checking facts", costs.stages.audit],
	];
	const unpriced = displayUnpricedRuns(costs);
	return (
		<div data-testid="graph-costs-panel" className="flex w-[440px] max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded border-2 border-line bg-panel px-[18px] py-4">
			<h2 className="text-lg text-ink">Graph costs</h2>
			<p className="text-base text-ink-2">
				{planLine(costs)}
				{unpriced > 0 && ` ${unpriced} ${unpriced === 1 ? "run" : "runs"} unpriced.`}
			</p>
			<span aria-hidden className="h-[1.5px] w-full bg-ink" />
			{stages.map(([label, stage]) => (
				<p key={label} className="flex items-baseline gap-2 py-1">
					<span className="flex-1 text-[15px] text-ink">{label}</span>
					<span className="font-count text-base text-ink-2 tabular-nums">
						{fmtTokens(stage.tokens.inputTokens)} in, {fmtTokens(stage.tokens.outputTokens)} out
					</span>
				</p>
			))}
			{costs.runs.length > 0 && (
				<>
					<span aria-hidden className="border-t-2 border-dotted border-edge" />
					<h3 className="text-[15px] text-ink-2">Latest runs</h3>
					<ul className="flex flex-col">
						{costs.runs.map((run) => (
							<li key={run.startedAt} className="flex items-baseline gap-3 py-1 text-base">
								<span className="w-[34px] shrink-0 font-count text-ink-2">{nowMs !== null ? timeAgo(run.startedAt, nowMs) : ""}</span>
								<span title={run.title} className="min-w-0 flex-1 truncate text-ink">
									{runName(run.title)}
								</span>
								{run.merged && <span className="shrink-0 text-ink-2">{run.merged.nodes} merged</span>}
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}
