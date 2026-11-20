/**
 * When the strip's peek is out (peek-store.ts): after the pointer rested on
 * the strip, while the pointer or the keyboard is on the strip or the peek,
 * and put away by a press or by tuckPeek. Mounted over linkedom so the
 * hook reads the store as the strip does.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
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

const { createRoot } = await import("react-dom/client");
const { REST_MS, TUCK_MS, peekKeyboard, peekPointer, stripPointer, stripPressed, tuckPeek, usePeekOut } = await import("../../src/frontend/components/strip/peek-store.ts");

let root: Root | undefined;
let out = false;
function Probe() {
	out = usePeekOut();
	return null;
}

beforeEach(async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(<Probe />));
});
afterEach(async () => {
	// The store is module state: every input off, the peek away.
	await act(async () => {
		stripPointer(false);
		peekPointer(false);
		peekKeyboard(false);
		tuckPeek();
	});
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
	mock.timers.reset();
});

const run = (fn: () => void) => act(async () => fn());
const tick = (ms: number) => act(async () => mock.timers.tick(ms));

describe("the peek comes out", () => {
	it("only after the pointer rested on the strip", async () => {
		await run(() => stripPointer(true));
		await tick(REST_MS - 1);
		assert.equal(out, false);
		await tick(1);
		assert.equal(out, true);
	});

	it("not for a crossing shorter than that", async () => {
		await run(() => stripPointer(true));
		await tick(REST_MS - 100);
		await run(() => stripPointer(false));
		await tick(10 * REST_MS);
		assert.equal(out, false);
	});

	it("at once while the keyboard is on it", async () => {
		await run(() => peekKeyboard(true));
		assert.equal(out, true);
	});
});

describe("the peek stays", () => {
	async function outByPointer() {
		await run(() => stripPointer(true));
		await tick(REST_MS);
		assert.equal(out, true);
	}

	it("while the pointer is on the strip", async () => {
		await outByPointer();
		await tick(10 * TUCK_MS);
		assert.equal(out, true);
	});

	it("while the pointer is on the peek, also after it left the strip", async () => {
		await outByPointer();
		await run(() => stripPointer(false));
		await run(() => peekPointer(true));
		await tick(10 * TUCK_MS);
		assert.equal(out, true);
	});

	it("through the crossing from the strip to the peek", async () => {
		await outByPointer();
		await run(() => stripPointer(false));
		await tick(TUCK_MS - 1);
		assert.equal(out, true);
		await run(() => peekPointer(true));
		await tick(10 * TUCK_MS);
		assert.equal(out, true);
	});
});

describe("the peek tucks away", () => {
	it("TUCK_MS after the pointer left both the strip and the peek", async () => {
		await run(() => stripPointer(true));
		await tick(REST_MS);
		await run(() => peekPointer(true));
		await run(() => stripPointer(false));
		await run(() => peekPointer(false));
		await tick(TUCK_MS - 1);
		assert.equal(out, true);
		await tick(1);
		assert.equal(out, false);
	});

	it("TUCK_MS after the keyboard left", async () => {
		await run(() => peekKeyboard(true));
		await run(() => peekKeyboard(false));
		await tick(TUCK_MS - 1);
		assert.equal(out, true);
		await tick(1);
		assert.equal(out, false);
	});

	it("at once with tuckPeek, a keyboard that was on it too", async () => {
		await run(() => peekKeyboard(true));
		await run(() => tuckPeek());
		assert.equal(out, false);
		await run(() => stripPointer(true));
		await tick(REST_MS);
		assert.equal(out, true);
		await run(() => tuckPeek());
		assert.equal(out, false);
	});

	it("at once with a press on the strip, and stays away until the pointer left it and came back", async () => {
		await run(() => stripPointer(true));
		await tick(REST_MS);
		await run(() => stripPressed());
		assert.equal(out, false);
		await tick(10 * REST_MS);
		assert.equal(out, false, "the pointer is still on the strip");
		await run(() => peekPointer(false));
		await tick(10 * REST_MS);
		assert.equal(out, false, "other pointer events do not bring it back");

		await run(() => stripPointer(false));
		await run(() => stripPointer(true));
		await tick(REST_MS - 1);
		assert.equal(out, false);
		await tick(1);
		assert.equal(out, true, "the pointer rested again");
	});
});
