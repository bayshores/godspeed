/**
 * Tests for src/core/cost-summary.ts — the graph cost pill's pure fold:
 * plan runs carry their plan's label, other models are counted as
 * unpriced (render "–", never a silent zero), tokens always sum.
 */

import assert from "node:assert/strict";
import { describe, it as test } from "node:test";
import { graphCostSummary, type CostSummaryInput, type GraphCostSummary } from "../src/core/cost-summary.ts";
import type { CallUsage, ExtractionRunUsage } from "../src/core/contracts.ts";

const PLAN = "agent:outside-agent";

const step = (input: number, output: number): CallUsage => ({
	inputTokens: input,
	outputTokens: output,
	cacheReadTokens: 0,
	cacheWriteTokens: undefined,
	reasoningTokens: 0,
});

/** A run record. With `auditorModel` it is an old record from before the
 *  linking stage was folded into the extractor. */
const extractionRun = (
	startedAt: number,
	extractorModel: string,
	auditorModel?: string,
	stats?: ExtractionRunUsage["stats"],
): ExtractionRunUsage => ({
	startedAt,
	at: new Date(startedAt).toISOString(),
	durationMs: 10_000,
	stages: {
		extractor: { model: extractorModel, steps: [step(1000, 200)] },
		...(auditorModel ? { auditor: { model: auditorModel, steps: [step(2000, 100)] } } : {}),
	},
	...(stats ? { stats } : {}),
});

describe("graphCostSummary (the cost pill's fold)", () => {
	test("folds both channels: stage totals, tokens, newest-first runs", () => {
		const s = graphCostSummary({
			chats: [{ title: "Testing session", extractions: [extractionRun(100, PLAN)] }],
			sources: [{ filePath: "/vault/modal.md", extractions: [extractionRun(200, PLAN)] }],
		});
		assert.equal(s.stages.extraction.subscriptionRuns, 2);
		assert.deepEqual(s.stages.extraction.subscriptionProviders, ["Outside agent"]);
		assert.equal(s.stages.extraction.runs, 2);
		assert.equal(s.stages.extraction.tokens.inputTokens, 2000);
		assert.equal(s.stages.audit.runs, 0, "current records carry the extractor stage only");
		assert.deepEqual(s.runs.map((r) => r.title), ["/vault/modal.md", "Testing session"]);
	});

	test("old records with an auditor stage still fold it", () => {
		const input: CostSummaryInput = {
			chats: [{ title: "Testing session", extractions: [extractionRun(100, PLAN, PLAN)] }],
			sources: [{ filePath: "/vault/modal.md", extractions: [extractionRun(200, PLAN, PLAN)] }],
		};
		const s = graphCostSummary(input);
		assert.equal(s.stages.audit.runs, 2);
		assert.equal(s.stages.extraction.runs, 2);
		assert.equal(s.stages.extraction.tokens.inputTokens, 2000);
		assert.equal(s.stages.audit.tokens.outputTokens, 200);
		// Both runs, newest first, titles joined per front door.
		assert.deepEqual(
			s.runs.map((r) => r.title),
			["/vault/modal.md", "Testing session"],
		);
	});

	test("unpriced models (old records) are counted per stage and per run", () => {
		const s: GraphCostSummary = graphCostSummary({
			chats: [{ title: "partial", extractions: [extractionRun(100, PLAN, "unknown-model")] }],
			sources: [{ filePath: "/vault/x.md", extractions: [extractionRun(200, "unknown-model", "unknown-model")] }],
		});
		assert.equal(s.stages.audit.unpricedRuns, 2);
		assert.equal(s.stages.extraction.unpricedRuns, 1);
		// Newest first: 200 (both unpriced), 100 (a plan stage + one unpriced).
		assert.deepEqual(s.runs.map((r) => [r.subscriptionRuns, r.unpricedRuns]), [[undefined, 2], [1, 1]]);
	});

	test("a plan-only run has no unpriced stage", () => {
		const s = graphCostSummary({ chats: [{ title: "plan", extractions: [extractionRun(100, PLAN)] }], sources: [] });
		assert.equal(s.runs[0]!.unpricedRuns, undefined);
	});

	test("a run that never reached the model is not counted", () => {
		const aborted: ExtractionRunUsage = { startedAt: 300, at: "x", durationMs: 1, stages: { extractor: { model: "unknown", steps: [] } } };
		const s = graphCostSummary({ chats: [{ title: "chat", extractions: [extractionRun(100, PLAN), aborted] }], sources: [] });
		assert.equal(s.stages.extraction.unpricedRuns, 0);
		assert.equal(s.stages.extraction.runs, 1);
		assert.deepEqual(s.runs.map((r) => r.startedAt), [100]);
	});

	test("recent runs cap at 10: newest survive", () => {
		const extractions = Array.from({ length: 12 }, (_, i) => extractionRun((i + 1) * 100, PLAN));
		const s = graphCostSummary({ chats: [{ title: "chat", extractions }], sources: [] });
		assert.equal(s.runs.length, 10);
		assert.deepEqual(s.runs.map((r) => r.startedAt), [1200, 1100, 1000, 900, 800, 700, 600, 500, 400, 300]);
		// stage totals still count EVERY run, cap is presentational.
		assert.equal(s.stages.extraction.runs, 12);
	});

	test("failed runs carry no merged stats; empty input folds to zero", () => {
		const s = graphCostSummary({
			chats: [{ title: "failed", extractions: [extractionRun(100, PLAN)] }],
			sources: [],
		});
		assert.equal(s.runs[0]!.merged, undefined);
		const empty = graphCostSummary({ chats: [], sources: [] });
		assert.equal(empty.stages.extraction.runs, 0);
		assert.equal(empty.runs.length, 0);
		assert.equal(empty.stages.extraction.tokens.inputTokens, undefined);
	});
});
