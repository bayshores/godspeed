/**
 * The graph-pipeline cost control (moved out of the retired fact canvas,
 * graph-view.tsx, in the redesign's Phase 5): a bare cumulative-dollars
 * number; click toggles the breakdown panel. Used by the minimal home.
 */
import { useRef, useState } from "react";
import type { GraphCostSummary } from "@/src/core";
import { planCostLabel } from "@/components/usage-format";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { usePresence } from "@/components/presence";
import { Hint } from "@/components/ui/hint";

/** Compact token display: 45231 → "45.2k"; absent → "—". */
function fmtTokens(n: number | undefined): string {
	if (n === undefined) return "—";
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

/** Run/stage cost at 3 decimals (pipeline pennies are real money at this
 *  scale); headline totals use 2. Null (unpriced model) renders "—". */
function fmtRunCost(dollars: number | null, providers: readonly string[] = []): string {
	return planCostLabel(dollars, providers, (value) => `$${value.toFixed(3)}`);
}
function graphProviders(value: { subscriptionRuns?: number; subscriptionProviders?: string[] }): string[] {
	return value.subscriptionProviders ?? ((value.subscriptionRuns ?? 0) > 0 ? ["ChatGPT"] : []);
}
function graphUsageLabel(costs: Pick<GraphCostSummary, "stages">): string {
	const stages = [costs.stages.extraction, costs.stages.audit];
	const providers = [...new Set(stages.flatMap(graphProviders))];
	const priced = stages.some((stage) => stage.runs - stage.unpricedRuns - (stage.subscriptionRuns ?? 0) > 0);
	const dollars = displayCostTotals(costs).totalDollars;
	return planCostLabel(priced ? dollars : null, providers, (value) => `$${value.toFixed(2)}`);
}

/**
 * The cost figures the UI DISPLAYS (owner refinement round, 2026-09-24):
 * extraction + audit only. Cluster naming is dead — labels are session
 * titles / file names — so the core's naming fold (and its historical
 * spend) is deliberately not shown anywhere: the pill and the panel must
 * agree, and both read THIS, never GraphCostSummary.totalDollars.
 * (The core fold's naming stage was then culled outright — 2026-09-24 —
 * so the recent-runs list carries extraction runs only.)
 */
export function displayCostTotals(costs: Pick<GraphCostSummary, "stages">): {
	totalDollars: number;
	unpricedRuns: number;
} {
	// The two live stages (the spine came and went on one day,
	// 2026-09-30 — digest-aware extraction replaced it).
	return {
		totalDollars: costs.stages.extraction.dollars + costs.stages.audit.dollars,
		unpricedRuns: costs.stages.extraction.unpricedRuns + costs.stages.audit.unpricedRuns,
	};
}

/**
 * The graph-pipeline cost control (2026-09-20 placement wave): a bare
 * cumulative-dollars number — no pill chrome (owner: "just a number"),
 * hover-highlighted, click toggles the breakdown panel. Same dismiss
 * pattern as the settings gear: outside click or Escape closes. The
 * panel is viewport-capped + scrollable like the coverage dropdown.
 */
/** The graph's cumulative-dollars pill + breakdown panel (used by the
 *  home screen, components/home.tsx). */
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
				// Trimmed (owner, subtlety round 2026-09-25).
				label="Graph costs — click for details"
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
 * dollars headline, tokens secondary) + the recent-runs list.
 * Presentational: the fold happens server-side (core/cost-summary.ts);
 * dollars are inferred read-time, never stored. Cluster naming is GONE
 * from the panel (owner refinement round, 2026-09-24): labels are session
 * titles / file names now, the namer is dead, and its historical spend is
 * not tracked anymore — the headline sums the displayed stages only and
 * naming-kind runs never reach the list.
 */
function GraphCostPanel({ costs }: { costs: GraphCostSummary }) {
	const stageRows: [string, GraphCostSummary["stages"]["extraction"]][] = [
		["Extraction", costs.stages.extraction],
		["Audit", costs.stages.audit],
	];
	// The displayed figures come from displayCostTotals (naming excluded —
	// the pill and this panel must agree).
	const { unpricedRuns } = displayCostTotals(costs);
	return (
		<div className="w-80 max-w-[calc(100vw-1.5rem)] border bg-card/95 p-3 text-xs shadow-lg backdrop-blur">
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
							{fmtRunCost(stage.runs - stage.unpricedRuns - (stage.subscriptionRuns ?? 0) <= 0 ? null : stage.dollars, graphProviders(stage))}
							{stage.unpricedRuns > 0 && (stage.runs - stage.unpricedRuns - (stage.subscriptionRuns ?? 0) > 0 || (stage.subscriptionRuns ?? 0) > 0) && (
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
							<span className="shrink-0 font-mono tabular-nums">{fmtRunCost(run.dollars, graphProviders(run))}{run.dollars === null && run.subscriptionRuns === 1 ? " +1 unpriced" : ""}</span>
						</div>
					))}
			</div>
		</div>
	);
}

