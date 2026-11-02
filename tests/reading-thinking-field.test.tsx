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
		assert.match(html, /data-testid="math-box" class="[^"]*flex-1/, "the field grows into the free height");
		assert.match(html, /Whatever comes to mind as you read\./);
	});
});
