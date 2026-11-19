/** Client-safe accounting folds. Every call runs on a plan (the outside
 * agent bills its own), so nothing has a dollar price: a turn is either a
 * plan turn, named by its plan's label, or unpriced. */

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
	["agent:", "Your agent"],
	["chatgpt:", "ChatGPT"],
	["github-copilot-subscription:", "GitHub Copilot"],
	["xai-subscription:", "Grok"],
];
export function subscriptionLabel(model: string | undefined): string | undefined {
	return PLAN_LABELS.find(([prefix]) => model?.startsWith(prefix))?.[1];
}
export function subscriptionLabels(models: readonly (string | undefined)[]): string[] {
	return [...new Set(models.flatMap((model) => { const label = subscriptionLabel(model); return label ? [label] : []; }))];
}
