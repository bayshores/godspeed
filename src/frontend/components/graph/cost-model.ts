/**
 * The Graph costs popup's words: the plan line, token counts, run ages.
 * Pure and unit-tested; the fold itself is server-side (core/cost-summary.ts).
 */
import type { GraphCostSummary } from "@/shared/core";

/** Compact token display: 45231 → "45.2k"; absent → "–". */
export function fmtTokens(n: number | undefined): string {
	if (n === undefined) return "–";
	if (n < 1000) return String(Math.round(n));
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/** A run's age: "now", "12m", "3h", "2d". */
export function timeAgo(startedAt: number, nowMs: number): string {
	const mins = Math.round((nowMs - startedAt) / 60_000);
	if (mins < 1) return "now";
	if (mins < 60) return `${mins}m`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/** A run's name: a chat's title, or a notes file's name (its title is the file's path). */
export function runName(title: string): string {
	return /^(\/|[A-Za-z]:\\)/.test(title) ? title.split(/[\\/]/).pop()! : title;
}

/** Plan labels for a stage; records written before provider names were
 *  stored were all ChatGPT runs (the only plan at the time). */
function graphProviders(value: { subscriptionRuns?: number; subscriptionProviders?: string[] }): string[] {
	return value.subscriptionProviders ?? ((value.subscriptionRuns ?? 0) > 0 ? ["ChatGPT"] : []);
}

/** "On your ChatGPT plan. Nothing is billed per use."; the outside agent
 *  is "your agent's plan". */
export function planLine(costs: Pick<GraphCostSummary, "stages">): string {
	const labels = [...new Set([costs.stages.extraction, costs.stages.audit].flatMap(graphProviders))];
	const plans = labels.map((l) => (l === "Your agent" ? "your agent's plan" : `your ${l} plan`));
	return plans.length > 0 ? `On ${plans.join(" and ")}. Nothing is billed per use.` : "Nothing is billed per use.";
}

/** The unpriced runs over the stages the UI shows. */
export function displayUnpricedRuns(costs: Pick<GraphCostSummary, "stages">): number {
	return costs.stages.extraction.unpricedRuns + costs.stages.audit.unpricedRuns;
}
