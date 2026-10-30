/**
 * Graph-pipeline cost summary: the pure fold behind the graph view's cost
 * pill. Two usage channels in: chat extraction runs
 * (ChatRecord.extractions) and notes-source runs (NotesSource.extractions).
 * Out: per-stage totals (extraction / audit) + a capped recent-runs list.
 *
 * Nothing has a dollar price (every call runs on a plan): a stage-run is a
 * plan run, named by its plan's label, or counted in `unpricedRuns` (old
 * records from before the plans). A stage that never reached the model
 * cost nothing and is not counted. Tokens always sum.
 *
 * Client-safe: pure types + math, no node imports; exposed via the core
 * barrel so the pill/panel components carry no cost math.
 */

import type { CallUsage, EmissionStats, ExtractionRunUsage, ExtractionStageUsage } from "./contracts.ts";
import { sumSteps, isSubscriptionModel, subscriptionLabels } from "./prices.ts";

/** One pipeline stage's cumulative cost across every run. */
export interface StageCost {
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

/** One run in the recent-runs list (extraction or naming). */
export interface RecentRun {
	subscriptionRuns?: number;
	subscriptionProviders?: string[];
	/** Stages on a model with no plan; absent when none. */
	unpricedRuns?: number;
	startedAt: number;
	/** ISO wall-clock. */
	at: string;
	durationMs: number;
	/** "extraction" covers both front doors (chat + notes). */
	kind: "extraction";
	/** Chat title / source file path / fixed label for naming runs. */
	title: string;
	tokens: CallUsage;
	/** What the run merged into the graph; absent on failed runs. */
	merged?: EmissionStats;
}

/** The cost pill's whole payload: stage totals + recent runs. */
export interface GraphCostSummary {
	/** The billable pipeline stages. */
	stages: {
		extraction: StageCost;
		audit: StageCost;
	};
	/** Newest first, capped at `recentCap` (default 10). */
	runs: RecentRun[];
}

/** What the fold reads: already-collected run records, front-door-tagged. */
export interface CostSummaryInput {
	/** Chat-front-door runs: chat title + the record's usage log. */
	chats: { title: string; extractions: ExtractionRunUsage[] }[];
	/** Notes-front-door runs: imported file path + the source's usage log. */
	sources: { filePath: string; extractions: ExtractionRunUsage[] }[];
	recentCap?: number;
}

const ZERO_TOKENS: CallUsage = {
	inputTokens: undefined,
	outputTokens: undefined,
	cacheReadTokens: undefined,
	cacheWriteTokens: undefined,
	reasoningTokens: undefined,
};

const emptyStage = (): StageCost => ({ unpricedRuns: 0, runs: 0, tokens: { ...ZERO_TOKENS } });

/** A stage with no steps never reached the model (an abort while queued): it cost nothing. */
const reachedModel = (stage: ExtractionStageUsage | undefined): stage is ExtractionStageUsage => !!stage && stage.steps.length > 0;

/** Merge one step-set's tokens into an accumulating CallUsage. */
function mergeTokens(into: CallUsage, steps: readonly CallUsage[]): void {
	const summed = sumSteps(steps);
	// Fold this before updating total writes, so an older write-bearing
	// aggregate with a missing split remains unknown even after fresh data.
	into.cacheWrite1hTokens = sumSteps([into, summed]).cacheWrite1hTokens;
	into.inputTokens = (into.inputTokens ?? 0) + (summed.inputTokens ?? 0);
	into.outputTokens = (into.outputTokens ?? 0) + (summed.outputTokens ?? 0);
	into.cacheReadTokens = (into.cacheReadTokens ?? 0) + (summed.cacheReadTokens ?? 0);
	into.cacheWriteTokens = (into.cacheWriteTokens ?? 0) + (summed.cacheWriteTokens ?? 0);
	into.reasoningTokens = (into.reasoningTokens ?? 0) + (summed.reasoningTokens ?? 0);
}

/** Fold every usage channel into the pill's payload. Pure: same input,
 *  same output — no clock, no fs, no store reads. */
export function graphCostSummary(input: CostSummaryInput): GraphCostSummary {
	const extraction = emptyStage();
	const audit = emptyStage();
	const runs: RecentRun[] = [];

	const foldStage = (into: StageCost, stage: ExtractionStageUsage) => {
		into.runs++;
		mergeTokens(into.tokens, stage.steps);
		if (isSubscriptionModel(stage.model)) {
			into.subscriptionRuns = (into.subscriptionRuns ?? 0) + 1;
			into.subscriptionProviders = [...new Set([...(into.subscriptionProviders ?? []), ...subscriptionLabels([stage.model])])];
		} else into.unpricedRuns++;
	};

	const foldExtractionRun = (run: ExtractionRunUsage, title: string) => {
		const extractor = run.stages?.extractor;
		// Records from before the linking stage was folded in carry an auditor stage.
		const auditor = run.stages?.auditor;
		if (reachedModel(extractor)) foldStage(extraction, extractor);
		if (reachedModel(auditor)) foldStage(audit, auditor);
		const stages = [extractor, auditor].filter(reachedModel);
		if (stages.length === 0) return;
		const subscriptionRuns = stages.filter((stage) => isSubscriptionModel(stage.model)).length;
		const unpricedRuns = stages.length - subscriptionRuns;
		const allSteps = stages.flatMap((stage) => stage.steps);
		runs.push({
			...(subscriptionRuns ? { subscriptionRuns, subscriptionProviders: subscriptionLabels(stages.map((stage) => stage.model)) } : {}),
			...(unpricedRuns ? { unpricedRuns } : {}),
			startedAt: run.startedAt,
			at: run.at,
			durationMs: run.durationMs,
			kind: "extraction",
			title,
			tokens: sumSteps(allSteps),
			...(run.stats ? { merged: run.stats } : {}),
		});
	};

	for (const chat of input.chats) {
		for (const run of chat.extractions) foldExtractionRun(run, chat.title);
	}
	for (const source of input.sources) {
		for (const run of source.extractions) foldExtractionRun(run, source.filePath);
	}

	runs.sort((a, b) => b.startedAt - a.startedAt);
	return {
		stages: { extraction, audit },
		runs: runs.slice(0, input.recentCap ?? 10),
	};
}
