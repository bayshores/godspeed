/**
 * The mark of the lit one of a row of tabs: one box, put on the lit tab,
 * that slides only when another tab lights.
 */
import React, { act, useRef } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body></body></html>");
let resized: (() => void)[] = [];
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		constructor(callback: () => void) {
			resized.push(callback);
		}
		observe() {}
		disconnect() {}
	},
});
// Each element's box is written on it: "left top width height".
(dom.window.Element.prototype as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = function (this: Element) {
	const [left = 0, top = 0, width = 0, height = 0] = (this.getAttribute("data-box") ?? "").split(" ").map(Number);
	return { left, top, width, height, right: left + width, bottom: top + height };
};

const { createRoot } = await import("react-dom/client");
const { useLitMarker } = await import("../../src/frontend/components/lit-marker.ts");

function Row({ lit, wide }: { lit: string | null; wide?: boolean }) {
	const row = useRef<HTMLElement>(null);
	const marker = useLitMarker(row, "[data-lit]", lit);
	return (
		<nav ref={row} data-box="100 10 600 40">
			<div ref={marker} hidden data-testid="marker" />
			<a data-box="100 10 80 40" data-lit={lit === "home" ? "" : undefined}>
				Home
			</a>
			<a data-box={wide ? "180 10 200 40" : "180 10 120 40"} data-lit={lit === "space" ? "" : undefined}>
				Space
			</a>
		</nav>
	);
}

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	resized = [];
	document.body.innerHTML = "";
});
async function show(node: React.ReactNode) {
	if (!root) {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	}
	await act(async () => root!.render(node));
}
const marker = () => document.querySelector<HTMLElement>('[data-testid="marker"]')!;
const box = () => ["left", "top", "width", "height"].map((side) => marker().style.getPropertyValue(side)).join(" ");

describe("the lit marker", () => {
	it("lies on the lit tab from the start, without sliding there", async () => {
		await show(<Row lit="home" />);
		assert.equal(marker().hidden, false);
		assert.equal(box(), "0px 0px 80px 40px", "measured inside the row");
		assert.equal(marker().hasAttribute("data-slide"), false);
	});

	it("slides when another tab lights", async () => {
		await show(<Row lit="home" />);
		await show(<Row lit="space" />);
		assert.equal(box(), "80px 0px 120px 40px");
		assert.equal(marker().hasAttribute("data-slide"), true);
	});

	it("follows a lit tab that changes size at once", async () => {
		await show(<Row lit="home" />);
		await show(<Row lit="space" />);
		await show(<Row lit="space" wide />);
		assert.equal(box(), "80px 0px 200px 40px");
		assert.equal(marker().hasAttribute("data-slide"), false);
	});

	it("lets a slide go on when the row is measured again with nothing moved", async () => {
		await show(<Row lit="home" />);
		await show(<Row lit="space" />);
		await act(async () => resized.forEach((callback) => callback()));
		assert.equal(marker().hasAttribute("data-slide"), true);
	});

	it("is placed in the row's own pixels while a box around the row scales it", async () => {
		// The pinch magnifier at 2x: the row is laid out 300 wide and shows 600 wide.
		const view = dom.window as unknown as { getComputedStyle?: (el: Element) => { width: string } };
		view.getComputedStyle = (el) => ({ width: el.matches("nav") ? "300px" : "" });
		try {
			await show(<Row lit="space" />);
			assert.equal(box(), "40px 0px 60px 20px");
		} finally {
			delete view.getComputedStyle;
		}
	});

	it("is hidden while nothing is lit, and does not slide in from nowhere", async () => {
		await show(<Row lit={null} />);
		assert.equal(marker().hidden, true);
		await show(<Row lit="space" />);
		assert.equal(marker().hidden, false);
		assert.equal(marker().hasAttribute("data-slide"), false);
	});
});
