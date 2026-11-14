import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlotPart } from "../../src/frontend/components/lesson/plot-part.tsx";
import { CV_CALL, CV_RESULT, LEASH_CALL, LEASH_RESULT } from "../plot-fixtures.ts";

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

	it("measured points: one path with a square on each point, no formula and no slider row once open", () => {
		const html = render({ input: CV_CALL, state: "output-available", output: CV_RESULT, guessOpen: true });
		assert.match(html, /data-state="open"/);
		assert.equal(paths(html), 1);
		assert.equal((html.match(/data-testid="plot-point"/g) ?? []).length, 4);
		assert.match(html, />cv_error</);
		assert.ok(!html.includes("plot-formula"), "no formula under the key");
		assert.ok(!html.includes("plot-slider"), "no slider row");
		assert.match(html, /style="height:311px"/, "the card keeps the locked height");
		assert.match(html, /aria-live="polite"[^>]*>degree = 1, 3, 5, 9: cv_error 0\.8, 0\.4, 0\.3, 0\.9\.</);
	});

	it("locked, a shown points line holds back the point its guess asks at; open, it draws in", () => {
		const locked = render({ input: CV_CALL, state: "output-available", output: CV_RESULT, guessOpen: false, guessAt: { line: "cv_error", x: 5 } });
		assert.match(locked, /data-state="locked"/);
		assert.equal((locked.match(/data-testid="plot-point"/g) ?? []).length, 3);
		assert.match(locked, / d="M95,91L197,211M503,61Z"/, "no segment touches the held-back point");
		assert.match(locked, /aria-live="polite"[^>]*>degree = 1, 3, 9: cv_error 0\.8, 0\.4, 0\.9\.</);
		const open = render({ input: CV_CALL, state: "output-available", output: CV_RESULT, guessOpen: true, guessAt: { line: "cv_error", x: 5 } });
		assert.equal((open.match(/data-testid="plot-point"/g) ?? []).length, 4);
		assert.match(open, /degree = 1, 3, 5, 9: cv_error 0\.8, 0\.4, 0\.3, 0\.9\./);
	});

	it("a formula against held-back data: the data and its squares draw in on the answer", () => {
		const mixed = { ...LEASH_CALL, lines: [{ label: "model", expr: "a/(1+lambda)" }, { label: "data", points: [[2, 1.2], [6, 2.7], [10, 5.4]], hidden: true }] };
		const locked = render({ input: mixed, state: "output-available", output: LEASH_RESULT, guessOpen: false });
		assert.equal(paths(locked), 1);
		assert.ok(!locked.includes("plot-point"), "the held-back points are not drawn");
		const open = render({ input: mixed, state: "output-available", output: LEASH_RESULT, guessOpen: true });
		assert.equal(paths(open), 2);
		assert.equal((open.match(/data-testid="plot-point"/g) ?? []).length, 3);
		assert.match(open, /data-testid="plot-slider"/);
		assert.equal((open.match(/data-testid="plot-formula"/g) ?? []).length, 1, "a formula only under the model's key");
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

	it("its picture is named by the title's words, math without dollar signs", () => {
		const html = renderToStaticMarkup(<PlotPart part={{ type: "tool-plot", toolCallId: "call_p", input: { ...LEASH_CALL, title: "Where $w$ ends up" }, state: "output-available", output: LEASH_RESULT } as never} />);
		assert.match(html, /<svg role="img" aria-label="Where w ends up"/);
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
