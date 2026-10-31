import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CoverageMenuBody, type SessionCoverage } from "../src/components/extraction-coverage.tsx";

/**
 * The sidebar context menu's coverage block: the numbers and the manual
 * Extract affordance. The presentational body is pinned here; the live
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
	it("renders the uncovered numbers + the Extract affordance", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage()} extracting={false} onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage"'), "the block carries its testid");
		assert.match(html, /2k tok uncovered/, "the unit is typed out — tok");
		assert.match(html, /5 messages unextracted/);
		assert.ok(html.includes('data-testid="ctx-extract"'), "the Extract affordance");
		assert.ok(!html.includes('disabled=""'), "an uncovered session can extract (the disabled: utilities alone don't count)");
	});

	it("fully extracted: the quiet line, Extract disabled (never a fake run)", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody
				coverage={coverage({ uncoveredTokens: 0, uncoveredCount: 0 })}
				extracting={false}
				onExtract={() => {}}
			/>,
		);
		assert.match(html, /fully extracted/);
		assert.ok(html.includes("disabled"), "nothing to run — the button rests");
	});

	it("running: the pulse line + 'Running', not the numbers (motion is the state)", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage({ running: true })} extracting={false} onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage-running"'));
		assert.match(html, /extracting…/);
		assert.ok(html.includes(">Running</button>"), "the affordance reads Running while in flight");
		assert.ok(html.includes("disabled"), "no double-fire");
	});

	it("optimistic (click-pending, server not yet saying running): same running shape", () => {
		const html = renderToStaticMarkup(
			<CoverageMenuBody coverage={coverage()} extracting onExtract={() => {}} />,
		);
		assert.ok(html.includes('data-testid="ctx-coverage-running"'), "the optimistic state shows at once");
		assert.match(html, />Running</);
	});
});
