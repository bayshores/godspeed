/**
 * The graph view's cost pill payload, as the Rust server folds it from
 * chat extraction runs and notes-source runs: per-stage totals
 * (extraction / audit) and a capped recent-runs list.
 *
 * Nothing has a dollar price (every call runs on a plan): a stage-run is a
 * plan run, named by its plan's label, or counted in `unpricedRuns` (old
 * records from before the plans). Tokens always sum.
 */

import type { CallUsage, EmissionStats } from "./contracts.ts";

/** One pipeline stage's cumulative cost across every run. */
interface StageCost {
	/** Subscription stage-runs, excluded from unpriced counts. */
	subscriptionRuns?: number;
	subscriptionProviders?: string[];
	/** Stage-runs on a model with no plan (render "–", never zero). */
	unpricedRuns: number;
	/** Runs that billed this stage. */
	runs: number;
	/** Token totals across every run. */
	tokens: CallUsage;
}

/** One run in the recent-runs list. */
interface RecentRun {
	subscriptionRuns?: number;
	subscriptionProviders?: string[];
	/** Stages on a model with no plan; absent when none. */
	unpricedRuns?: number;
	startedAt: number;
	/** Chat title or source file path. */
	title: string;
	tokens: CallUsage;
	/** What the run merged into the graph; absent on failed runs. */
	merged?: EmissionStats;
}

/** The whole payload of Graph costs: stage totals + recent runs. */
export interface GraphCostSummary {
	/** The billable pipeline stages. */
	stages: {
		extraction: StageCost;
		audit: StageCost;
	};
	/** Newest first, at most 10. */
	runs: RecentRun[];
}
