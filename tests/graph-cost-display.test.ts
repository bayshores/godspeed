/**
 * The graph cost control's display fold (src/components/graph/cost-control.tsx).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayUnpricedRuns } from "../src/components/graph/cost-control.tsx";

describe("displayUnpricedRuns (naming-free fold)", () => {
	const stage = (unpricedRuns: number) => ({
		runs: unpricedRuns,
		unpricedRuns,
		tokens: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
		},
	});
	const costs = {
		stages: {
			extraction: stage(1),
			audit: stage(0),
			naming: stage(2), // dead channel — must never reach the display
		},
	} as const;

	it("sums the live stages only", () => {
		assert.equal(displayUnpricedRuns(costs), 1);
	});
});
