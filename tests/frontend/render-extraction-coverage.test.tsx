import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CoverageMenuBody, type SessionCoverage } from "../../src/frontend/components/extraction-coverage.tsx";

/**
 * The sidebar context menu's coverage block: one plain status line and
 * the manual "Add to graph". The presentational body is pinned here; the live
 * fetch (menu-open read, the 2s running poll) is Playwright's beat.
 */

function coverage(over: Partial<SessionCoverage> = {}): SessionCoverage {
	return {
		totalMessages: 12,
		coveredCount: 7,
		uncoveredCount: 5,
		coveredTokens: 30_000,
		uncoveredTokens: 2_048,
		running: false,
		lastFoldedAt: null,
		...over,
	};
}

describe("CoverageMenuBody — the context-menu block", () => {
	it("renders the plain status + Add to graph", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage()} extracting={false} onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage"'), "the block carries its testid");
		assert.match(html, /Some of it isn&#x27;t in the graph yet/);
		assert.ok(!/tok|unextracted/.test(html), "no token or message counts");
		assert.ok(html.includes(">Add to graph</button>"));
		assert.ok(!html.includes('disabled=""'), "an uncovered session can extract (the disabled: utilities alone don't count)");
	});

	it("all in the graph: the quiet line, the button disabled (never a fake run)", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody
				coverage={coverage({ uncoveredTokens: 0, uncoveredCount: 0 })}
				extracting={false}
				onExtract={() => {}}
			/>,
		);
		assert.match(html, /All its facts are in the graph/);
		assert.ok(html.includes("disabled"), "nothing to run — the button rests");
	});

	it("running: the pulse line + 'Adding…' (motion is the state)", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage({ running: true })} extracting={false} onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage-running"'));
		assert.match(html, /Adding its facts to the graph…/);
		assert.ok(html.includes(">Adding…</button>"), "the button reads Adding… while in flight");
		assert.ok(html.includes("disabled"), "no double-fire");
	});

	it("optimistic (click-pending, server not yet saying running): same running shape", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage()} extracting onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage-running"'), "the optimistic state shows at once");
		assert.match(html, />Adding…</);
	});
});
