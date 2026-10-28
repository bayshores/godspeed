import React, { act } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { StatsBar } from "../components/stats-bar.tsx";
import type { TurnUsage } from "../src/core/index.ts";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });

test("meter keeps its measured numerator over the agent's 200k budget, and renders post-compaction unknown", async () => {
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	const turn: TurnUsage = { id: "summary", messageId: "marker", at: "fixture", model: "fixture:a", steps: [{ inputTokens: 4300, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }] };
	const pricing = { cost: 0.003, unpriced: 0, turnCosts: { summary: 0.003 } };
	try {
		await act(async () => root.render(<StatsBar chatId="fixture" turns={[turn]} contextTokens={83_000} pricing={pricing} />));
		const context = () => host.querySelector('[data-testid="stats-context"]')?.textContent;
		assert.equal(context(), "83k / 200k", "summarizer's 4.3k money log is not the meter source");
		await act(async () => root.render(<StatsBar chatId="fixture" turns={[turn]} contextTokens={null} pricing={pricing} />));
		assert.equal(context(), "? / 200k");
		assert.equal(host.querySelector('[data-testid="stats-cost"]')?.textContent, "$0.0030", "summary spending is still visible");
		await act(async () => root.render(<StatsBar chatId="fixture" turns={[turn]} contextTokens={72_000} pricing={pricing} />));
		assert.equal(context(), "72k / 200k");
	} finally {
		await act(async () => root.unmount()); host.remove();
	}
});
