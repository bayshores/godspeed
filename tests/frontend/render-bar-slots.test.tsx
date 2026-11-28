/**
 * A page's own place in the top bar: its words on the bar's right, and its
 * crumb joining the lit tab (or the lit +), drawn only while a page fills it.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceSummary } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;
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
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
});

const { createRoot } = await import("react-dom/client");
const { AppBar } = await import("../../src/frontend/components/app-bar.tsx");
const { BarSlotsProvider, BarActions, BarCrumb } = await import("../../src/frontend/components/top-bar/bar-slots.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { createMemoryRouter, RouterProvider } = await import("react-router");

const space = (id: string, name: string): SpaceSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", closed: false, fileCount: 3, color: 1, filesLeft: 0 });
const SPACES = [space("c21", "CSE 21"), space("c29", "CSE 29")];

let root: Root | null = null;
const originalFetch = globalThis.fetch;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	globalThis.fetch = originalFetch;
});

/** A page's words, as a lesson puts them in the bar. */
function Page({ crumb = true, actions = true }: { crumb?: boolean; actions?: boolean }) {
	return (
		<>
			{crumb && (
				<BarCrumb>
					<button type="button" data-testid="page-title">
						Work on HW6
					</button>
				</BarCrumb>
			)}
			{actions && (
				<BarActions>
					<button type="button" data-testid="page-word">
						Cheat sheet
					</button>
				</BarActions>
			)}
		</>
	);
}

async function mount(page: React.ReactNode, { pathname = "/chat/ses_1", active = "c21" as string | null, slots = true } = {}) {
	globalThis.fetch = (async () => Response.json({ spaces: SPACES, chats: [] })) as typeof fetch;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	const frame = (
		<>
			<AppBar />
			<main>{page}</main>
		</>
	);
	// A data router, as in the app: the bar reads the page being read from it.
	const router = createMemoryRouter(
		[
			{
				path: "*",
				element: (
					<ServerEventsProvider connect={quietEvents as never}>
						<SpaceProvider initialActive={active} initialSpaces={SPACES}>
							{slots ? <BarSlotsProvider>{frame}</BarSlotsProvider> : frame}
						</SpaceProvider>
					</ServerEventsProvider>
				),
			},
		],
		{ initialEntries: [pathname] },
	);
	await act(async () => {
		root!.render(<RouterProvider router={router} />);
	});
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

describe("a page's words in the top bar", () => {
	it("appear on the bar's right, before Menu", async () => {
		await mount(<Page />);
		const word = q("page-word")!;
		assert.ok(word.closest("[data-testid='app-bar']"), "in the bar");
		assert.equal(word.parentElement?.getAttribute("data-testid"), "bar-actions");
		assert.ok(!document.querySelector("main [data-testid='page-word']"), "not on the page");
		const bar = [...q("app-bar")!.querySelectorAll("[data-testid]")].map((el) => el.getAttribute("data-testid"));
		assert.ok(bar.indexOf("bar-actions") > bar.indexOf("space-tabs") && bar.indexOf("bar-actions") < bar.indexOf("app-menu"));
	});

	it("render nothing with no host to go into", async () => {
		await mount(<Page />, { slots: false });
		assert.ok(q("page-word") === null);
		assert.ok(q("page-title") === null);
	});

	it("leave the bar empty on a page with none", async () => {
		await mount(<Page crumb={false} actions={false} />);
		assert.equal(q("bar-actions")!.children.length, 0);
		assert.equal(q("bar-crumb")!.children.length, 0);
	});
});

describe("a page's crumb", () => {
	it("joins the lit space tab after a ›, still a link to the space", async () => {
		await mount(<Page />);
		const tab = q("space-option-c21")!;
		const group = tab.parentElement!;
		assert.ok(group.hasAttribute("data-lit"), "the lit tab and its crumb are one group");
		assert.equal(tab.getAttribute("aria-current"), "page");
		assert.equal(tab.getAttribute("href"), "/space");
		assert.ok(group.contains(q("page-title")), "the page's title sits in the lit group");
		const crumb = q("bar-crumb")!;
		assert.equal(crumb.firstElementChild!.textContent, "›");
		assert.equal(crumb.firstElementChild!.getAttribute("aria-hidden"), "true");
		assert.equal(crumb.textContent, "›Work on HW6");
		assert.ok(!q("space-option-c29")!.parentElement!.hasAttribute("data-lit"), "an unlit tab has no group");
	});

	it("follows the lit + for a lesson with no space", async () => {
		await mount(<Page />, { active: null });
		const crumb = q("bar-crumb")!;
		assert.ok(crumb.previousElementSibling === q("spaces-plus"), "right after the +");
		assert.ok(crumb.contains(q("page-title")));
	});

	it("has no › without a page's crumb", async () => {
		await mount(<Page crumb={false} />);
		assert.ok(!q("bar-crumb")!.textContent!.includes("›"));
	});

	it("is not drawn while no tab is lit", async () => {
		await mount(<Page />, { pathname: "/" });
		assert.ok(q("bar-crumb") === null);
		assert.ok(q("page-title") === null);
		assert.ok(q("page-word"), "the page's words still show");
	});
});
