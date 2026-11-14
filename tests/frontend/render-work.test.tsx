/**
 * Background work on a space, on screen: the work frame around a space's
 * pages (reading, done, Close). Today's line is in render-home-page.test.tsx.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceFile, SpaceFileStatus, SpaceRecord, SpaceSummary } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { SpaceWorkFrame } = await import("../../src/frontend/components/work/space-work-frame.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { MemoryRouter } = await import("react-router");

const summary = (id: string, name: string, over: Partial<SpaceSummary> = {}): SpaceSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", closed: false, fileCount: 3, color: 1, filesLeft: 0, ...over });
const SPACES = [summary("spc_ml", "Machine Learning", { filesLeft: 2, building: true }), summary("spc_bio", "Biology")];

const file = (id: string, status: SpaceFileStatus): SpaceFile => ({ id, origin: "copied", name: `${id}.pdf`, path: `${id}.pdf`, kind: "study", contentFp: "", status, addedAt: "" });
const record = (over: Partial<SpaceRecord>): SpaceRecord => ({ id: "spc_ml", name: "Machine Learning", description: "", createdAt: "", updatedAt: "", closed: false, files: [], color: 1, ...over });

let root: Root | null = null;
const requests: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	requests.length = 0;
	globalThis.fetch = originalFetch;
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

async function mount(node: React.ReactNode, space: SpaceRecord | null = null) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		requests.push(`${init?.method ?? "GET"} ${url}`);
		if (url === "/api/spaces") return Response.json({ spaces: SPACES });
		if (url === "/api/spaces/spc_ml") return Response.json({ space, folder: null });
		return Response.json({ ok: true });
	}) as typeof fetch;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<MemoryRouter initialEntries={["/"]}>
				<ServerEventsProvider connect={quietEvents as never}>
					<SpaceProvider initialActive="spc_ml" initialSpaces={SPACES}>
						{node}
					</SpaceProvider>
				</ServerEventsProvider>
			</MemoryRouter>,
		);
	});
	await settle();
	return host;
}

const text = (host: HTMLElement, testid: string) => host.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;
const click = (host: HTMLElement, testid: string) => act(async () => host.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click());

describe("The work frame around a space's pages", () => {
	const page = <SpaceWorkFrame><p data-testid="page">The page</p></SpaceWorkFrame>;

	it("no frame when nothing is going on, and the page is there", async () => {
		const host = await mount(page, record({ files: [file("a", "ready")] }));
		assert.ok(host.querySelector('[data-testid="work-frame"]') === null);
		assert.equal(text(host, "page"), "The page");
	});

	it("files being read: the striped frame and its tag, with the page still inside", async () => {
		const files = [file("a", "ready"), file("week2", "extracting"), file("c", "pending")];
		const host = await mount(page, record({ files, lastWork: { startedAt: "x", fileIds: ["a"], deadlineIds: [] } }));
		assert.equal(host.querySelector('[data-testid="work-frame"]')?.getAttribute("data-state"), "working");
		assert.equal(text(host, "work-frame-tag"), "Teacher is working on this page1 of 3 files");
		assert.equal(text(host, "page"), "The page");
		assert.ok(host.querySelector('[data-testid="work-frame-close"]') === null);
	});

	it("done: what the round read, and Close takes the frame off", async () => {
		const lastWork = { startedAt: "x", endedAt: new Date().toISOString(), fileIds: ["a"], deadlineIds: [] };
		const host = await mount(page, record({ files: [file("old", "ready"), file("a", "ready")], lastWork }));
		assert.equal(host.querySelector('[data-testid="work-frame"]')?.getAttribute("data-state"), "done");
		assert.match(text(host, "work-frame-tag")!, /^Your agent read 1 file\./);
		await click(host, "work-frame-close");
		assert.ok(host.querySelector('[data-testid="work-frame"]') === null);
		assert.equal(text(host, "page"), "The page");
		assert.ok(requests.includes("DELETE /api/spaces/spc_ml/work"));
	});

	const sides = (host: HTMLElement) => host.querySelector('[data-testid="work-frame-sides"]')!.className;

	it("the frame is as wide as the page's column", async () => {
		assert.match(sides(await mount(page, record({ files: [file("week2", "extracting")] }))), /max-w-\[908px\]/);
	});

	it("and wider around the Graph page", async () => {
		const wide = <SpaceWorkFrame wide><p>The graph</p></SpaceWorkFrame>;
		assert.match(sides(await mount(wide, record({ files: [file("week2", "extracting")] }))), /max-w-\[1240px\]/);
	});
});
