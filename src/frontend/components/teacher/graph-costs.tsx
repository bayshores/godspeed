import type { GraphCostSummary } from "@/shared/core";
import { displayUnpricedRuns, fmtTokens, planLine, runName } from "@/frontend/components/graph/cost-model";
import { useNow } from "@/frontend/components/use-now";
import { cn } from "@/frontend/lib/utils";
import { ACTIVITY_ROW, ACTIVITY_ROWS } from "./activity-look";
import { agoLabel } from "./activity-model";

const ROW = cn(ACTIVITY_ROW, "flex w-full items-baseline gap-3 py-2 text-ui");

/**
 * What building a space's graph took, at the end of the teacher's
 * Activity: the plan that paid, each stage's tokens and the latest runs.
 * `space`: its name, null for the lessons with no space.
 */
export function GraphCosts({ costs, space }: { costs: GraphCostSummary; space: string | null }) {
	const now = useNow(true, 60_000);
	const stages: [string, GraphCostSummary["stages"]["extraction"]][] = [
		["Building facts", costs.stages.extraction],
		["Checking facts", costs.stages.audit],
	];
	const unpriced = displayUnpricedRuns(costs);
	return (
		<section data-testid="graph-costs" className="flex flex-col gap-3">
			<h3 className="lh-inner-title truncate">
				Graph costs
				{space && <span className="text-ink-2">, {space}</span>}
			</h3>
			<p className="text-ui text-ink-2">
				{planLine(costs)}
				{unpriced > 0 && ` ${unpriced} ${unpriced === 1 ? "run" : "runs"} unpriced.`}
			</p>
			<div className={ACTIVITY_ROWS}>
				{stages.map(([label, stage]) => (
					<div key={label} className={ROW}>
						<span className="min-w-0 flex-1 truncate text-ink">{label}</span>
						<span className="shrink-0 font-count text-ink-2 tabular-nums">
							{fmtTokens(stage.tokens.inputTokens)} in, {fmtTokens(stage.tokens.outputTokens)} out
						</span>
					</div>
				))}
				{costs.runs.map((run) => (
					<div key={run.startedAt} data-testid="graph-costs-run" className={ROW}>
						<span className="flex min-w-0 flex-1 items-baseline gap-2">
							<span title={run.title} className="truncate text-ink">
								{runName(run.title)}
							</span>
							{run.merged && <span className="shrink-0 text-ink-2">{run.merged.nodes} merged</span>}
						</span>
						<span className="shrink-0 font-count text-ink-2">{agoLabel(new Date(run.startedAt).toISOString(), now)}</span>
					</div>
				))}
			</div>
		</section>
	);
}
