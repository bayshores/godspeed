/**
 * The frame: the top bar's Today and class tabs, Menu, the "Search
 * lessons" popup it opens, a class page's head with its tabs, and the
 * Archived classes page.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ChatListItem, ClassSummary } from "../../src/shared/core/index.ts";

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
const { ClassTabs } = await import("../../src/frontend/components/top-bar/class-tabs.tsx");
const { AppMenu } = await import("../../src/frontend/components/top-bar/app-menu.tsx");
const { SearchLessons } = await import("../../src/frontend/components/search-lessons.tsx");
const { ClassHead } = await import("../../src/frontend/components/class-page/class-head.tsx");
const { ArchivedClasses } = await import("../../src/frontend/components/archived-classes.tsx");
const { hasUnseenFiles } = await import("../../src/frontend/components/files/files-seen.ts");
const { ClassProvider } = await import("../../src/frontend/components/class-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");

const cls = (id: string, name: string, over: Partial<ClassSummary> = {}): ClassSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", archived: false, fileCount: 33, color: 1, ...over });
const CLASSES = [cls("c29", "CSE 29", { description: "Systems programming" }), cls("c21", "CSE 21", { color: 2 }), cls("old", "MATH 18", { archived: true, description: "Linear algebra.", fileCount: 1 })];

const lesson = (id: string, title: string, classId?: string): ChatListItem => ({
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
	...(classId && { classId }),
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
		if (url === "/api/classes") return Response.json({ classes: CLASSES });
		if (url === "/api/chats") return Response.json({ chats: LESSONS });
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
						<ClassProvider initialActive={active} initialClasses={CLASSES}>
							{node}
						</ClassProvider>
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
	it("Today, then one tab per class that isn't archived", async () => {
		await mount(<ClassTabs selected="c29" />);
		assert.deepEqual(texts("[data-testid='class-tabs'] a"), ["Today", "CSE 29", "CSE 21"]);
		assert.equal(q("nav-today")!.getAttribute("href"), "/");
		assert.equal(q("class-option-old"), null, "archived classes are under Menu");
	});
	it("marks the lit tab as the current page, and a class tab is the teacher's highlight target", async () => {
		await mount(<ClassTabs selected="c29" />);
		assert.equal(q("class-option-c29")!.getAttribute("aria-current"), "page");
		assert.equal(q("class-option-c21")!.hasAttribute("aria-current"), false);
		assert.equal(q("nav-today")!.hasAttribute("aria-current"), false);
		assert.equal(q("class-option-c29")!.getAttribute("data-halley-target"), "class:c29");
	});
	it("a class's tab opens its Progress page and switches the window to it", async () => {
		await mount(<ClassTabs selected="today" />);
		assert.equal(q("class-option-c21")!.getAttribute("href"), "/class");
		await click(q("class-option-c21")!);
		await act(async () => {});
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeClass":"c21"')), "the switch is saved");
	});
});

describe("Menu", () => {
	it("lists the places that belong to no one class", async () => {
		await mount(<AppMenu lit={false} />);
		assert.equal(q("app-menu")!.textContent, "Menu");
		assert.equal(q("app-menu")!.getAttribute("aria-expanded"), "false");
		await click(q("app-menu")!);
		assert.deepEqual(texts("[data-testid='app-menu-list'] [role='menuitem']"), ["Search lessons", "Add a class", "Lessons with no class", "Archived classes", "Settings"]);
		assert.equal(q("menu-archived")!.getAttribute("href"), "/archived");
		assert.equal(q("settings-entry")!.getAttribute("href"), "/settings");
	});
	it("Lessons with no class leaves the class and opens its lessons", async () => {
		await mount(<AppMenu lit={false} />);
		await click(q("app-menu")!);
		await click(q("class-option-none")!);
		await act(async () => {});
		assert.deepEqual(pushed, ["/class/lessons"]);
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeClass":"none"')));
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
	it("opens from Menu over the lessons of every class, each with its class's name", async () => {
		await open();
		assert.equal(q("search-lessons")!.getAttribute("aria-label"), "Search lessons");
		const rows = texts("[data-testid='search-lessons-row']");
		assert.equal(rows.length, 3);
		assert.match(rows[0]!, /^PointersCSE 29/);
		assert.match(rows[1]!, /^InductionCSE 21/);
		assert.match(rows[2]!, /^Loose notesNo class/);
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

describe("a class page's head", () => {
	it("the class's name and description, Edit class, then its tabs with the Files count", async () => {
		await mount(<ClassHead />, { pathname: "/class/files" });
		assert.equal(q("class-head-name")!.textContent, "CSE 29");
		assert.match(q("class-head")!.textContent!, /Systems programming/);
		assert.equal(q("class-edit")!.textContent, "Edit class");
		assert.deepEqual(texts("[data-testid='class-head'] nav a"), ["Progress", "Lessons", "Files33", "Graph", "Cheat sheets"]);
		assert.equal(q("nav-files-count")!.textContent, "33");
		assert.equal(q("nav-files")!.getAttribute("aria-current"), "page");
		assert.equal(q("nav-progress")!.hasAttribute("aria-current"), false, "/class/files is Files, not Progress");
	});
	it("with no class it names the lessons that belong to none: no Edit class, files or cheat sheets", async () => {
		await mount(<ClassHead />, { pathname: "/class/lessons", active: null });
		assert.equal(q("class-head-name")!.textContent, "Lessons with no class");
		assert.equal(q("class-edit"), null);
		assert.deepEqual(texts("[data-testid='class-head'] nav a"), ["Progress", "Lessons", "Graph"]);
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

describe("Archived classes", () => {
	it("lists only the archived classes; a row opens the class again", async () => {
		await mount(<ArchivedClasses />, { pathname: "/archived" });
		assert.deepEqual(texts("[data-testid='archived-classes'] a"), ["MATH 18Linear algebra. 1 file"]);
		assert.equal(q("class-option-old")!.getAttribute("href"), "/class");
		await click(q("class-option-old")!);
		await act(async () => {});
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeClass":"old"')));
	});
});
