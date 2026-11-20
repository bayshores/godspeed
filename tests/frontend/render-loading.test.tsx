/**
 * A wait while data is read has one live element, the spinner, and what
 * replaces a wait the learner saw steps in; what was there at once does not.
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
const { LoadingBox, LoadingLine, useWaited } = await import("../../src/frontend/components/loading.tsx");

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
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

function Page({ data }: { data: string | null }) {
	const waited = useWaited(data !== null);
	return data === null ? <LoadingBox data-testid="wait" className="h-24" /> : <div data-testid="page" className={waited ? "lh-set" : undefined} />;
}

describe("a wait while data is read", () => {
	it("is a box with one spinner that says Loading", async () => {
		await show(<LoadingBox data-testid="wait" className="h-24" />);
		const box = document.querySelector('[data-testid="wait"]')!;
		assert.match(box.className, /\bh-24\b/);
		const spinners = box.querySelectorAll('[data-testid="braille-spinner"]');
		assert.equal(spinners.length, 1);
		assert.equal(spinners[0]!.getAttribute("aria-label"), "Loading");
	});

	it("is a line with the spinner and its word, read out once", async () => {
		await show(<LoadingLine>Loading fonts…</LoadingLine>);
		const line = document.querySelector("p")!;
		assert.equal(line.textContent, "Loading fonts…");
		assert.equal(line.querySelector('[data-testid="braille-spinner"]')!.getAttribute("aria-label"), "Loading fonts…");
		assert.equal(line.querySelector("span")!.getAttribute("aria-hidden"), "true");
	});

	it("lets what replaces a seen wait step in", async () => {
		await show(<Page data={null} />);
		assert.ok(document.querySelector('[data-testid="wait"]'));
		await show(<Page data="read" />);
		assert.equal(document.querySelector('[data-testid="page"]')!.className, "lh-set");
	});

	it("never steps in what was there at first render", async () => {
		await show(<Page data="read" />);
		assert.equal(document.querySelector('[data-testid="page"]')!.className, "");
	});
});
