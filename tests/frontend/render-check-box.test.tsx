/**
 * The drawn check box: a mark set after the box first drew is drawn in; a box marked at its first
 * drawing is just marked.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { CheckBox } = await import("../../src/frontend/components/ui/check-row.tsx");

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
});
async function show(mark: "tick" | "half" | null) {
	if (!root) {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	}
	await act(async () => root!.render(<CheckBox mark={mark} />));
}
const drawing = () => document.querySelector("span > span")?.classList.contains("lh-draw-in") ?? false;

describe("the check box", () => {
	it("is just marked when it is marked at its first drawing", async () => {
		await show("tick");
		assert.equal(drawing(), false);
	});

	it("draws in a mark set after it first drew", async () => {
		await show(null);
		await show("tick");
		assert.equal(drawing(), true);
	});

	it("draws in a mark that changes to another", async () => {
		await show("tick");
		await show("half");
		assert.equal(drawing(), true);
	});
});
