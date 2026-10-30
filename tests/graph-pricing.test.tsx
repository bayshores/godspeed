import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GraphCostControl, displayUnpricedRuns } from "../src/components/graph/cost-control.tsx";
import { graphCostSummary } from "../src/core/cost-summary.ts";
import type { CallUsage, ExtractionRunUsage } from "../src/core/contracts.ts";

const usage = (over: Partial<CallUsage> = {}): CallUsage => ({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 20_000, reasoningTokens: 0, ...over });
const run = (steps: CallUsage[], model = "anthropic:claude-haiku-4-5", at = 1): ExtractionRunUsage => ({ startedAt: at, at: "fixture", durationMs: 1, stages: { extractor: { model, steps } } });
const summary = (runs: ExtractionRunUsage[]) => graphCostSummary({ chats: [{ title: "fixture", extractions: runs }], sources: [] });
const headline = (runs: ExtractionRunUsage[]) => renderToStaticMarkup(<GraphCostControl costs={summary(runs)} />);

test("wholly unpriced historical graph costs render unknown, never a dollar figure", () => {
	const historical = run([usage()]);
	assert.equal(displayUnpricedRuns(summary([historical])), 1);
	const html = headline([historical]);
	assert.match(html, />–<\/button>/);
	assert.doesNotMatch(html, /\$/);
});

test("plan runs read the plan's label, with or without unpriced history", () => {
	const plan = run([usage()], "agent:outside-agent");
	const historical = run([usage()], undefined, 2);
	assert.match(headline([plan]), />Outside agent<\/button>/);
	assert.match(headline([plan, historical]), />Outside agent<\/button>/);
	assert.equal(displayUnpricedRuns(summary([plan, historical])), 1);
});

test("graph stage and recent-run aggregates preserve known one-hour cache writes", () => {
	const costs = summary([run([usage({ cacheWrite1hTokens: 20_000 })]), run([usage({ cacheWrite1hTokens: 5000 })], undefined, 2)]);
	assert.equal(costs.stages.extraction.tokens.cacheWrite1hTokens, 25_000);
	assert.deepEqual(costs.runs.map((r) => r.tokens.cacheWrite1hTokens), [5000, 20_000]);
});

test("unknown historical long-cache splits stay unknown regardless of merge order", () => {
	const known = run([usage({ cacheWrite1hTokens: 20_000 })]);
	const historical = run([usage()], undefined, 2);
	for (const runs of [[known, historical], [historical, known]]) {
		const costs = summary(runs);
		assert.equal(costs.stages.extraction.tokens.cacheWrite1hTokens, undefined);
	}
	const mixedWithinRun = summary([run([usage({ cacheWrite1hTokens: 20_000 }), usage()])]);
	assert.equal(mixedWithinRun.stages.extraction.tokens.cacheWrite1hTokens, undefined);
	const absentNoWrites = run([usage({ cacheWriteTokens: 0 })], undefined, 2);
	assert.equal(summary([absentNoWrites, known]).stages.extraction.tokens.cacheWrite1hTokens, 20_000, "absence without writes must not poison known write detail");
});
