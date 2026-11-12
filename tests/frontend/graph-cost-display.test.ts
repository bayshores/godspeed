/**
 * The Graph costs popup's words (src/frontend/components/graph/cost-model.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayUnpricedRuns, fmtTokens, planLine, runName, timeAgo } from "../../src/frontend/components/graph/cost-model.ts";

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

describe("the popup's words", () => {
	const stage = (subscriptionProviders?: string[]) => ({
		runs: 1,
		unpricedRuns: 0,
		...(subscriptionProviders ? { subscriptionRuns: 1, subscriptionProviders } : {}),
		tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
	});

	it("planLine names the plans that paid; the outside agent is your agent's plan", () => {
		assert.equal(planLine({ stages: { extraction: stage(["ChatGPT"]), audit: stage(["ChatGPT"]) } }), "On your ChatGPT plan. Nothing is billed per use.");
		assert.equal(planLine({ stages: { extraction: stage(["Your agent"]), audit: stage() } }), "On your agent's plan. Nothing is billed per use.");
		assert.equal(planLine({ stages: { extraction: stage(), audit: stage() } }), "Nothing is billed per use.");
	});

	it("fmtTokens is compact; absent is a dash", () => {
		assert.equal(fmtTokens(45_231), "45.2k");
		assert.equal(fmtTokens(950), "950");
		assert.equal(fmtTokens(undefined), "–");
	});

	it("timeAgo counts minutes, hours, days", () => {
		const now = 10 * 86_400_000;
		assert.equal(timeAgo(now - 20_000, now), "now");
		assert.equal(timeAgo(now - 12 * 60_000, now), "12m");
		assert.equal(timeAgo(now - 3 * 3_600_000, now), "3h");
		assert.equal(timeAgo(now - 2 * 86_400_000, now), "2d");
	});

	it("runName keeps a chat's title and shortens a file's path to its name", () => {
		assert.equal(runName("Study: sorting and searching"), "Study: sorting and searching");
		assert.equal(runName("/Users/me/cse/Lecture 14 notes.pdf"), "Lecture 14 notes.pdf");
		assert.equal(runName("C:\\cse\\Lecture 13 notes.pdf"), "Lecture 13 notes.pdf");
	});
});
