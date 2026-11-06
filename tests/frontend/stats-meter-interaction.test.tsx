import React, { act } from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { StatsBar } from "../../src/frontend/components/stats-bar.tsx";
import type { TurnUsage } from "../../src/shared/core/index.ts";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });

test("meter keeps its measured numerator over the summarize point, and hides once a summary clears it", async () => {
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	const turn: TurnUsage = { id: "summary", messageId: "marker", at: "fixture", model: "fixture:a", steps: [{ inputTokens: 4300, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }] };
	const pricing = { unpriced: 1 };
	try {
		await act(async () => root.render(<StatsBar turns={[turn]} contextTokens={83_000} summarizeAt={100_000} pricing={pricing} />));
		const context = () => host.querySelector('[data-testid="stats-context"]')?.textContent;
		assert.equal(context(), "83k / 100k", "summarizer's 4.3k money log is not the meter source");
		await act(async () => root.render(<StatsBar turns={[turn]} contextTokens={null} summarizeAt={100_000} pricing={pricing} />));
		assert.equal(context(), undefined, "a summary clears it");
		await act(async () => root.render(<StatsBar turns={[turn]} contextTokens={92_000} summarizeAt={100_000} pricing={pricing} />));
		assert.equal(context(), "92k / 100k");
	} finally {
		await act(async () => root.unmount()); host.remove();
	}
});
