import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReadingThinkingField } from "../src/components/reading-thinking.tsx";

describe("the reading-thinking field (redesign: fills the Your-turn panel)", () => {
	it("fills the panel column with no label over it (its placeholder says it)", () => {
		const html = renderToStaticMarkup(<ReadingThinkingField value="" onChange={() => {}} />);
		assert.doesNotMatch(html, /Thinking while reading/);
		assert.match(html, /data-testid="math-box" class="[^"]*flex-1/, "the field grows into the free height");
		assert.match(html, /Whatever comes to mind as you read\./);
	});
	it("reads as a page: a visible edge, 16px text and room around it", () => {
		const html = renderToStaticMarkup(<ReadingThinkingField value="" onChange={() => {}} />);
		assert.match(html, /data-testid="math-box" class="[^"]*border border-tone-2[^"]*text-\[16px\]!/);
		assert.match(html, /class="px-5 py-\[18px\] text-ink-3"/, "the placeholder before the editor loads has the same padding");
	});
});
