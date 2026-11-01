/**
 * The arrival flash on a linked message: it lights the passage, and leaving
 * the session before it fades clears both the class and its timer.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body></body></html>");
const location = new URL("http://localhost/chat/s#message-m1");
Object.assign(dom.window, { location });
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	getComputedStyle: () => ({ overflowY: "visible", getPropertyValue: () => "" }),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
});
(dom.window.Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

const { StickToBottom } = await import("use-stick-to-bottom");
const { SessionMessageNavigation } = await import("../src/components/session-navigation.tsx");

describe("SessionMessageNavigation flash", () => {
	it("unmounting mid-flash removes the highlight and its pending timer", async () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		await act(async () => root.render(
			<StickToBottom>
				<StickToBottom.Content><p id="message-m1">Linked passage.</p></StickToBottom.Content>
				<SessionMessageNavigation />
			</StickToBottom>,
		));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 150)));
		const passage = document.getElementById("message-m1")!;
		assert.ok(passage.classList.contains("lh-source-highlight"), "the linked passage flashes");

		await act(async () => root.unmount());
		assert.equal(passage.classList.contains("lh-source-highlight"), false, "the flash and its 2 s timer are cleared");
		host.remove();
	});
});
