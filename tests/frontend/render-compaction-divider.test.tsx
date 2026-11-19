/**
 * THE COMPACTION CUT DIVIDER: SSR render pins (inert). One shaded strip
 * (phase-divider geometry) with the summarized length, at the kept
 * boundary.
 *
 * NOT VIEWABLE: the compaction content is model-facing plumbing; anyone who
 * wants to inspect it reads their provider logs. The pins below hold the
 * divider INERT: plain markup, no button, no affordance, and the marker's
 * summary text never reaches the DOM.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { CompactionCutDivider, type CompactionDividerData } from "../../src/frontend/components/compaction-divider.tsx";

const data: CompactionDividerData = {
	content: "[SESSION HISTORY COMPACTED]\n\nTHE LEARNER'S UNDERSTANDING: …",
	details: {
		firstKeptMessageId: "kept_1",
		tokensBefore: 152000,
		at: "2026-10-05T00:00:00.000Z",
	},
};

describe("CompactionCutDivider", () => {
	it("renders the seam: shaded strip with the summarized length in pages", () => {
		const html = renderToStaticMarkup(<CompactionCutDivider data={data} />);
		assert.ok(html.includes('data-testid="compaction-cut-divider"'));
		assert.ok(!html.includes("border-dotted"));
		assert.ok(html.includes("Earlier messages summarized"));
		// 152000 tokens → 304 pages
		assert.ok(html.includes("about 304 pages"));
	});

	it("is plain markup with no click affordance", () => {
		const html = renderToStaticMarkup(<CompactionCutDivider data={data} />);
		assert.ok(!html.includes("<button"));
		assert.ok(!html.includes("cursor-pointer"));
	});

	it("the marker's summary text never reaches the DOM", () => {
		const html = renderToStaticMarkup(<CompactionCutDivider data={data} />);
		assert.ok(!html.includes("[SESSION HISTORY COMPACTED]"), "the header stays out");
		assert.ok(!html.includes("THE LEARNER"), "the summary stays out");
	});
});
