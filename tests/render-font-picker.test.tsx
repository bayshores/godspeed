/**
 * The reading-font menu keeps the app's menu contract: Escape closes it
 * and focus goes back to its trigger.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
});
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });

const { createRoot } = await import("react-dom/client");
const { AppearanceSection } = await import("../src/components/settings/appearance-section.tsx");

it("Escape closes the reading-font menu and returns focus to its trigger", async () => {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(<AppearanceSection appearance={undefined} onSectionChange={() => {}} />));
	const trigger = host.querySelector<HTMLButtonElement>('[data-testid="font-trigger"]')!;
	let focused = 0;
	trigger.focus = () => {
		focused++;
	};
	await act(async () => trigger.click());
	assert.equal(trigger.getAttribute("aria-expanded"), "true");
	const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.defineProperty(esc, "key", { value: "Escape" });
	await act(async () => void document.dispatchEvent(esc));
	assert.equal(trigger.getAttribute("aria-expanded"), "false");
	assert.equal(focused, 1);
	await act(async () => root.unmount());
	host.remove();
});
