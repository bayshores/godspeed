import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StatsBar, formatContextMeasurement } from "../src/components/stats-bar.tsx";
import { sessionCost } from "../src/core/prices.ts";
import { prettyModel } from "../src/components/usage-format.ts";
import type { TurnUsage } from "../src/core/contracts.ts";

// The stats bar: folds only (no cost math in the component), the "–"
// doctrine for absent data, and the outside agent's context budget as the
// meter's denominator. There is no model control (the outside agent picks
// its own model).

function step(inputTokens: number, outputTokens: number, over: Record<string, number | undefined> = {}) {
	return { inputTokens, outputTokens, cacheReadTokens: undefined, cacheWriteTokens: undefined, reasoningTokens: undefined, ...over };
}

function turn(over: Partial<TurnUsage> = {}): TurnUsage {
	return {
		id: "t1",
		messageId: "m1",
		at: "2026-09-09T12:00:00Z",
		model: "agent:outside-agent",
		steps: [step(10_000, 1_000)],
		...over,
	};
}

describe("stats bar", () => {
	it("renders NOTHING on the left when there are no turns yet, and no model control", () => {
		const html = renderToStaticMarkup(<StatsBar turns={[]} />);
		assert.match(html, /data-testid="stats-bar"/);
		assert.ok(!html.includes('data-testid="stats-summary"'), "no summary button pre-chat");
		assert.ok(!html.includes('data-testid="stats-context"'), "no context figure pre-chat");
		assert.ok(!html.includes('data-testid="stats-cost"'), "no cost figure pre-chat");
		assert.ok(!html.includes('data-testid="stats-model"'), "no model control");
		assert.ok(!html.includes('data-testid="stats-thinking"'), "no thinking control");
	});

	it("outside-agent turns: context over the agent budget, cost reads the plan label", () => {
		const html = renderToStaticMarkup(
			<StatsBar turns={[turn(), turn()]} contextTokens={11_000} pricing={sessionCost({ turns: [turn(), turn()] })} />,
		);
		assert.match(html, /data-testid="stats-context">11k \/ 200k</);
		assert.match(html, /data-testid="stats-cost">Outside agent</);
	});

	it("shows – for cost when every turn is unpriceable, never a fake $0", () => {
		const html = renderToStaticMarkup(
			<StatsBar turns={[turn({ model: "nope/unknown" })]} contextTokens={11_000} pricing={sessionCost({ turns: [turn({ model: "nope/unknown" })] })} />,
		);
		assert.match(html, /data-testid="stats-cost">–</);
	});

	it("unknown context is explicit", () => {
		assert.equal(formatContextMeasurement(null, 100_000), "? / 100k");
		assert.equal(formatContextMeasurement(83_000, 100_000), "83k / 100k");
		assert.equal(formatContextMeasurement(83_000, null), "83k");
		const html = renderToStaticMarkup(<StatsBar chatId="fixture" turns={[turn()]} contextTokens={null} />);
		assert.match(html, /data-testid="stats-context">\? \/ 200k</);
	});
});

describe("prettyModel", () => {
	it("prettyModel strips vendor + date suffix, keeps dashes", () => {
		assert.equal(prettyModel("z-ai/glm-5.3-flash"), "glm-5.3-flash"); // dashes kept
		assert.equal(prettyModel("qwen/qwen3.8-max-0902"), "qwen3.8-max");
	});

	it("provider-qualified stamps keep the provider as a quiet suffix", () => {
		assert.equal(prettyModel("openrouter:z-ai/glm-5.3-flash"), "glm-5.3-flash · openrouter");
		assert.equal(prettyModel("openai:gpt-5.2"), "gpt-5.2 · openai");
		// a bare id: no suffix invented
		assert.equal(prettyModel("z-ai/glm-5.3-flash"), "glm-5.3-flash");
	});
});
