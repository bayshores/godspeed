/**
 * The graph-pipeline cost control: the plan that paid (or "–"); click
 * toggles the breakdown panel. Used by the minimal home.
 */
import { useRef, useState } from "react";
import type { GraphCostSummary } from "@/core";
import { planCostLabel } from "@/components/usage-format";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { usePresence } from "@/components/presence";
import { Hint } from "@/components/ui/hint";

/** Compact token display: 45231 → "45.2k"; absent → "–". */
function fmtTokens(n: number | undefined): string {
	if (n === undefined) return "–";
	if (n < 1000) return String(Math.round(n));
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Relative time for run rows: "now", "12m", "3h", "2d". */
function timeAgo(startedAt: number): string {
	const mins = Math.round((Date.now() - startedAt) / 60_000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/** Plan labels for a stage; records written before provider names were
 *  stored were all ChatGPT runs (the only plan at the time). */
function graphProviders(value: { subscriptionRuns?: number; subscriptionProviders?: string[] }): string[] {
	return value.subscriptionProviders ?? ((value.subscriptionRuns ?? 0) > 0 ? ["ChatGPT"] : []);
}
function graphUsageLabel(costs: Pick<GraphCostSummary, "stages">): string {
	return planCostLabel([costs.stages.extraction, costs.stages.audit].flatMap(graphProviders));
}

/** The unpriced runs over the stages the UI shows. */
export function displayUnpricedRuns(costs: Pick<GraphCostSummary, "stages">): number {
	return costs.stages.extraction.unpricedRuns + costs.stages.audit.unpricedRuns;
}

/**
 * The graph's cost label (no pill chrome), hover-highlighted; click
 * toggles the breakdown panel. Same dismiss pattern as the settings gear:
 * outside click or Escape closes. The panel is viewport-capped +
 * scrollable like the coverage dropdown.
 */
export function GraphCostControl({ costs }: { costs: GraphCostSummary }) {
	const [open, setOpen] = useState(false);
	// Click anywhere outside (or Escape) closes the panel — the root
	// wraps button + panel, so the toggle itself keeps working.
	const rootRef = useRef<HTMLDivElement>(null);
	usePopoverDismiss(rootRef, open, () => setOpen(false));
	// The panel pops in and out (motion wave, owner 2026-10-26).
	const panel = usePresence(open);
	return (
		<div ref={rootRef} className="relative">
			<Hint
				label="Graph costs: click for details"
				side="bottom"
			>
				<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={`lh-press px-2 py-1 text-xs font-mono tabular-nums hover:bg-accent ${
					open ? "text-foreground" : "text-muted-foreground hover:text-foreground"
				}`}
			>
				{graphUsageLabel(costs)}
			</button>
			</Hint>
			{panel.mounted && (
				<div data-state={panel.state} className="lh-pop absolute right-0 top-full mt-2 max-h-[60vh] overflow-y-auto">
					<GraphCostPanel costs={costs} />
				</div>
			)}
		</div>
	);
}

/**
 * The cost control's expanded panel: stage totals (extraction / audit —
 * plan label, tokens secondary) + the recent-runs list.
 * Presentational: the fold happens server-side (core/cost-summary.ts).
 */
function GraphCostPanel({ costs }: { costs: GraphCostSummary }) {
	const stageRows: [string, GraphCostSummary["stages"]["extraction"]][] = [
		["Extraction", costs.stages.extraction],
		["Audit", costs.stages.audit],
	];
	const unpricedRuns = displayUnpricedRuns(costs);
	return (
		<div className="lh-glass w-80 max-w-[calc(100vw-1.5rem)] p-3 text-xs">
			<div className="mb-2 flex items-baseline justify-between">
				<span className="text-xs font-semibold text-muted-foreground">
					Graph pipeline costs
				</span>
				<span className="text-foreground font-mono tabular-nums">
					{graphUsageLabel(costs)}
					{unpricedRuns > 0 && (
						<span className="text-muted-foreground"> · {unpricedRuns} unpriced</span>
					)}
				</span>
			</div>
			<div className="flex flex-col gap-1">
				{stageRows.map(([label, stage]) => (
					<div key={label} className="flex items-baseline justify-between gap-2 text-xs">
						<span className="shrink-0 text-muted-foreground">{label}</span>
						<span className="min-w-0 text-right font-mono tabular-nums">
							{planCostLabel(graphProviders(stage))}
							{stage.unpricedRuns > 0 && (stage.subscriptionRuns ?? 0) > 0 && (
								<span className="text-muted-foreground"> +{stage.unpricedRuns} unpriced</span>
							)}
							<span className="text-muted-foreground">
								{" "}
								· {fmtTokens(stage.tokens.inputTokens)} in / {fmtTokens(stage.tokens.outputTokens)} out
							</span>
						</span>
					</div>
				))}
			</div>
			<div className="mt-2 flex flex-col gap-0.5 border-t pt-2">
				{costs.runs.map((run) => (
						<div key={run.startedAt} className="flex items-baseline justify-between gap-2 text-xs">
							<span className="min-w-0 flex-1 truncate text-muted-foreground">
								<span className="text-foreground/70">{timeAgo(run.startedAt)}</span>{" "}
								{run.title}
								{run.merged && (
									<span className="text-muted-foreground">
										{" "}
										+{run.merged.nodes}n
									</span>
								)}
							</span>
							<span className="shrink-0 font-mono tabular-nums">{planCostLabel(graphProviders(run))}{run.subscriptionRuns && run.unpricedRuns ? ` +${run.unpricedRuns} unpriced` : ""}</span>
						</div>
					))}
			</div>
		</div>
	);
}

