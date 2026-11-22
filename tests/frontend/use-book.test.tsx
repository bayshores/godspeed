/**
 * The lesson's book (useBook): it opens and shuts only once a reply has landed in the text, the
 * right page keeps its task while it leaves, and the book is "turning" until the pages rest.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useBook } from "../../src/frontend/components/lesson/use-book.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

type Props = { opens: boolean; held: string | null; busy: boolean; deskUp: boolean };

/** Mounts the book and gives its state as last rendered, and a way to render it anew. */
async function book(first: Props) {
	let now!: ReturnType<typeof useBook<string>>;
	function Probe(props: Props) {
		now = useBook(props.opens, props.held, props.busy, props.deskUp);
		return null;
	}
	const host = document.createElement("div");
	const root = createRoot(host);
	const render = (props: Props) => act(async () => root.render(<Probe {...props} />));
	await render(first);
	return { state: () => now, render, call: (what: "shut" | "rest") => act(async () => now[what]()) };
}

describe("useBook", () => {
	it("a lesson that opens with something to work on is open and at rest", async () => {
		const b = await book({ opens: true, held: "task", busy: false, deskUp: false });
		assert.deepEqual({ open: b.state().open, turning: b.state().turning, shutting: b.state().shutting }, { open: true, turning: false, shutting: false });
	});

	it("opens when the reply has landed, not while the teacher works, and turns until the pages rest", async () => {
		const b = await book({ opens: false, held: null, busy: true, deskUp: false });
		await b.render({ opens: true, held: "task", busy: true, deskUp: false });
		assert.equal(b.state().open, false, "the task streamed in while the teacher still worked");
		assert.equal(b.state().turning, false);
		await b.render({ opens: true, held: "task", busy: false, deskUp: false });
		assert.equal(b.state().open, true);
		assert.equal(b.state().turning, true, "the reply waits for the pages to print");
		await b.call("rest");
		assert.equal(b.state().turning, false);
	});

	it("waits for the desk to leave the text, with the reply held from printing", async () => {
		const b = await book({ opens: false, held: null, busy: true, deskUp: true });
		await b.render({ opens: true, held: "task", busy: false, deskUp: true });
		assert.equal(b.state().open, false);
		assert.equal(b.state().turning, true);
		await b.render({ opens: true, held: "task", busy: false, deskUp: false });
		assert.equal(b.state().open, true);
	});

	it("shutting, the right page keeps its task until the page says it is gone", async () => {
		const b = await book({ opens: true, held: "task", busy: false, deskUp: false });
		await b.render({ opens: false, held: null, busy: true, deskUp: false });
		assert.deepEqual({ open: b.state().open, shutting: b.state().shutting, held: b.state().held }, { open: true, shutting: false, held: null });
		await b.render({ opens: true, held: "task", busy: true, deskUp: false });
		await b.render({ opens: false, held: null, busy: false, deskUp: false });
		assert.deepEqual({ open: b.state().open, shutting: b.state().shutting, held: b.state().held, turning: b.state().turning }, { open: true, shutting: true, held: "task", turning: true });
		await b.call("shut");
		assert.deepEqual({ open: b.state().open, shutting: b.state().shutting, held: b.state().held, turning: b.state().turning }, { open: false, shutting: false, held: null, turning: true });
		await b.call("rest");
		assert.equal(b.state().turning, false);
	});

	it("a task that arrives while the kept one leaves keeps the book open", async () => {
		const b = await book({ opens: true, held: "first", busy: false, deskUp: false });
		await b.render({ opens: false, held: null, busy: false, deskUp: false });
		assert.equal(b.state().shutting, true);
		await b.call("shut");
		assert.equal(b.state().open, false);
		await b.render({ opens: true, held: "second", busy: false, deskUp: false });
		assert.deepEqual({ open: b.state().open, shutting: b.state().shutting, held: b.state().held }, { open: true, shutting: false, held: "second" });
	});
});
