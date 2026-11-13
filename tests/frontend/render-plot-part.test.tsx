import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlotPart } from "../../src/frontend/components/lesson/plot-part.tsx";
import { LEASH_CALL, LEASH_RESULT } from "../plot-fixtures.ts";

function render(part: Record<string, unknown>): string {
	return renderToStaticMarkup(<PlotPart part={{ type: "tool-plot", toolCallId: "call_p", input: LEASH_CALL, ...part } as never} />);
}

const paths = (html: string) => html.match(/<path /g)?.length ?? 0;

describe("PlotPart", () => {
	it("arrives locked: the shown line alone, its key and formula, no slider", () => {
		const html = render({ state: "output-available", output: LEASH_RESULT, guessOpen: false });
		assert.match(html, /data-state="locked"/);
		assert.match(html, /One feature, where the weight ends up/);
		assert.equal(paths(html), 1, "only the leash");
		assert.match(html, /stroke-dasharray="6 4"/, "the second line is dashed");
		const keys = html.match(/data-testid="plot-key"/g) ?? [];
		assert.equal(keys.length, 1);
		assert.match(html, />leash</);
		assert.ok(!html.includes(">penalty<"), "the held-back line's key is not drawn");
		assert.match(html, /class="katex"/, "formulas and the axis titles are typeset");
		assert.ok(!html.includes("plot-slider"), "no slider row");
		assert.match(html, /aria-live="polite"[^>]*>At lambda 1, a = 0, 5, 10: leash 0, 2, 2\.</);
	});

	it("opens on his answer: both lines, both keys and the slider", () => {
		const html = render({ state: "output-available", output: LEASH_RESULT, guessOpen: true });
		assert.match(html, /data-state="open"/);
		assert.equal(paths(html), 2);
		assert.equal((html.match(/data-testid="plot-key"/g) ?? []).length, 2);
		assert.match(html, />penalty</);
		assert.match(html, /data-testid="plot-slider"[^>]*aria-valuetext="lambda 1"/);
		assert.match(html, /type="range"[^>]*min="0.5"[^>]*max="4"/);
		for (const tick of ["0.5", "1", "2", "3", "4"]) assert.match(html, new RegExp(`>${tick.replace(".", "\\.")}</text>`));
		assert.ok(!html.includes("lh-draw-in"), "opened before it was shown: drawn at once");
		assert.match(html, /penalty 0, 2\.5, 5\. leash 0, 2, 2\./);
	});

	it("while the call is checked: the title and Drawing the plot", () => {
		const html = render({ state: "input-streaming" });
		assert.match(html, /data-state="drawing"/);
		assert.match(html, /Drawing the plot/);
		assert.equal(paths(html), 0);
	});

	it("a stored plot that no longer parses: its title and the line", () => {
		const html = render({ state: "output-available", output: { ...LEASH_RESULT, v: 2 } });
		assert.match(html, /One feature, where the weight ends up/);
		assert.match(html, /This plot could not be drawn\./);
	});

	it("keeps whatever its math draws inside its box", () => {
		for (const html of [render({ state: "output-available", output: LEASH_RESULT, guessOpen: true }), render({ state: "input-streaming" })]) {
			assert.match(html, /<figure [^>]*class="[^"]*\boverflow-hidden\b/);
		}
	});

	it("a call that never got a result draws nothing", () => {
		assert.equal(render({ state: "input-available" }), "");
	});
});
