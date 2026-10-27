import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { SetupDialog } from "../components/setup-dialog.tsx";
import type { ModelCatalogEntry } from "../src/core/contracts/models.ts";

// As in render-update-banner: mount real React handlers against an isolated
// DOM. Fetch is wholly stubbed; no settings or session writes can escape.
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const originalFetch = globalThis.fetch;
const provider = { id: "chatgpt" };
const model: ModelCatalogEntry = {
	id: "fixture-text",
	name: "Fixture text",
	provider: provider.id,
	reasoning: false,
	input: ["text"],
	supportedLevels: ["off"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
};
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let closed = 0;
let completed = 0;

async function mount({ connected = false, catalogFails = false } = {}) {
	closed = 0;
	completed = 0;
	globalThis.fetch = async (input, init) => {
		assert.equal(init?.method ?? "GET", "GET", "interaction tests must not write data");
		const path = new URL(String(input), "http://localhost").pathname;
		// The connect stage's subscription controls may read their own state;
		// they get nothing here (the stage itself is under test).
		if (path !== "/api/models") return new Response(null, { status: 404 });
		if (catalogFails) throw new Error("fixture catalog failure");
		return Response.json({
			providers: [{ ...provider, connected }],
			models: connected ? [model] : [],
			slots: { strong: null, cheap: null, vision: null },
		});
	};
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	function Harness() {
		const [open, setOpen] = React.useState(true);
		return <SetupDialog open={open} onClose={() => { closed++; setOpen(false); }} onDone={() => { completed++; }} />;
	}
	await act(async () => { root!.render(<Harness />); });
}

function element(selector: string): HTMLElement {
	const node = document.querySelector<HTMLElement>(selector);
	assert.ok(node, `expected ${selector}`);
	return node;
}

async function event(target: HTMLElement, type: string) {
	await act(async () => {
		const dispatched = new dom.window.Event(type, { bubbles: true, cancelable: true });
		Object.assign(dispatched, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, detail: 1 });
		target.dispatchEvent(dispatched);
	});
}

async function click(target: HTMLElement) {
	for (const type of ["pointerdown", "pointerup", "click"]) await event(target, type);
}

// Closing plays a short exit (motion wave, usePresence): the element flips to
// data-state="closed", then unmounts once the exit has run.
async function settle() {
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
}

function gone(selector: string) {
	// Compare booleans: a failed equal() on a DOM node prints the whole tree.
	assert.equal(document.querySelector(selector) === null, true, `expected ${selector} gone`);
}

function closing(selector: string) {
	assert.equal(document.querySelector(selector)?.getAttribute("data-state"), "closed", `expected ${selector} closing`);
}

async function escape() {
	await act(async () => {
		const key = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.assign(key, { key: "Escape" });
		document.dispatchEvent(key);
	});
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	host?.remove();
	host = null;
	globalThis.fetch = originalFetch;
	assert.equal(completed, 0, "opening or dismissing setup must not save models");
});

describe("setup polish interactions", () => {
	it("no connection: the connect stage shows; Escape closes setup", async () => {
		await mount();
		assert.ok(element('[data-testid="setup-stage-connect"]').textContent?.includes("Sign in to a subscription."));
		assert.equal(document.querySelector('[data-testid="setup-key-provider"]'), null, "no API-key picker");
		await escape();
		assert.equal(closed, 1);
		closing('[data-testid="setup-dialog"]');
		await settle();
		gone('[data-testid="setup-dialog"]');
	});

	it("a genuine backdrop click closes setup", async () => {
		await mount();
		await click(element('[data-testid="setup-backdrop"]'));
		assert.equal(closed, 1);
		closing('[data-testid="setup-dialog"]');
		await settle();
		gone('[data-testid="setup-dialog"]');
	});

	it("inside press followed by backdrop release and ancestor click does not dismiss setup", async () => {
		await mount();
		await event(element('[data-testid="setup-dialog"] h2'), "pointerdown");
		await event(element('[data-testid="setup-backdrop"]'), "pointerup");
		await event(element('[data-testid="setup-backdrop"]'), "click");
		assert.equal(closed, 0);
		assert.ok(document.querySelector('[data-testid="setup-dialog"]'));
	});

	it("model and thinking dropdowns keep outside-click dismissal and model guidance uses two sentences", async () => {
		await mount({ connected: true });
		assert.equal(element('[data-testid="setup-stage-pickers"] > p').textContent, "Pick the model for each tier. All three are required before chats can start.");
		await click(element('[data-testid="setup-trigger-strong"]'));
		await click(element('[data-testid="setup-dialog"] h2'));
		closing('[data-testid="setup-menu-strong"]');
		await settle();
		gone('[data-testid="setup-menu-strong"]');
		await click(element('[data-testid="setup-trigger-strong"]'));
		await click(element('[data-testid="model-option-fixture-text"]'));
		await click(element('[data-testid="setup-thinking-strong"]'));
		assert.ok(document.querySelector('[data-testid="setup-thinking-menu-strong"]'));
		await click(element('[data-testid="setup-dialog"] h2'));
		closing('[data-testid="setup-thinking-menu-strong"]');
		await settle();
		gone('[data-testid="setup-thinking-menu-strong"]');
		assert.equal(closed, 0);
	});

	it("the empty vision list gives the approved next action without an em dash", async () => {
		await mount({ connected: true });
		await click(element('[data-testid="setup-trigger-vision"]'));
		assert.ok(element('[data-testid="setup-menu-vision"]').textContent?.includes("No image-capable models. Sign in to a subscription with a vision model."));
	});

	it("catalog failure uses the approved two-sentence error", async () => {
		await mount({ catalogFails: true });
		assert.ok(element('[data-testid="setup-dialog"]').textContent?.includes("Model catalog could not be loaded. Check the connection and retry."));
	});
});
