/**
 * The space's Deadlines tab over linkedom with a fake fetch: "Coming up"
 * and "Done or past", each row's block and button, "Mark done" and "Undo",
 * and "Add a deadline".
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { localDay, type SpaceDeadline, type SpaceRecord } from "../../src/shared/core/index.ts";

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
const { DeadlinesTab } = await import("../../src/frontend/components/space-page/deadlines-tab.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { OpenDeadlinesProvider } = await import("../../src/frontend/components/use-open-deadlines.tsx");

const DAY = 86_400_000;
const day = (offset: number) => localDay(Date.now() + offset * DAY);
function d(id: string, kind: SpaceDeadline["kind"], offset: number, done = false): SpaceDeadline {
	return { id, kind, name: id, date: day(offset), fileIds: [], done };
}
const record = (deadlines: SpaceDeadline[]): SpaceRecord => ({ id: "cls_a", name: "CSE 21", description: "", color: 2, createdAt: "", updatedAt: "", archived: false, files: [], deadlines });

const calls: { method: string; url: string; body?: unknown }[] = [];
const originalFetch = globalThis.fetch;
let served = record([]);

let root: Root | undefined;
let host: HTMLElement | undefined;
async function mount(deadlines: SpaceDeadline[], active: string | null = "cls_a") {
	served = record(deadlines);
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method !== "GET") calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
		if (url === "/api/spaces") return Response.json({ spaces: [{ id: "cls_a", name: "CSE 21", color: 2 }] });
		if (url === "/api/spaces/cls_a") return Response.json({ space: served });
		if (url.startsWith("/api/deadlines")) return Response.json({ deadlines: [], doneToday: [] });
		return Response.json({ ok: true });
	}) as typeof fetch;
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
	await act(async () => {
		root!.render(
			<MemoryRouter initialEntries={["/space/deadlines"]}>
				<ServerEventsProvider connect={connect as never}>
					<SpaceProvider initialActive={active}>
						<OpenDeadlinesProvider>
							<DeadlinesTab />
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
const rows = () => [...document.querySelectorAll("[data-testid^='deadline-row-']")].map((el) => el.getAttribute("data-testid")!.replace("deadline-row-", ""));

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	document.body.innerHTML = "";
	root = undefined;
	host = undefined;
	calls.length = 0;
	globalThis.fetch = originalFetch;
});

describe("The Deadlines tab", () => {
	it("lists what is coming up soonest first, then done and missed ones latest first", async () => {
		await mount([d("final", "exam", 27), d("quiz3", "quiz", -13), d("hw6", "homework", 2), d("hw5", "homework", -5, true)]);
		assert.deepEqual(rows(), ["hw6", "final", "hw5", "quiz3"]);
		const text = q("deadlines-tab")!.textContent!;
		assert.ok(text.indexOf("Coming up") < text.indexOf("hw6") && text.indexOf("final") < text.indexOf("Done or past"));
		assert.match(q("deadline-row-hw6")!.textContent!, /2\s*days/);
		assert.match(q("deadline-row-hw6")!.textContent!, /Homework, due /);
		assert.match(q("deadline-row-hw5")!.textContent!, /Done/);
		assert.match(q("deadline-row-hw5")!.textContent!, /Undo/);
		assert.match(q("deadline-row-quiz3")!.textContent!, /was due/);
		assert.match(q("deadline-row-quiz3")!.textContent!, /Mark done/);
		assert.equal(q("deadline-row-final")!.querySelector("a")!.getAttribute("href"), "/space/deadline/final");
	});

	it("Mark done and Undo save at once", async () => {
		await mount([d("hw6", "homework", 2), d("hw5", "homework", -5, true)]);
		await act(async () => q("deadline-row-hw6")!.querySelector<HTMLElement>("[data-testid='deadline-done']")!.click());
		await act(async () => q("deadline-row-hw5")!.querySelector<HTMLElement>("[data-testid='deadline-undo']")!.click());
		assert.deepEqual(calls, [
			{ method: "PUT", url: "/api/spaces/cls_a/deadlines/hw6", body: { done: true } },
			{ method: "PUT", url: "/api/spaces/cls_a/deadlines/hw5", body: { done: false } },
		]);
	});

	it("with nothing coming up it says so, and has no Done or past without any", async () => {
		await mount([]);
		assert.equal(q("deadlines-none")!.textContent, "Nothing is coming up.");
		assert.doesNotMatch(q("deadlines-tab")!.textContent!, /Done or past/);
	});

	it("Add a deadline opens the dialog for a new one", async () => {
		await mount([]);
		await act(async () => q("deadline-add")!.click());
		assert.match(q("deadline-dialog")!.textContent!, /Add a deadline/);
		assert.equal(q("deadline-save")!.textContent, "Add deadline");
	});

	it("with no space picked it offers the spaces", async () => {
		await mount([], null);
		assert.match(q("pick-space")!.textContent!, /Pick a space to see its deadlines\./);
		assert.equal(q("deadlines-tab"), null);
	});
});
