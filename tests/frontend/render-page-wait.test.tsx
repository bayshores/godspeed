/**
 * A click that opens a page read first is answered at once: the links that lead there stay
 * pressed while it is read, and a read that outlasts --lh-dur-slow shows the bar's spinner.
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
const { createMemoryRouter, Link, Outlet, RouterProvider } = await import("react-router");
const { PageWait } = await import("../../src/frontend/components/top-bar/page-wait.tsx");
const { SLOW_MS } = await import("../../src/frontend/components/presence.ts");

/** The lesson's loader, held until the test lets it finish. */
let finish = () => {};
let root: Root | null = null;
let router: ReturnType<typeof createMemoryRouter> | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	router = null;
	document.body.innerHTML = "";
});

async function mount() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	router = createMemoryRouter(
		[
			{
				element: (
					<>
						<span data-testid="slot">
							<PageWait />
						</span>
						<Outlet />
					</>
				),
				children: [
					{
						path: "/space",
						element: (
							<>
								<Link to="/chat/c1" data-testid="row" className="lh-press">
									Counting
								</Link>
								<Link to="/chat/c1#m-1" data-testid="question">
									A question in it
								</Link>
								<Link to="/space/files" data-testid="files">
									Files
								</Link>
							</>
						),
					},
					{ path: "/space/files", element: <span data-testid="files-page" /> },
					{
						path: "/chat/:id",
						loader: () => new Promise<null>((done) => (finish = () => done(null))),
						HydrateFallback: () => null,
						element: <span data-testid="lesson" />,
					},
				],
			},
		],
		{ initialEntries: ["/space"] },
	);
	await act(async () => root!.render(<RouterProvider router={router!} />));
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const go = (to: string) => act(async () => void router!.navigate(to));
const wait = (ms: number) => act(() => new Promise((done) => setTimeout(done, ms)));
const spinner = () => q("slot")!.querySelector("[data-testid='braille-spinner']");

describe("a click that opens a page read first", () => {
	it("keeps every link to that page pressed until the page shows", async () => {
		await mount();
		await go("/chat/c1");
		assert.equal(q("row")!.hasAttribute("data-pending"), true);
		assert.equal(q("question")!.hasAttribute("data-pending"), true, "a link to a place in the page leads there too");
		assert.equal(q("files")!.hasAttribute("data-pending"), false);
		await act(async () => finish());
		assert.ok(q("lesson"), "the lesson shows");
	});

	it("lets go when the read is called off and the page stays", async () => {
		await mount();
		await go("/chat/c1");
		await go("/space");
		assert.equal(q("row")!.hasAttribute("data-pending"), false);
		assert.equal(spinner(), null);
	});

	it("shows no wait for a quick read", async () => {
		await mount();
		await go("/chat/c1");
		await wait(SLOW_MS / 2);
		assert.equal(spinner(), null);
		await act(async () => finish());
		await wait(SLOW_MS);
		assert.equal(spinner(), null, "never drawn");
	});

	it("shows the spinner once the read outlasts --lh-dur-slow, and lets it go as the page shows", async () => {
		await mount();
		await go("/chat/c1");
		await wait(SLOW_MS + 40);
		assert.ok(spinner(), "the wait shows");
		assert.equal(spinner()!.parentElement!.getAttribute("data-state"), "open");
		await act(async () => finish());
		assert.equal(spinner()?.parentElement?.getAttribute("data-state"), "closed", "it fades out as the page arrives");
		await wait(SLOW_MS);
		assert.equal(spinner(), null);
	});

	it("holds nothing for a page with no read", async () => {
		await mount();
		await go("/space/files");
		assert.ok(q("files-page"));
		assert.equal(spinner(), null);
	});
});
