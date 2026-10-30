/**
 * The shared tooltip opens on KEYBOARD FOCUS, not only on hover, and
 * Escape closes it — mounted with real React handlers over linkedom.
 * Also pins its two flat looks: the box (tip surface, tone-2 edge, bold
 * title) and the white tag (Hint).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";

const dom = parseHTML("<html><body></body></html>");
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
	// Radix Presence reads the exit animation's name; linkedom has no styles.
	getComputedStyle: () => ({ animationName: "none", display: "block", getPropertyValue: () => "" }),
});
if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
	(globalThis as Record<string, unknown>).ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });

// Imported AFTER the DOM globals: Radix picks its layout-effect hook (and so
// whether its Portal ever mounts) when the module first loads.
const { Hint } = await import("../src/components/ui/hint.tsx");
const { Tip, TOOLTIP_DELAY_MS } = await import("../src/components/ui/tooltip.tsx");

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = null;
	host = null;
});

async function mount() {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<Tip title="Waiting for your answer" body="Teacher replied 1 day ago">
				<button type="button" data-testid="trigger">Gradient descent</button>
			</Tip>,
		);
	});
	const trigger = document.querySelector<HTMLElement>('[data-testid="trigger"]');
	assert.ok(trigger, "the trigger renders as-is");
	return trigger;
}

function tooltip(): Element | null {
	return document.querySelector('[data-slot="tooltip-content"]');
}

describe("Tip — keyboard focus opens it, Escape closes it", () => {
	it("focus opens the box at once with the title and body", async () => {
		const trigger = await mount();
		assert.equal(tooltip(), null, "closed until focused or hovered");
		await act(async () => {
			trigger.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
		});
		const box = tooltip();
		assert.ok(box, "focus opened the tooltip");
		assert.match(box.textContent ?? "", /Waiting for your answer/);
		assert.match(box.textContent ?? "", /Teacher replied 1 day ago/);
	});

	it("Escape closes it", async () => {
		const trigger = await mount();
		await act(async () => {
			trigger.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
		});
		assert.ok(tooltip());
		await act(async () => {
			const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
			Object.assign(esc, { key: "Escape" });
			trigger.dispatchEvent(esc);
		});
		const box = tooltip();
		assert.ok(box === null || box.getAttribute("data-state") === "closed", "closed (or playing its fade-out)");
	});
});

describe("the tooltip's look", () => {
	it("hover waits 150ms (focus does not wait)", () => {
		assert.equal(TOOLTIP_DELAY_MS, 150);
	});

	it("the box is flat: solid tip surface, tone-2 edge, no glass, bold title", async () => {
		const trigger = await mount();
		await act(async () => {
			trigger.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
		});
		const html = tooltip()!.outerHTML;
		assert.match(html, /bg-tip/);
		assert.match(html, /border-tone-2/);
		assert.doesNotMatch(html, /lh-glass|shadow|rounded/);
		assert.match(html, /class="[^"]*font-bold[^"]*" data-slot="tooltip-title">Waiting for your answer</);
	});

	it("Hint is the white tag: the label alone, no shortcut", async () => {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => {
			root!.render(
				<Hint label="Settings">
					<button type="button" data-testid="hint-trigger">S</button>
				</Hint>,
			);
		});
		await act(async () => {
			document.querySelector('[data-testid="hint-trigger"]')!.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
		});
		const tag = tooltip()!;
		assert.match(tag.className, /bg-ink/);
		assert.match(tag.className, /text-background/);
		assert.equal(tag.textContent, "Settings");
	});

	it("disabled: the trigger renders alone, no tooltip wiring", () => {
		const html = renderToStaticMarkup(
			<Tip disabled title="x">
				<button type="button">Row</button>
			</Tip>,
		);
		assert.equal(html, '<button type="button">Row</button>');
	});
});
