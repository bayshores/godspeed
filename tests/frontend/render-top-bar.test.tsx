/**
 * The frame: the top bar's Today and space tabs with their right-click
 * menu, the + with Add a space, the closed spaces and the lessons with no
 * space, Menu, the "Search
 * lessons" popup it opens, and a space page's head with its signature and
 * tabs.
 */
import React, { act, useEffect } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
	// The menu's arrow keys skip text fields.
	HTMLInputElement: dom.window.HTMLInputElement,
	HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
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
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
// The search popup keeps its walked row in view.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

// After the DOM exists, so React hears "input" events.
const { createRoot } = await import("react-dom/client");
const { SpaceTabs } = await import("../../src/frontend/components/top-bar/space-tabs.tsx");
const { AppMenu } = await import("../../src/frontend/components/top-bar/app-menu.tsx");
const { SearchLessons } = await import("../../src/frontend/components/search-lessons.tsx");
const { SpaceHead } = await import("../../src/frontend/components/space-page/space-head.tsx");
const { HeadSignature } = await import("../../src/frontend/components/space-page/head-signature.tsx");
const { hasUnseenFiles } = await import("../../src/frontend/components/files/files-seen.ts");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { MemoryRouter, useLocation } = await import("react-router");

const space = (id: string, name: string, over: Partial<SpaceSummary> = {}): SpaceSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", closed: false, fileCount: 33, color: 1, filesLeft: 0, ...over });
const SPACES = [space("c29", "CSE 29", { description: "Systems programming", signature: { kind: "code", value: "*p" } }), space("c21", "CSE 21", { color: 2, filesLeft: 2 }), space("old", "MATH 18", { closed: true, description: "Linear algebra.", fileCount: 1 })];

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
	refused = null;
	globalThis.fetch = originalFetch;
});

/** Records every address the page goes to. */
function Spy() {
	const { pathname, search } = useLocation();
	useEffect(() => {
		pushed.push(pathname + search);
	}, [pathname, search]);
	return null;
}

/** A write the server refuses, as "PUT /api/spaces/c21". */
let refused: string | null = null;

async function mount(node: React.ReactNode, { pathname = "/", active = "c29" as string | null, spaces = SPACES, lessons = LESSONS } = {}) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		requests.push(`${method} ${url}${typeof init?.body === "string" ? ` ${init.body}` : ""}`);
		if (`${method} ${url}` === refused) return Response.json({ error: "The space is busy. Try again." }, { status: 409 });
		if (url === "/api/spaces") return Response.json({ spaces });
		if (url === "/api/chats") return Response.json({ chats: lessons });
		if (url === "/api/spaces/c29/cheat-sheets") return Response.json({ cards: [{ status: "made" }, { status: "making" }, { status: "none" }] });
		if (url.startsWith("/api/progress")) return Response.json({ spaceId: "c29", facts: [true, false, false, false].map((inLessons) => ({ inLessons, answers: [] })) });
		return Response.json({});
	}) as typeof fetch;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<MemoryRouter initialEntries={[pathname]}>
				<ServerEventsProvider connect={quietEvents as never}>
					<SpaceProvider initialActive={active} initialSpaces={spaces}>
						{node}
					</SpaceProvider>
				</ServerEventsProvider>
				<Spy />
			</MemoryRouter>,
		);
	});
	pushed.length = 0;
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const texts = (selector: string) => [...document.querySelectorAll(selector)].map((el) => el.textContent);
const click = (el: HTMLElement) => act(async () => el.click());
/** A right-click, or the context-menu key on a focused element. */
const rightClick = async (el: HTMLElement) => {
	const event = new dom.window.Event("contextmenu", { bubbles: true, cancelable: true });
	await act(async () => {
		el.dispatchEvent(event);
	});
	return event.defaultPrevented;
};
/** A key on a focused element; returns whether it was claimed. */
const press = async (el: HTMLElement, key: string, shiftKey = false) => {
	const event = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.assign(event, { key, shiftKey });
	await act(async () => {
		el.dispatchEvent(event);
	});
	return event.defaultPrevented;
};
const pressEscape = () =>
	act(async () => {
		const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.assign(esc, { key: "Escape" });
		document.dispatchEvent(esc);
	});
/** Lets the request and the space list's re-read finish. */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)));

describe("the top bar's tabs", () => {
	it("Today, then one tab per open space, then the +", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.deepEqual(texts("[data-testid='space-tabs'] a"), ["Today", "CSE 29", "CSE 212 left"]);
		assert.equal(q("nav-today")!.getAttribute("href"), "/");
		assert.ok(q("space-option-old") === null, "a closed space has no tab");
		const strip = q("space-tabs-strip")!;
		assert.ok(strip.lastElementChild === q("space-option-c21") && strip.nextElementSibling === q("spaces-plus"), "the + comes right after the last tab, outside the tabs' scroller");
		assert.match(q("spaces-plus")!.className, /shrink-0/, "the + never squeezes; the tabs do");
		assert.doesNotMatch(q("space-option-c21")!.className, /shrink-0/);
		assert.match(q("space-option-c21")!.className, /grid-cols-\[auto_minmax\(0,max-content\)_auto\]/, "a tab with a tag lets its name give way first");
	});
	it("a space's tab says how many files the teacher still has to read", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.equal(q("space-work-c21")!.textContent, "2 left");
		assert.ok(q("space-work-c29") === null);
	});

	it("marks the lit tab as the current page, and a space tab is the teacher's highlight target", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.equal(q("space-option-c29")!.getAttribute("aria-current"), "page");
		assert.equal(q("space-option-c21")!.hasAttribute("aria-current"), false);
		assert.equal(q("nav-today")!.hasAttribute("aria-current"), false);
		assert.equal(q("space-option-c29")!.getAttribute("data-teacher-target"), "space:c29");
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
		assert.deepEqual(texts("[data-testid='app-menu-list'] [role='menuitem']"), ["Search lessons", "Settings"]);
		assert.equal(q("settings-entry")!.getAttribute("href"), "/settings");
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
		assert.ok(q("search-lessons") === null, "closed until asked for");
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
		assert.ok(q("search-lessons") === null);
	});
	it("Close closes it", async () => {
		await open();
		await click(q("search-lessons-close")!);
		assert.ok(q("search-lessons") === null);
	});
});

describe("a space page's head", () => {
	it("the space's name and signature, then its tabs with their counts and Edit space", async () => {
		await mount(<SpaceHead />, { pathname: "/space/files" });
		assert.equal(q("space-head-name")!.textContent, "CSE 29");
		assert.doesNotMatch(q("space-head")!.textContent!, /Systems programming/, "the description is the teacher's, not the head's");
		assert.match(q("space-signature-ink")!.getAttribute("style")!, /--ink:\s*25%/, "inked as far as studied, on every tab");
		assert.equal(q("space-edit")!.textContent, "Edit space");
		assert.ok(document.querySelector("[data-testid='space-head'] nav")!.nextElementSibling === q("space-edit"), "Edit space ends the tab row");
		assert.deepEqual(texts("[data-testid='space-head'] nav a"), ["Progress25%", "Lessons1", "Files33", "Graph", "Cheat sheets2", "Deadlines"]);
		assert.equal(q("nav-files-count")!.textContent, "33");
		assert.equal(q("nav-cheat-sheets-count")!.textContent, "2", "sheets made or being made");
		assert.equal(q("nav-files")!.getAttribute("aria-current"), "page");
		assert.equal(q("nav-progress")!.hasAttribute("aria-current"), false, "/space/files is Files, not Progress");
	});
	it("with no space it names the lessons that belong to none: no Edit space, files, cheat sheets or deadlines", async () => {
		await mount(<SpaceHead />, { pathname: "/space/lessons", active: null });
		assert.equal(q("space-head-name")!.textContent, "Lessons with no space");
		assert.ok(q("space-edit") === null);
		assert.ok(q("space-signature") === null);
		assert.deepEqual(texts("[data-testid='space-head'] nav a"), ["Progress", "Lessons1", "Graph"]);
		assert.equal(q("nav-lessons")!.getAttribute("aria-current"), "page");
	});
	it("the signature: math in real LaTeX, code in mono, text in the serif italic", () => {
		const sign = (kind: "math" | "code" | "text", value: string) => renderToStaticMarkup(<HeadSignature signature={{ kind, value }} share={null} />);
		assert.match(sign("math", "E[X]"), /class="katex"/);
		assert.match(sign("code", "int *p"), /font-mono[^>]*>int \*p</);
		assert.match(sign("text", "carpe diem"), /italic[^>]*>carpe diem</);
	});
	it("the signature has no ink with nothing studied, or before the progress has loaded", () => {
		const sign = (share: number | null) => renderToStaticMarkup(<HeadSignature signature={{ kind: "math", value: "E[X]" }} share={share} />);
		assert.match(sign(0.4), /data-testid="space-signature-ink"[^>]*--ink:40%/);
		assert.ok(!sign(0).includes("space-signature-ink"));
		assert.ok(!sign(null).includes("space-signature-ink"));
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

describe("a tab's right-click menu", () => {
	const openMenu = async (id: string) => {
		assert.equal(await rightClick(q(`space-option-${id}`)!), true, "not the browser's menu");
		await act(async () => {});
	};
	it("has Close and Delete space, and marks its tab while open", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.ok(q("space-menu") === null);
		await openMenu("c21");
		assert.equal(q("space-menu")!.getAttribute("role"), "menu");
		assert.deepEqual(texts("[data-testid='space-menu'] [role='menuitem']"), ["Close", "Delete space"]);
		assert.match(q("space-option-c21")!.className, /(^| )bg-bar-ink\/10( |$)/, "the tab stays marked");
		assert.doesNotMatch(q("space-option-c29")!.className, /(^| )bg-bar-ink\/10( |$)/);
	});
	it("opens from the keyboard too, and says so to a screen reader", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.equal(q("space-option-c21")!.getAttribute("aria-description"), "Has a menu with Close and Delete space");
		assert.equal(await press(q("space-option-c21")!, "ContextMenu"), true);
		assert.equal(q("space-menu")!.getAttribute("data-state"), "open", "the context-menu key");
		await pressEscape();
		assert.equal(await press(q("space-option-c21")!, "F10"), false, "F10 alone is not it");
		assert.equal(q("space-menu")?.getAttribute("data-state") ?? "closed", "closed");
		assert.equal(await press(q("space-option-c21")!, "F10", true), true);
		assert.equal(q("space-menu")!.getAttribute("data-state"), "open", "Shift+F10");
	});
	it("a left-click on its tab closes it", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openMenu("c21");
		await click(q("space-option-c21")!);
		await act(async () => {});
		assert.equal(q("space-menu")?.getAttribute("data-state") ?? "closed", "closed");
	});
	it("Close closes the space and leaves the window where it is", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openMenu("c21");
		await click(q("space-menu-close")!);
		await settle();
		assert.ok(requests.includes('PUT /api/spaces/c21 {"closed":true}'));
		assert.equal(q("space-menu")?.getAttribute("data-state") ?? "closed", "closed");
		assert.deepEqual(pushed, [], "another space's page stays");
		assert.ok(!requests.some((r) => r.startsWith("PUT /api/settings/general")), "the window stays on its space");
	});
	it("after Close, focus goes to the tab that is lit", async () => {
		const spaces = [...SPACES];
		await mount(<SpaceTabs selected="c29" />, { spaces });
		let focused = 0;
		q("space-option-c29")!.focus = () => void focused++; // linkedom does not move focus
		await openMenu("c21");
		// The server's list once the space is closed.
		spaces[1] = { ...spaces[1]!, closed: true };
		await click(q("space-menu-close")!);
		await settle();
		assert.ok(q("space-option-c21") === null, "its tab is gone");
		assert.equal(focused, 1);
	});
	it("closing the space on screen goes to Today", async () => {
		await mount(<SpaceTabs selected="c29" />, { pathname: "/space" });
		await openMenu("c29");
		await click(q("space-menu-close")!);
		await settle();
		assert.ok(requests.includes('PUT /api/spaces/c29 {"closed":true}'));
		assert.deepEqual(pushed, ["/"]);
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeSpace":"none"')));
	});
	it("a refused Close says why in the menu and changes nothing", async () => {
		refused = "PUT /api/spaces/c29";
		await mount(<SpaceTabs selected="c29" />, { pathname: "/space" });
		await openMenu("c29");
		await click(q("space-menu-close")!);
		await settle();
		assert.equal(q("space-menu-error")!.textContent, "The space is busy. Try again.");
		assert.equal(q("space-menu-error")!.getAttribute("role"), "alert");
		assert.equal(q("space-menu")!.getAttribute("data-state"), "open", "the menu stays to show it");
		assert.deepEqual(pushed, []);
		assert.ok(!requests.some((r) => r.startsWith("PUT /api/settings/general")));
	});
	it("Delete space opens the delete question", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openMenu("c21");
		await click(q("space-menu-delete")!);
		await settle();
		assert.equal(q("space-dialog")!.getAttribute("aria-label"), "Delete CSE 21?");
		assert.ok(q("space-delete-confirm"));
	});
	it("Escape closes it and gives focus back to the tab", async () => {
		await mount(<SpaceTabs selected="c29" />);
		const tab = q("space-option-c21")!;
		let focused = 0;
		tab.focus = () => void focused++; // linkedom does not move focus
		await openMenu("c21");
		await pressEscape();
		assert.equal(q("space-menu")?.getAttribute("data-state") ?? "closed", "closed");
		assert.equal(focused, 1, "focus is back on the tab");
	});
	it("Today has no menu", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.equal(await rightClick(q("nav-today")!), false);
		assert.ok(q("space-menu") === null);
	});
});

describe("the +", () => {
	const openList = async () => {
		await click(q("spaces-plus")!);
		await act(async () => {});
	};
	it("is a menu button, lit while the window shows a closed space or the lessons with no space", async () => {
		await mount(<SpaceTabs selected="plus" />);
		const plus = q("spaces-plus")!;
		assert.equal(plus.getAttribute("aria-haspopup"), "menu");
		assert.equal(plus.getAttribute("aria-expanded"), "false");
		assert.match(plus.className, /bg-background/, "lit");
		await openList();
		assert.equal(plus.getAttribute("aria-expanded"), "true");
	});
	it("reads the lessons only while its list is open", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.ok(!requests.includes("GET /api/chats"), "not while closed");
		await openList();
		await settle();
		assert.ok(requests.includes("GET /api/chats"));
	});
	it("with no closed space and no lesson without one it only offers Add a space", async () => {
		await mount(<SpaceTabs selected="c29" />, { spaces: SPACES.filter((s) => !s.closed), lessons: LESSONS.filter((l) => l.spaceId) });
		assert.equal(q("spaces-plus")!.getAttribute("aria-label"), "Add a space");
		await openList();
		assert.deepEqual(texts("[data-testid='spaces-plus-list'] [role='menuitem']"), ["Add a space"]);
		assert.doesNotMatch(q("spaces-plus-list")!.textContent!, /Closed/);
	});
	it("Add a space, then the closed spaces, then the lessons with no space", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.equal(q("spaces-plus")!.getAttribute("aria-label"), "Add a space or reopen a closed one");
		await openList();
		await settle();
		assert.deepEqual(texts("[data-testid='spaces-plus-list'] [role='menuitem']"), ["Add a space", "MATH 18", "Lessons with no space"]);
		assert.equal(document.querySelector("[data-testid='spaces-plus-list'] [role='group']")!.textContent, "ClosedMATH 18");
	});
	it("Lessons with no space leaves the space and opens its lessons", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		await settle();
		await click(q("space-option-none")!);
		await act(async () => {});
		assert.deepEqual(pushed, ["/space/lessons"]);
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeSpace":"none"')));
		assert.equal(q("spaces-plus-list")?.getAttribute("data-state") ?? "closed", "closed");
	});
	it("Add a space opens the dialog for it", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		await click(q("space-new")!);
		await settle();
		assert.equal(q("space-dialog")!.getAttribute("aria-label"), "Add a space");
		assert.equal(q("spaces-plus-list")?.getAttribute("data-state") ?? "closed", "closed");
	});
	it("a closed space's row reopens it and switches the window to it", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		await click(q("closed-space-old")!);
		await settle();
		assert.ok(requests.includes('PUT /api/spaces/old {"closed":false}'));
		assert.deepEqual(pushed, ["/space"]);
		assert.ok(requests.some((r) => r.startsWith("PUT /api/settings/general") && r.includes('"activeSpace":"old"')));
		assert.equal(q("spaces-plus-list")?.getAttribute("data-state") ?? "closed", "closed");
	});
	it("a refused Reopen says why in the list and changes nothing", async () => {
		refused = "PUT /api/spaces/old";
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		await click(q("closed-space-old")!);
		await settle();
		assert.equal(q("spaces-plus-error")!.textContent, "The space is busy. Try again.");
		assert.equal(q("spaces-plus-list")!.getAttribute("data-state"), "open");
		assert.deepEqual(pushed, []);
		assert.ok(!requests.some((r) => r.startsWith("PUT /api/settings/general")));
	});
	it("a right-click on a closed row has Reopen and Delete space; Escape closes that menu first", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		assert.equal(await rightClick(q("closed-space-old")!), true);
		await act(async () => {});
		assert.deepEqual(texts("[data-testid='space-menu'] [role='menuitem']"), ["Reopen", "Delete space"]);
		assert.match(q("closed-space-old")!.className, /(^| )bg-accent( |$)/, "the row stays marked");
		assert.equal(q("closed-space-old")!.getAttribute("aria-description"), "Has a menu with Reopen and Delete space");
		await pressEscape();
		assert.equal(q("space-menu")?.getAttribute("data-state") ?? "closed", "closed");
		assert.equal(q("spaces-plus-list")!.getAttribute("data-state"), "open", "the list stays");
		await pressEscape();
		assert.equal(q("spaces-plus-list")?.getAttribute("data-state") ?? "closed", "closed");
	});
	it("a closed row's menu opens from the keyboard too", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		assert.equal(await press(q("closed-space-old")!, "F10", true), true);
		await act(async () => {});
		assert.deepEqual(texts("[data-testid='space-menu'] [role='menuitem']"), ["Reopen", "Delete space"]);
	});
	it("Reopen in a closed row's menu reopens and switches to it", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		await rightClick(q("closed-space-old")!);
		await act(async () => {});
		await click(q("space-menu-close")!);
		await settle();
		assert.ok(requests.includes('PUT /api/spaces/old {"closed":false}'));
		assert.deepEqual(pushed, ["/space"]);
	});
	it("Delete space in a closed row's menu opens the delete question", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		await rightClick(q("closed-space-old")!);
		await act(async () => {});
		await click(q("space-menu-delete")!);
		await settle();
		assert.equal(q("space-dialog")!.getAttribute("aria-label"), "Delete MATH 18?");
	});
});
