/**
 * A lesson plugin's window: it hangs from the top bar over the page under the plugin's word, and
 * Escape closes it unless something over it or the agent's screen has the key.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { PluginManifest } from "../../src/frontend/lib/plugins-api.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	getComputedStyle: () => ({ getPropertyValue: () => "", display: "block", visibility: "visible", opacity: "1" }),
	location: { port: "4100" },
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});
Object.assign(dom.window, { innerWidth: 1440, innerHeight: 900 });

const { createRoot } = await import("react-dom/client");
const { PluginWindow } = await import("../../src/frontend/components/lesson/plugin-window.tsx");

const PROBE = JSON.parse(readFileSync(new URL("../fixtures/plugins/probe/manifest.json", import.meta.url), "utf8")) as PluginManifest;
const PLUGIN = { id: "probe", name: "Probe", label: "Probe", manifest: PROBE, values: {} };
const CONTEXT = { space: null, topic: "Slopes", question: null, lastAnswered: null, teacherMessage: null };

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
});

type Boxed = { getBoundingClientRect: () => object };
const place = (testid: string, box: object) => void ((document.querySelector(`[data-testid=${testid}]`) as unknown as Boxed).getBoundingClientRect = () => box);

/** The top bar with the lesson's words, the plugin's ending 216 px from the window's right edge, and the window. */
async function mount(onClose: () => void = () => {}) {
	document.body.innerHTML = `<header class="lh-app-bar"><div class="lh-bar-actions"><button data-testid="lesson-plugin-probe">Probe</button></div></header><div id="host"></div>`;
	place("lesson-plugin-probe", { right: 1224 });
	root = createRoot(document.getElementById("host")!);
	await act(async () => root!.render(<PluginWindow plugin={PLUGIN} context={CONTEXT} onClose={onClose} />));
}

/** linkedom has no KeyboardEvent: a keydown carrying its key. */
const escape = () =>
	act(async () => {
		const key = Object.assign(new dom.window.Event("keydown", { bubbles: true }), { key: "Escape" });
		document.dispatchEvent(key);
	});

describe("a lesson plugin's window", () => {
	it("hangs under its word, right edges lined up, 360 wide and 120 tall until the page says, with no head and no Close", async () => {
		await mount();
		const shown = document.querySelector("[data-testid=plugin-window]")!;
		assert.equal(shown.getAttribute("aria-label"), "Probe");
		assert.match(shown.parentElement!.getAttribute("style")!, /right:\s*216px/);
		assert.match(shown.getAttribute("style")!, /width:\s*360px;\s*height:\s*120px/);
		assert.ok(shown.querySelector("[data-testid=plugin-frame]"));
		assert.equal(shown.querySelectorAll("button, h2, h3").length, 0);
	});

	it("closes on Escape, but not while Find is open", async () => {
		let closed = 0;
		await mount(() => void closed++);
		const find = document.createElement("div");
		find.setAttribute("data-testid", "session-find");
		document.body.append(find);
		await escape();
		assert.equal(closed, 0, "Find closes first");
		find.remove();
		await escape();
		assert.equal(closed, 1);
	});
});
