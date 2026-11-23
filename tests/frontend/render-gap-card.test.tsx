/**
 * The gap card over linkedom with a fake fetch: its words come from the server, "Update" hands the
 * teacher the space's update line (only where the teacher can be asked), the quiet key waves the
 * gap off, and "Is it over?" has "Close space" instead of "Update".
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceGap } from "../../src/shared/core/index.ts";
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;
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
const { MemoryRouter } = await import("react-router");
const { GapCard } = await import("../../src/frontend/components/gap-card.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { OpenDeadlinesProvider } = await import("../../src/frontend/components/use-open-deadlines.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");

const gap: SpaceGap = { spaceId: "spc_21", key: "spc_21:ddl_hw6:recent", title: "Nothing coming up in CSE 21", line: "HW6 was the last, 3 days ago.", answer: "Nothing new", close: false };
const calls: { method: string; url: string; body?: unknown }[] = [];
const originalFetch = globalThis.fetch;

let root: Root | undefined;
async function mount(shown: SpaceGap, canAsk: boolean, asked: string[] = [], updated: string[] = []) {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method !== "GET") calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
		if (url === "/api/spaces") return Response.json({ spaces: [{ id: "spc_21", name: "CSE 21", color: 2 }] });
		if (url.startsWith("/api/deadlines")) return Response.json({ deadlines: [], doneToday: [], gaps: [] });
		return Response.json({ ok: true });
	}) as typeof fetch;
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const teacher = { name: "Claude", canAsk, ask: (line: string) => asked.push(line) } as unknown as TeacherApi;
	await act(async () => {
		root!.render(
			<MemoryRouter initialEntries={["/space/files"]}>
				<ServerEventsProvider connect={connect as never}>
					<SpaceProvider initialActive="spc_21">
						<OpenDeadlinesProvider>
							<TeacherContext.Provider value={teacher}>
								<GapCard gap={shown} onUpdate={() => updated.push(shown.key)} />
							</TeacherContext.Provider>
						</OpenDeadlinesProvider>
					</SpaceProvider>
				</ServerEventsProvider>
			</MemoryRouter>,
		);
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 30));
	});
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
	root = undefined;
	calls.length = 0;
	globalThis.fetch = originalFetch;
});

describe("The gap card", () => {
	it("says what the server sent and nothing else", async () => {
		await mount(gap, true);
		assert.match(q("gap-notice")!.textContent!, /Nothing coming up in CSE 21/);
		assert.match(q("gap-notice")!.textContent!, /HW6 was the last, 3 days ago\./);
		assert.equal(q("gap-notice-update")!.textContent, "Update");
		assert.equal(q("gap-notice-answer")!.textContent, "Nothing new");
	});

	it("Update hands the teacher the space's line and the card leaves", async () => {
		const asked: string[] = [];
		const updated: string[] = [];
		await mount(gap, true, asked, updated);
		await act(async () => q("gap-notice-update")!.click());
		assert.deepEqual(asked, ["Update CSE 21"]);
		assert.deepEqual(updated, [gap.key]);
	});

	it("has no Update key where the teacher cannot be asked", async () => {
		await mount(gap, false);
		assert.equal(q("gap-notice-update"), null);
		assert.ok(q("gap-notice-answer"));
	});

	it("the quiet key sends the gap's key, so it is asked once", async () => {
		await mount(gap, true);
		await act(async () => q("gap-notice-answer")!.click());
		assert.deepEqual(calls, [{ method: "POST", url: "/api/deadlines/spc_21/nothing-new", body: { key: gap.key } }]);
	});

	it("Is it over? offers Close space, which closes the space", async () => {
		await mount({ ...gap, title: "Is CSE 21 over?", close: true, answer: "Still going" }, true);
		assert.equal(q("gap-notice-update"), null);
		assert.equal(q("gap-notice-close-space")!.textContent, "Close space");
		await act(async () => {
			q("gap-notice-close-space")!.click();
			await new Promise((r) => setTimeout(r, 30));
		});
		assert.deepEqual(calls.filter((c) => c.method === "PUT"), [{ method: "PUT", url: "/api/spaces/spc_21", body: { closed: true } }]);
	});
});
