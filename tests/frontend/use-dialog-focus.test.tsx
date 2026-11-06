/**
 * useDialogFocus: an opening dialog takes focus (its data-autofocus
 * control, else the box itself), and closing gives focus back to a
 * keyboard user's trigger but never to a mouse user's (enter-submits).
 * linkedom tracks no focus, so focus() here just records activeElement.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});
let active: Element | null = null;
Object.defineProperty(dom.document, "activeElement", { get: () => active ?? dom.document.body, configurable: true });
(dom.window.HTMLElement.prototype as unknown as { focus: () => void }).focus = function (this: Element) {
	active = this;
};

const { createRoot } = await import("react-dom/client");
const { useDialogFocus } = await import("../../src/frontend/components/use-dialog-focus.ts");

function Dialog({ open, autofocus }: { open: boolean; autofocus?: boolean }) {
	const ref = useDialogFocus<HTMLDivElement>(open);
	if (!open) return null;
	return (
		<div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" id="dialog">
			<button type="button" id="first">First</button>
			{autofocus && <button type="button" id="go" data-autofocus>Go</button>}
		</div>
	);
}

let root: Root | null = null;
let host: HTMLElement;
function render(open: boolean, autofocus = false) {
	act(() => root!.render(<Dialog open={open} autofocus={autofocus} />));
}
function setup() {
	host = document.createElement("div");
	document.body.appendChild(host);
	const trigger = document.createElement("button");
	document.body.appendChild(trigger);
	trigger.focus();
	root = createRoot(host);
	return trigger;
}
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	document.documentElement.removeAttribute("data-tab-focus");
	active = null;
});

describe("useDialogFocus", () => {
	it("focuses the dialog box when nothing asks for focus", () => {
		setup();
		render(true);
		assert.equal((document.activeElement as Element).id, "dialog");
	});
	it("focuses the data-autofocus control", () => {
		setup();
		render(true, true);
		assert.equal((document.activeElement as Element).id, "go");
	});
	it("a keyboard user gets focus back on the trigger at close", () => {
		const trigger = setup();
		document.documentElement.setAttribute("data-tab-focus", "");
		render(true);
		render(false);
		assert.equal(document.activeElement, trigger);
	});
	it("a mouse user's trigger stays unfocused, so Enter keeps submitting", () => {
		const trigger = setup();
		render(true);
		render(false);
		assert.notEqual(document.activeElement, trigger);
	});
	it("doesn't pull focus back if closing moved it elsewhere", () => {
		const trigger = setup();
		document.documentElement.setAttribute("data-tab-focus", "");
		render(true);
		const elsewhere = document.createElement("input");
		document.body.appendChild(elsewhere);
		elsewhere.focus();
		render(false);
		assert.equal(document.activeElement, elsewhere);
		assert.notEqual(document.activeElement, trigger);
	});
});
