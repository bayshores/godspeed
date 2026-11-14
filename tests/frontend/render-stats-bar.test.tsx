import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StatsBar, contextMeter, turnSize } from "../../src/frontend/components/stats-bar.tsx";
import { sessionCost } from "../../src/shared/core/prices.ts";
import { planCostLabel, prettyModel } from "../../src/frontend/components/usage-format.ts";
import type { TurnUsage } from "../../src/shared/core/contracts.ts";

// The stats bar: folds only (no cost math in the component), the "–"
// doctrine for absent data, and the outside agent's context budget as the
// meter's denominator is where the lesson gets summarized. There is no model control (the outside agent picks
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
	it("stays hidden until the lesson is 80% of the way to being summarized", () => {
		assert.equal(renderToStaticMarkup(<StatsBar turns={[]} />), "");
		assert.equal(renderToStaticMarkup(<StatsBar turns={[turn()]} contextTokens={11_000} summarizeAt={40_000} />), "");
		const html = renderToStaticMarkup(<StatsBar turns={[turn(), turn()]} contextTokens={33_000} summarizeAt={40_000} pricing={sessionCost({ turns: [turn(), turn()] })} />);
		assert.match(html, /data-testid="stats-context">33k \/ 40k<\/span> lesson</);
		assert.ok(!html.includes('data-testid="stats-model"'), "no model control");
		assert.ok(!html.includes("Your agent"), "the plan label stays in the details");
	});

	it("shows – for cost when every turn is unpriceable, never a fake $0", () => {
		assert.equal(planCostLabel(sessionCost({ turns: [turn({ model: "nope/unknown" })] }).subscriptionProviders), "–");
	});

	it("the meter's text: none while unknown or below 80%", () => {
		assert.equal(contextMeter(null, 100_000), null, "cleared by a summary");
		assert.equal(contextMeter(83_000, null), null);
		assert.equal(contextMeter(79_000, 100_000), null);
		assert.equal(contextMeter(83_000, 100_000), "83k / 100k");
	});
});

describe("stats popup", () => {
	it("is a button with a down arrow, and the popup holds the explaining line, the rows and the newest turn first", async () => {
		const { act } = await import("react");
		const { createRoot } = await import("react-dom/client");
		const { parseHTML } = await import("linkedom");
		const dom = parseHTML("<html><body></body></html>");
		Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const turns = [turn({ messageId: "a", steps: [step(10_000, 1_000), step(11_000, 1_400)] }), turn({ messageId: "b", steps: [step(8_000, 100, { cacheReadTokens: 2_000 })] })];
		try {
			await act(async () => root.render(<StatsBar turns={turns} contextTokens={83_000} summarizeAt={100_000} pricing={{ unpriced: 0, subscription: 2 }} />));
			assert.match(host.querySelector("[data-testid='stats-summary']")!.textContent!, /83k \/ 100k lesson/);
			assert.ok(host.querySelector("[data-testid='stats-detail']") === null);
			await act(async () => host.querySelector<HTMLButtonElement>("[data-testid='stats-summary']")!.click());
			const detail = host.querySelector("[data-testid='stats-detail']")!.textContent!;
			assert.match(detail, /Session statsSummarizes here to keep the lesson small\. Change it in Settings\. Your agent's own context is separate\./);
			assert.match(detail, /Lesson size83k \/ 100kUsage.*Turns2/);
			assert.ok(!detail.includes("Unpriced turns"), "only when above 0");
			assert.ok(detail.indexOf("#2, 1 step10.1k") < detail.indexOf("#1, 2 steps12.4k"), "newest first");
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	});

	it("a turn's size is its last step's tokens, – when none were recorded", () => {
		assert.equal(turnSize(turn({ steps: [step(1_000, 10), step(11_000, 1_400, { cacheReadTokens: 2_000 })] })), "14.4k");
		assert.equal(turnSize(turn({ steps: [] })), "–");
		assert.equal(turnSize(turn({ steps: [step(undefined as unknown as number, 5)] })), "–");
	});
});

describe("prettyModel", () => {
	it("prettyModel strips vendor + date suffix, keeps dashes", () => {
		assert.equal(prettyModel("z-ai/glm-5.3-flash"), "glm-5.3-flash"); // dashes kept
		assert.equal(prettyModel("qwen/qwen3.8-max-0902"), "qwen3.8-max");
	});

	it("provider-qualified stamps keep the provider as a quiet suffix", () => {
		assert.equal(prettyModel("openrouter:z-ai/glm-5.3-flash"), "glm-5.3-flash (openrouter)");
		assert.equal(prettyModel("openai:gpt-5.2"), "gpt-5.2 (openai)");
		// a bare id: no suffix invented
		assert.equal(prettyModel("z-ai/glm-5.3-flash"), "glm-5.3-flash");
	});
});
