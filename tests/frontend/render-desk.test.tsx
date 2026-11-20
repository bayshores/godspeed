/**
 * The desk: when the page changes, a still copy of the old page leaves
 * while the new one arrives, and is gone once they have stopped.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { Place } from "../../src/frontend/components/desk/desk-model.ts";

const dom = parseHTML("<html><body></body></html>");
/** The system's reduced motion setting, as the app reads it. */
const reduced = { matches: false };
(dom.window as unknown as { matchMedia: () => typeof reduced }).matchMedia = () => reduced;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { Desk } = await import("../../src/frontend/components/desk/desk.tsx");

/** The travel of a page, ended by the test: the browser's own animation stands in for none here. */
let moving: { end: () => void }[] = [];
const proto = dom.window.Element.prototype as unknown as { getAnimations?: () => { finished: Promise<void> }[] };
function motionOn() {
	proto.getAnimations = function (this: Element) {
		if (!this.matches(".lh-desk[data-way] > *")) return [];
		let end = () => {};
		const finished = new Promise<void>((done) => (end = done));
		moving.push({ end });
		return [{ finished }];
	};
}
const stop = () =>
	act(async () => {
		for (const m of moving) m.end();
		moving = [];
	});

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	moving = [];
	reduced.matches = false;
	delete proto.getAnimations;
	document.body.innerHTML = "";
});

const at = (key: string, column = 0, depth = 0): Place => ({ key, column, depth });
async function show(node: React.ReactNode) {
	if (!root) {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	}
	await act(async () => root!.render(node));
}
const desk = () => document.querySelector<HTMLElement>(".lh-desk")!;
const page = () => desk().children[0] as HTMLElement;
const old = () => desk().children[1] as HTMLElement;

describe("the desk", () => {
	it("shows a page with nothing traveling", async () => {
		motionOn();
		await show(<Desk place={at("/")}>Home</Desk>);
		assert.equal(desk().getAttribute("data-way"), null);
		assert.equal(old().childNodes.length, 0);
		assert.equal(page().textContent, "Home");
		assert.ok(old().hasAttribute("inert"), "the copy is never used");
		assert.equal(old().getAttribute("aria-hidden"), "true");
	});

	it("sends a copy of the old page away while the new one arrives, then clears it", async () => {
		motionOn();
		await show(
			<Desk place={at("/")}>
				<p id="home">Home</p>
			</Desk>,
		);
		await show(
			<Desk place={at("space a", 1)}>
				<p>Progress</p>
			</Desk>,
		);
		assert.equal(desk().getAttribute("data-way"), "right");
		assert.equal(old().textContent, "Home", "the old page, as it was");
		assert.equal(page().textContent, "Progress");
		assert.ok(old().firstElementChild!.classList.contains("lh-desk-page"), "the copy is the whole page");
		await stop();
		assert.equal(desk().getAttribute("data-way"), null);
		assert.equal(old().childNodes.length, 0);
		assert.equal(page().textContent, "Progress");
	});

	it("lays a deeper page on top and takes it off again", async () => {
		motionOn();
		await show(<Desk place={at("space a", 1)}>Progress</Desk>);
		await show(<Desk place={at("/chat/c1", 1, 2)}>Lesson</Desk>);
		assert.equal(desk().getAttribute("data-way"), "up");
		await stop();
		await show(<Desk place={at("space a", 1)}>Progress</Desk>);
		assert.equal(desk().getAttribute("data-way"), "down");
		assert.equal(old().textContent, "Lesson");
	});

	it("does not travel while the page stays the same one", async () => {
		motionOn();
		await show(<Desk place={at("/")}>Home</Desk>);
		await show(<Desk place={at("/")}>Home, redrawn</Desk>);
		assert.equal(desk().getAttribute("data-way"), null);
		assert.equal(old().childNodes.length, 0);
	});

	it("starts a second travel from the page as it stands", async () => {
		motionOn();
		await show(<Desk place={at("/")}>Home</Desk>);
		await show(<Desk place={at("space a", 1)}>Progress</Desk>);
		const first = [...moving];
		await show(<Desk place={at("/settings", 3)}>Settings</Desk>);
		assert.equal(old().textContent, "Progress");
		assert.equal(desk().getAttribute("data-way"), "right");
		// The first travel ending late clears nothing of the second.
		await act(async () => first.forEach((m) => m.end()));
		assert.equal(old().textContent, "Progress");
	});

	it("keeps a page inside a traveling page still", async () => {
		motionOn();
		const pages = (outer: Place, inner: Place, text: string) => (
			<Desk place={outer}>
				<Desk place={inner}>{text}</Desk>
			</Desk>
		);
		await show(pages(at("space a", 1), at("/space/files", 1), "Files of a"));
		await show(pages(at("space b", 2), at("/space/files", 1), "Files of b"));
		await show(pages(at("space b", 2), at("/space", 0), "Progress of b"));
		const inner = document.querySelector<HTMLElement>(".lh-desk-page > .lh-desk")!;
		assert.equal(inner.getAttribute("data-way"), null);
		assert.equal(desk().getAttribute("data-way"), "right");
		assert.equal(old().textContent, "Files of a");
	});

	it("just shows the new page with reduced motion, and makes no copy", async () => {
		motionOn();
		reduced.matches = true;
		await show(<Desk place={at("/")}>Home</Desk>);
		await show(<Desk place={at("space a", 1)}>Progress</Desk>);
		assert.equal(desk().getAttribute("data-way"), null);
		assert.equal(old().childNodes.length, 0);
		assert.equal(moving.length, 0);
		assert.equal(page().textContent, "Progress");
	});

	it("just shows the new page where nothing can move", async () => {
		await show(<Desk place={at("/")}>Home</Desk>);
		await show(<Desk place={at("space a", 1)}>Progress</Desk>);
		assert.equal(desk().getAttribute("data-way"), null);
		assert.equal(old().childNodes.length, 0);
		assert.equal(page().textContent, "Progress");
	});

	it("copies a page without its frames' pages, and without a travel caught inside it", async () => {
		motionOn();
		await show(
			<Desk place={at("space a", 1)}>
				<iframe src="/plugin" title="plugin" />
				<Desk place={at("/space", 0)}>Progress</Desk>
			</Desk>,
		);
		await show(
			<Desk place={at("space a", 1)}>
				<iframe src="/plugin" title="plugin" />
				<Desk place={at("/space/files", 1)}>Files</Desk>
			</Desk>,
		);
		assert.equal(document.querySelector(".lh-desk-page > .lh-desk")!.getAttribute("data-way"), "right");
		await show(
			<Desk place={at("/", 0)}>
				<p>Home</p>
			</Desk>,
		);
		const copy = old().firstElementChild!;
		assert.equal(copy.querySelector("iframe")!.getAttribute("src"), null);
		assert.equal(copy.querySelector(".lh-desk")!.getAttribute("data-way"), null);
		assert.equal(copy.querySelector(".lh-desk-old")!.childNodes.length, 0);
		assert.equal(copy.textContent, "Files");
	});
});
