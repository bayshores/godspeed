/**
 * THE COMPACTION DIVIDERS — SSR render pins (inert). Two ruled surfaces from one marker: the
 * MOMENT divider (minimal centered small text, the retrying-message
 * register — no rule lines) where the user is when compaction lands, and
 * the CUT divider (the longer one — phase-divider geometry, dotted rules
 * + a chip carrying the summarized token count) at the kept boundary.
 *
 * NOT VIEWABLE: the summary dialog is gone — the
 * compaction content is model-facing plumbing; anyone who wants to
 * inspect it reads their provider logs. The pins below hold the
 * dividers INERT: plain markup, no button, no affordance, and the
 * marker's summary text never reaches the DOM.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
	CompactionCutDivider,
	CompactionMomentDivider,
	type CompactionDividerData,
} from "../src/components/compaction-divider.tsx";

const data: CompactionDividerData = {
	content: "[SESSION HISTORY COMPACTED]\n\nTHE LEARNER'S UNDERSTANDING: …",
	details: {
		firstKeptMessageId: "kept_1",
		tokensBefore: 152000,
		at: "2026-10-05T00:00:00.000Z",
	},
};

const INERT = ["no click affordance survives"];

describe("CompactionMomentDivider", () => {
	it("renders the minimal centered note — no rule lines, retrying-message register", () => {
		const html = renderToStaticMarkup(<CompactionMomentDivider data={data} />);
		assert.ok(html.includes('data-testid="compaction-divider"'));
		assert.ok(html.includes("Lesson summarized"));
		// NO horizontal rule (unlike the cut)
		assert.ok(!html.includes("border-t-2"));
	});
});

describe("CompactionCutDivider", () => {
	it("renders the longer seam — dotted rules + chip with the summarized length in pages", () => {
		const html = renderToStaticMarkup(<CompactionCutDivider data={data} />);
		assert.ok(html.includes('data-testid="compaction-cut-divider"'));
		assert.ok(html.includes("border-t-2 border-dotted"));
		assert.ok(html.includes("Earlier messages summarized"));
		// 152000 tokens → 304 pages
		assert.ok(html.includes("about 304 pages"));
	});
});

describe("not viewable", () => {
	it("neither divider is a button — plain markup, no click affordance", () => {
		for (const html of [
			renderToStaticMarkup(<CompactionMomentDivider data={data} />),
			renderToStaticMarkup(<CompactionCutDivider data={data} />),
		]) {
			assert.ok(!html.includes("<button"), INERT[0]);
			assert.ok(!html.includes("cursor-pointer"), INERT[0]);
		}
	});

	it("the marker's summary text never reaches the DOM — provider logs are the inspection path", () => {
		for (const html of [
			renderToStaticMarkup(<CompactionMomentDivider data={data} />),
			renderToStaticMarkup(<CompactionCutDivider data={data} />),
		]) {
			assert.ok(!html.includes("[SESSION HISTORY COMPACTED]"), "the header stays out");
			assert.ok(!html.includes("THE LEARNER"), "the summary stays out");
		}
	});
});
