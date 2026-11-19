import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphCostControl } from "../../src/frontend/components/graph/cost-control.tsx";
import { displayUnpricedRuns } from "../../src/frontend/components/graph/cost-model.ts";
import type { GraphCostSummary } from "../../src/shared/core/cost-summary.ts";

const tokens = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 20_000, reasoningTokens: 0 };
const stage = (planRuns: number, unpricedRuns: number) => ({
	runs: planRuns + unpricedRuns,
	unpricedRuns,
	...(planRuns ? { subscriptionRuns: planRuns, subscriptionProviders: ["Your agent"] } : {}),
	tokens,
});
const summary = (planRuns: number, unpricedRuns: number): GraphCostSummary => ({
	stages: { extraction: stage(planRuns, unpricedRuns), audit: stage(0, 0) },
	runs: [],
});

test("the foot's button says Costs, never a dollar figure", () => {
	assert.equal(displayUnpricedRuns(summary(0, 1)), 1);
	const html = renderToStaticMarkup(<GraphCostControl costs={summary(0, 1)} />);
	assert.match(html, />\s*Costs\s*<\/button>/);
	assert.doesNotMatch(html, /\$/);
});

test("unpriced history is counted beside plan runs", () => {
	assert.equal(displayUnpricedRuns(summary(1, 1)), 1);
});
