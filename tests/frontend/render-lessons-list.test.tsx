/**
 * The Lessons tab: the space's own lessons under "Study something new" and
 * the search field. When the server says no, a list that can't be read
 * shows "Try again" (not "No lessons yet."), and a rename that fails keeps
 * the old title and says so under the row.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ChatListItem } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
// linkedom's document has no "oninput"; without it React would watch text
// fields an old-IE way.
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	// next/link schedules its prefetch with self.requestIdleCallback.
	self: globalThis,
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
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
// linkedom's input has no select(); the rename field calls it on mount.
(dom.window.HTMLElement.prototype as unknown as { select: () => void }).select = () => {};

const { LessonsList } = await import("../../src/frontend/components/lessons/lessons-list.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");

const LESSON: ChatListItem = {
	id: "c1",
	title: "Induction",
	kind: "teach",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
	messageCount: 4,
	phase: "probe",
	pendingQuestion: false,
	pendingProblem: false,
	busy: false,
};

let root: Root | null = null;
const originalFetch = globalThis.fetch;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	globalThis.fetch = originalFetch;
});

/** Mounts the tab in a space (none by default); `respond` answers every request. */
async function mount(respond: (url: string, init?: RequestInit) => Response, active: string | null = null) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => respond(url, init)) as typeof fetch;
	const router = { push: () => {} } as unknown as React.ContextType<typeof AppRouterContext>;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<AppRouterContext.Provider value={router}>
				<ServerEventsProvider connect={quietEvents as never}>
					<SpaceProvider initialActive={active} initialSpaces={[]}>
						<LessonsList />
					</SpaceProvider>
				</ServerEventsProvider>
			</AppRouterContext.Provider>,
		);
	});
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

it("a lesson list that can't be read says so, and Try again reads it again", async () => {
	let ok = false;
	await mount(() => (ok ? Response.json({ chats: [LESSON] }) : Response.json({ error: "boom" }, { status: 500 })));
	assert.match(q("load-failed")!.textContent!, /Couldn't load your lessons\./);
	assert.doesNotMatch(document.body.textContent!, /No lessons yet/);
	ok = true;
	await act(async () => q("load-failed-retry")!.click());
	assert.equal(q("load-failed"), null);
	assert.match(q("session-row")!.textContent!, /Induction/);
});

it("a rename that fails keeps the old title and says so under the row", async () => {
	await mount((url, init) => {
		if (url === "/api/chats" && !init?.method) return Response.json({ chats: [LESSON] });
		if (init?.method === "PUT") return Response.json({ error: "boom" }, { status: 500 });
		return Response.json({});
	});
	await act(async () => q("session-row-menu")!.click());
	await act(async () => q("ctx-rename")!.click());
	const input = q("session-rename-input") as HTMLInputElement;
	await act(async () => {
		Object.defineProperty(input, "value", { configurable: true, writable: true, value: "Strong induction" });
		input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await act(async () => input.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })));
	assert.match(q("session-row")!.textContent!, /Induction/);
	assert.doesNotMatch(q("session-row")!.textContent!, /Strong/);
	assert.equal(q("session-rename-failed")!.textContent, "Couldn't rename the lesson.");
	// Renaming again clears it.
	await act(async () => q("session-row-menu")!.click());
	await act(async () => q("ctx-rename")!.click());
	assert.equal(q("session-rename-failed"), null);
});

it("lists only the window's space's lessons, under Study something new", async () => {
	const lessons = [LESSON, { ...LESSON, id: "c2", title: "Pointers", spaceId: "c29" }];
	await mount(() => Response.json({ chats: lessons }), "c29");
	assert.equal(q("new-session")!.textContent, "Study something new");
	assert.equal(q("new-session")!.getAttribute("href"), "/new");
	const rows = [...document.querySelectorAll("[data-testid='session-row']")].map((r) => r.textContent);
	assert.equal(rows.length, 1);
	assert.match(rows[0]!, /Pointers/);
});

it("with no space, lists the lessons that belong to none", async () => {
	const lessons = [LESSON, { ...LESSON, id: "c2", title: "Pointers", spaceId: "c29" }];
	await mount(() => Response.json({ chats: lessons }));
	const rows = [...document.querySelectorAll("[data-testid='session-row']")].map((r) => r.textContent);
	assert.equal(rows.length, 1);
	assert.match(rows[0]!, /Induction/);
});
