/**
 * The frame: the top bar's Today and space tabs, Menu, the "Search
 * lessons" popup it opens, a space page's head with its tabs, and the
 * Archived spaces page.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ChatListItem, SpaceSummary } from "../../src/shared/core/index.ts";

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
// The search popup keeps its walked row in view.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

// After the DOM exists, so React hears "input" events.
const { createRoot } = await import("react-dom/client");
const { SpaceTabs } = await import("../../src/frontend/components/top-bar/space-tabs.tsx");
const { AppMenu } = await import("../../src/frontend/components/top-bar/app-menu.tsx");
const { SearchLessons } = await import("../../src/frontend/components/search-lessons.tsx");
const { SpaceHead } = await import("../../src/frontend/components/space-page/space-head.tsx");
const { ArchivedSpaces } = await import("../../src/frontend/components/archived-spaces.tsx");
const { hasUnseenFiles } = await import("../../src/frontend/components/files/files-seen.ts");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");

const space = (id: string, name: string, over: Partial<SpaceSummary> = {}): SpaceSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", archived: false, fileCount: 33, color: 1, filesLeft: 0, ...over });
const SPACES = [space("c29", "CSE 29", { description: "Systems programming" }), space("c21", "CSE 21", { color: 2, filesLeft: 2 }), space("old", "MATH 18", { archived: true, description: "Linear algebra.", fileCount: 1 })];

const lesson = (id: string, title: string, spaceId?: string): ChatListItem => ({
	id,
	title,
	kind: "teach",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-02T00:00:00.000Z",
	messageCount: 4,
	phase: "probe",
	pendingQuestion: false,
	pendingProblem: false,
	busy: false,
	...(spaceId && { spaceId }),
});
const LESSONS = [lesson("l1", "Pointers", "c29"), lesson("l2", "Induction", "c21"), lesson("l3", "Loose notes")];

let root: Root | null = null;
const pushed: string[] = [];
const requests: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	pushed.length = 0;
	requests.length = 0;
	globalThis.fetch = originalFetch;
});

async function mount(node: React.ReactNode, { pathname = "/", active = "c29" as string | null } = {}) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		requests.push(`${init?.method ?? "GET"} ${url}${typeof init?.body === "string" ? ` ${init.body}` : ""}`);
		if (url === "/api/spaces") return Response.json({ spaces: SPACES });
		if (url === "/api/chats") return Response.json({ chats: LESSONS });
		if (url === "/api/spaces/c29/cheat-sheets") return Response.json({ cards: [{ status: "made" }, { status: "making" }, { status: "none" }] });
		return Response.json({});
	}) as typeof fetch;
	const router = { push: (href: string) => pushed.push(href), prefetch: () => {} } as unknown as React.ContextType<typeof AppRouterContext>;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<AppRouterContext.Provider value={router}>
				<PathnameContext.Provider value={pathname}>
					<ServerEventsProvider connect={quietEvents as never}>
						<SpaceProvider initialActive={active} initialSpaces={SPACES}>
							{node}
						</SpaceProvider>
					</ServerEventsProvider>
				</PathnameContext.Provider>
			</AppRouterContext.Provider>,
		);
	});
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const texts = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.textContent);
const click = (el: HTMLElement) => act(async () => el.click());

describe("the top bar's tabs", () => {
	it("Today, then one tab per space that isn't archived", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.deepEqual(texts("[data-testid='space-tabs'] a"), ["Today", "CSE 29", "CSE 212 left"]);
		assert.equal(q("nav-today")!.getAttribute("href"), "/");
		assert.equal(q("space-option-old"), null, "archived spaces are under Menu");
	});
	it("a space's tab says how many files the teacher still has to read", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.equal(q("space-work-c21")!.textContent, "2 left");
		assert.equal(q("space-work-c29"), null);
	});

	it("marks the lit tab as the current page, and a space tab is the teacher's highlight target", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.equal(q("space-option-c29")!.getAttribute("aria-current"), "page");
		assert.equal(q("space-option-c21")!.hasAttribute("aria-current"), false);
		assert.equal(q("nav-today")!.hasAttribute("aria-current"), false);
		assert.equal(q("space-option-c29")!.getAttribute("data-halley-target"), "space:c29");
	});
	it("a space's tab opens its Progress page and switches the window to it", async () => {
		await mount(<SpaceTabs selected="today" />);
		assert.equal(q("space-option-c21")!.getAttribute("href"), "/space");
		await click(q("space-option-c21")!);
		await act(async () => {});
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeSpace":"c21"')), "the switch is saved");
	});
});

describe("Menu", () => {
	it("lists the places that belong to no one space", async () => {
		await mount(<AppMenu lit={false} />);
		assert.equal(q("app-menu")!.textContent, "Menu");
		assert.equal(q("app-menu")!.getAttribute("aria-expanded"), "false");
		await click(q("app-menu")!);
		assert.deepEqual(texts("[data-testid='app-menu-list'] [role='menuitem']"), ["Search lessons", "Add a space", "Prepare for something", "Lessons with no space", "Archived spaces", "Settings"]);
		assert.equal(q("menu-prep")!.getAttribute("href"), "/prep");
		assert.equal(q("menu-archived")!.getAttribute("href"), "/archived");
		assert.equal(q("settings-entry")!.getAttribute("href"), "/settings");
	});
	it("Lessons with no space leaves the space and opens its lessons", async () => {
		await mount(<AppMenu lit={false} />);
		await click(q("app-menu")!);
		await click(q("space-option-none")!);
		await act(async () => {});
		assert.deepEqual(pushed, ["/space/lessons"]);
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeSpace":"none"')));
	});
});

describe("Search lessons", () => {
	const open = async () => {
		await mount(
			<>
				<AppMenu lit={false} />
				<SearchLessons />
			</>,
		);
		assert.equal(q("search-lessons"), null, "closed until asked for");
		await click(q("app-menu")!);
		await click(q("menu-search-lessons")!);
		await act(async () => {});
	};
	const type = async (value: string) => {
		const field = q("search-lessons-field") as HTMLInputElement;
		// linkedom's input has no type until one is set, and React only
		// hears typing in a field whose type it knows.
		field.setAttribute("type", "text");
		await act(async () => {
			Object.defineProperty(field, "value", { configurable: true, writable: true, value });
			field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
	};
	it("opens from Menu over the lessons of every space, each with its space's name", async () => {
		await open();
		assert.equal(q("search-lessons")!.getAttribute("aria-label"), "Search lessons");
		const rows = texts("[data-testid='search-lessons-row']");
		assert.equal(rows.length, 3);
		assert.match(rows[0]!, /^PointersCSE 29/);
		assert.match(rows[1]!, /^InductionCSE 21/);
		assert.match(rows[2]!, /^Loose notesNo space/);
	});
	it("typing keeps only the matches; a click opens the lesson and closes the popup", async () => {
		await open();
		await type("induc");
		assert.equal(texts("[data-testid='search-lessons-row']").length, 1);
		await type("zzz");
		assert.match(q("search-lessons")!.textContent!, /No lessons match\./);
		await type("point");
		await click(q("search-lessons-row")!);
		assert.deepEqual(pushed, ["/chat/l1"]);
		assert.equal(q("search-lessons"), null);
	});
	it("Close closes it", async () => {
		await open();
		await click(q("search-lessons-close")!);
		assert.equal(q("search-lessons"), null);
	});
});

describe("a space page's head", () => {
	it("the space's name and description, Edit space, then its tabs with their counts", async () => {
		await mount(<SpaceHead />, { pathname: "/space/files" });
		assert.equal(q("space-head-name")!.textContent, "CSE 29");
		assert.match(q("space-head")!.textContent!, /Systems programming/);
		assert.equal(q("space-edit")!.textContent, "Edit space");
		assert.deepEqual(texts("[data-testid='space-head'] nav a"), ["Progress", "Lessons1", "Files33", "Graph", "Cheat sheets2", "Deadlines"]);
		assert.equal(q("nav-files-count")!.textContent, "33");
		assert.equal(q("nav-cheat-sheets-count")!.textContent, "2", "sheets made or being made");
		assert.equal(q("nav-files")!.getAttribute("aria-current"), "page");
		assert.equal(q("nav-progress")!.hasAttribute("aria-current"), false, "/space/files is Files, not Progress");
	});
	it("with no space it names the lessons that belong to none: no Edit space, files, cheat sheets or deadlines", async () => {
		await mount(<SpaceHead />, { pathname: "/space/lessons", active: null });
		assert.equal(q("space-head-name")!.textContent, "Lessons with no space");
		assert.equal(q("space-edit"), null);
		assert.deepEqual(texts("[data-testid='space-head'] nav a"), ["Progress", "Lessons1", "Graph"]);
		assert.equal(q("nav-lessons")!.getAttribute("aria-current"), "page");
	});
	it("Files is marked new while a scan found files not seen yet", () => {
		const now = Date.parse("2026-11-01T12:00:00Z");
		assert.equal(hasUnseenFiles("2026-11-01T10:00:00.000Z", null, now), true, "nothing seen yet");
		assert.equal(hasUnseenFiles("2026-11-01T10:00:00.000Z", "2026-10-31T10:00:00.000Z", now), true, "arrived after the last look");
		assert.equal(hasUnseenFiles("2026-11-01T10:00:00.000Z", "2026-11-01T10:00:00.000Z", now), false, "seen");
		assert.equal(hasUnseenFiles("2026-10-25T10:00:00.000Z", null, now), false, "no longer new");
		assert.equal(hasUnseenFiles(undefined, null, now), false);
	});
});

describe("Archived spaces", () => {
	it("lists only the archived spaces; a row opens the space again", async () => {
		await mount(<ArchivedSpaces />, { pathname: "/archived" });
		assert.deepEqual(texts("[data-testid='archived-spaces'] a"), ["MATH 18Linear algebra. 1 file"]);
		assert.equal(q("space-option-old")!.getAttribute("href"), "/space");
		await click(q("space-option-old")!);
		await act(async () => {});
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeSpace":"old"')));
	});
});
