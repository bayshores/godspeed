/** Client-safe accounting folds. Every call runs on a plan (the outside
 * agent bills its own), so nothing has a dollar price: a turn is either a
 * plan turn, named by its plan's label, or unpriced. */
import type { CallUsage, ChatRecord } from "./contracts.ts";

export interface SessionPricing {
	unpriced: number;
	subscription?: number;
	subscriptionProviders?: string[];
}

/** Plan-billed model ids → the plan's label. The outside agent (MCP) runs
 *  on the agent's own plan: no per-token price here. The other prefixes
 *  only appear in records from before the built-in sign-ins were removed
 *  and keep their historical labels. */
const PLAN_LABELS: readonly (readonly [prefix: string, label: string])[] = [
	["agent:", "Outside agent"],
	["chatgpt:", "ChatGPT"],
	["github-copilot-subscription:", "GitHub Copilot"],
	["xai-subscription:", "Grok"],
];
export function subscriptionLabel(model: string | undefined): string | undefined {
	return PLAN_LABELS.find(([prefix]) => model?.startsWith(prefix))?.[1];
}
export function isSubscriptionModel(model: string | undefined): boolean { return subscriptionLabel(model) !== undefined; }
export function subscriptionLabels(models: readonly (string | undefined)[]): string[] {
	return [...new Set(models.flatMap((model) => { const label = subscriptionLabel(model); return label ? [label] : []; }))];
}

/** Absent stays absent. Long-cache precision is unknown if any write-bearing
 * step lacks the split; never silently turn that missing detail into zero. */
export function sumSteps(steps: readonly CallUsage[]): CallUsage {
	const sumIfAny = (vals: (number | undefined)[]): number | undefined =>
		vals.every((v) => v === undefined) ? undefined : vals.reduce<number>((a, v) => a + (v ?? 0), 0);
	return {
		inputTokens: sumIfAny(steps.map((s) => s.inputTokens)),
		outputTokens: sumIfAny(steps.map((s) => s.outputTokens)),
		cacheReadTokens: sumIfAny(steps.map((s) => s.cacheReadTokens)),
		cacheWriteTokens: sumIfAny(steps.map((s) => s.cacheWriteTokens)),
		cacheWrite1hTokens: steps.some((s) => (s.cacheWriteTokens ?? 0) > 0 && s.cacheWrite1hTokens === undefined)
			? undefined : sumIfAny(steps.map((s) => s.cacheWrite1hTokens)),
		reasoningTokens: sumIfAny(steps.map((s) => s.reasoningTokens)),
	};
}

export function sessionCost(record: Pick<ChatRecord, "turns">): SessionPricing {
	const turns = record.turns ?? [];
	const subscription = turns.filter((turn) => isSubscriptionModel(turn.model)).length;
	return {
		unpriced: turns.length - subscription,
		...(subscription ? { subscription, subscriptionProviders: subscriptionLabels(turns.map((turn) => turn.model)) } : {}),
	};
}
