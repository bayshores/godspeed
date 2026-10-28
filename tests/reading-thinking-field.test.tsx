import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReadingThinkingField } from "../src/components/reading-thinking.tsx";

describe("the reading-thinking field (redesign: fills the Your-turn panel)", () => {
	it("labels the field and lets it fill the panel column", () => {
		const html = renderToStaticMarkup(<ReadingThinkingField value="" onChange={() => {}} />);
		assert.match(html, /Thinking while reading/);
		assert.match(html, /<textarea[^>]*class="[^"]*flex-1/, "the field grows into the free height");
		// Vertical padding absorbs Source Sans 3's 1px overhang (the old
		// permanent-scrollbar bug, owner round 2026-10-07).
		assert.match(html, /<textarea[^>]*class="[^"]*py-3/);
	});
});
