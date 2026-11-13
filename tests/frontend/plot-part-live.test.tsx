/**
 * The plot's screen-reader line waits until the slider settles, so a drag
 * across the track speaks one sentence, not one a step.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { parseHTML } from "linkedom";
import { it, mock } from "node:test";
import assert from "node:assert/strict";
import { LEASH_CALL, LEASH_RESULT } from "../plot-fixtures.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
// linkedom's document has no "oninput"; without it React would watch the
// slider an old-IE way. Nor does it lay out, so the plot gets a width.
(dom.document as unknown as { oninput: null }).oninput = null;
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 554 });
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});

const { createRoot } = await import("react-dom/client");
const { PlotPart } = await import("../../src/frontend/components/lesson/plot-part.tsx");

it("the live line speaks the slider's place about 300 ms after its last move", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const live = () => host.querySelector('[aria-live="polite"]')!.textContent;
	const slide = (value: string) =>
		act(async () => {
			const input = host.querySelector('[data-testid="plot-slider"]')!;
			Object.defineProperty(input, "value", { configurable: true, writable: true, value });
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
	try {
		await act(async () => root.render(<PlotPart part={{ type: "tool-plot", toolCallId: "call_p", input: LEASH_CALL, state: "output-available", output: LEASH_RESULT, guessOpen: true } as never} />));
		assert.match(live()!, /^At lambda 1,/);
		await slide("2");
		await slide("3");
		assert.match(live()!, /^At lambda 1,/, "not while it moves");
		await act(async () => mock.timers.tick(299));
		assert.match(live()!, /^At lambda 1,/);
		await act(async () => mock.timers.tick(1));
		assert.match(live()!, /^At lambda 3, a = 0, 5, 10: penalty 0, 1\.25, 2\.5\./, "once, at where it stopped");
	} finally {
		await act(async () => root.unmount());
		host.remove();
		mock.timers.reset();
	}
});
