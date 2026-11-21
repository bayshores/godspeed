/**
 * The frame: the top bar's Home and space tabs, the + with Add a space, the closed spaces and the lessons with no
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
import { ariaKeyShortcuts, bindingForAction, IS_MAC, keyHintText, type ChatListItem, type KeyAction, type SpaceSummary } from "../../src/shared/core/index.ts";

const keyText = (action: KeyAction) => keyHintText(bindingForAction(action), IS_MAC);
const ariaKey = (action: KeyAction) => ariaKeyShortcuts(bindingForAction(action), IS_MAC);

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
const { BarZoom } = await import("../../src/frontend/components/top-bar/bar-zoom.tsx");
const { MagnifiedPage, MagnifierProvider } = await import("../../src/frontend/components/magnifier/magnifier.tsx");
const { PINCH } = await import("../../src/frontend/components/magnifier/magnifier-model.ts");
const { SearchLessons } = await import("../../src/frontend/components/search-lessons.tsx");
const { KeyboardShortcuts } = await import("../../src/frontend/components/keyboard-shortcuts.tsx");
const { SpaceHead } = await import("../../src/frontend/components/space-page/space-head.tsx");
const { HeadSignature } = await import("../../src/frontend/components/space-page/head-signature.tsx");
const { hasUnseenFiles } = await import("../../src/frontend/components/files/files-seen.ts");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { ProgressProvider } = await import("../../src/frontend/components/use-progress.tsx");
const { MemoryRouter, useLocation } = await import("react-router");
const { BarHost } = await import("../bar-host.tsx");

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
						<ProgressProvider>{node}</ProgressProvider>
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
/** Lets the request and the space list's re-read finish. */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 10)));

describe("the top bar's tabs", () => {
	it("Home, then one tab per open space, then the +", async () => {
		await mount(<SpaceTabs selected="c29" />);
		assert.deepEqual(texts("[data-testid='space-tabs'] a"), ["Home", "CSE 29", "CSE 212 left"]);
		assert.equal(q("nav-home")!.getAttribute("href"), "/");
		assert.ok(q("space-option-old") === null, "a closed space has no tab");
		const strip = q("space-tabs-strip")!;
		assert.ok(strip.lastElementChild!.firstElementChild === q("space-option-c21") && strip.nextElementSibling!.firstElementChild === q("spaces-plus"), "the + comes right after the last tab, outside the tabs' scroller");
		assert.ok(strip.previousElementSibling === q("nav-home"), "Home sits before the scroller, so it never scrolls away");
		assert.match(q("spaces-plus")!.className, /shrink-0/, "the + never squeezes; the tabs do");
		assert.doesNotMatch(q("space-option-c21")!.className, /shrink-0/);
		assert.match(q("space-option-c21")!.className, /grid-cols-\[auto_minmax\(auto,max-content\)_auto\]/, "a tab with a tag lets its name give way first");
		assert.equal(q("space-option-c21")!.querySelector<HTMLElement>("[title='CSE 21']")!.style.minWidth, "max-content", "a short name never squeezes");
		const lit = q("space-option-c29")!.parentElement!;
		assert.match(lit.className, /shrink-0/, "the lit tab never gives way to the other tabs");
		assert.match(q("space-option-c29")!.className, /grid-cols-\[auto_fit-content\(240px\)_auto\]/);
		assert.match(lit.className, /max-w-full/, "but is never wider than the strip, so a long name ends in an ellipsis");
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
		assert.equal(q("nav-home")!.hasAttribute("aria-current"), false);
		assert.equal(q("space-option-c29")!.getAttribute("data-teacher-target"), "space:c29");
	});
	it("a space's tab opens its Progress page and switches the window to it", async () => {
		await mount(<SpaceTabs selected="today" />);
		assert.equal(q("space-option-c21")!.getAttribute("href"), "/space");
		await click(q("space-option-c21")!);
		await act(async () => {});
		assert.ok(requests.some((r) => r.startsWith("PATCH /api/settings/general") && r.includes('"activeSpace":"c21"')), "the switch is saved");
	});
});

describe("Menu", () => {
	it("lists the places that belong to no one space", async () => {
		await mount(<AppMenu lit={false} />);
		assert.equal(q("app-menu")!.textContent, "Menu");
		assert.equal(q("app-menu")!.getAttribute("aria-expanded"), "false");
		await click(q("app-menu")!);
		const lines: [string, KeyAction][] = [["Search lessons", "sessions-search"], ["Keyboard shortcuts", "shortcuts"], ["Settings", "open-settings"]];
		assert.deepEqual(texts("[data-testid='app-menu-list'] [role='menuitem']"), lines.map(([label, action]) => label + keyText(action)));
		assert.equal(q("menu-search-lessons")!.getAttribute("aria-keyshortcuts"), ariaKey("sessions-search"));
		assert.equal(q("menu-shortcuts")!.getAttribute("aria-keyshortcuts"), ariaKey("shortcuts"));
		assert.equal(q("settings-entry")!.getAttribute("aria-keyshortcuts"), ariaKey("open-settings"));
		assert.equal(q("settings-entry")!.getAttribute("href"), "/settings");
	});

	it("Keyboard shortcuts opens the list, with the rows that are only listed", async () => {
		await mount(
			<>
				<AppMenu lit={false} />
				<KeyboardShortcuts />
			</>,
		);
		assert.ok(q("shortcuts") === null, "closed until asked for");
		await click(q("app-menu")!);
		await click(q("menu-shortcuts")!);
		await act(async () => {});
		assert.equal(q("shortcuts")!.getAttribute("aria-label"), "Keyboard shortcuts");
		const list = q("shortcuts")!.textContent!;
		for (const row of ["Pick an answer by its number", "Keep the calculator's answer", "Magnify the page, or pinch"]) assert.ok(list.includes(row), row);
		assert.equal(q("app-menu-list")?.getAttribute("data-state") ?? "closed", "closed", "the menu closes");
	});
});

describe("the app's size in the bar", () => {
	const lhWindow = window as unknown as { lh?: object };
	afterEach(() => {
		delete lhWindow.lh;
	});

	it("shows while the app is not at 100%, follows the shell, and a click puts it back", async () => {
		const set: number[] = [];
		let push: (factor: number) => void = () => {};
		lhWindow.lh = {
			getZoom: async () => 1.25,
			onZoom: (cb: (factor: number) => void) => ((push = cb), () => {}),
			setZoom: async (factor: number) => void set.push(factor),
		};
		await mount(<BarZoom />);
		assert.equal(q("bar-zoom")!.textContent, "125%");
		assert.equal(q("bar-zoom")!.getAttribute("aria-label"), "Text size 125%, back to 100%");
		act(() => push(1.5));
		assert.equal(q("bar-zoom")!.textContent, "150%");
		act(() => q("bar-zoom")!.click());
		assert.deepEqual(set, [1]);
		act(() => push(1));
		assert.equal(q("bar-zoom"), null);
	});

	it("shows nothing at 100%", async () => {
		lhWindow.lh = { getZoom: async () => 1, onZoom: () => () => {} };
		await mount(<BarZoom />);
		assert.equal(q("bar-zoom"), null);
	});

	it("shows nothing in a browser", async () => {
		await mount(<BarZoom />);
		assert.equal(q("bar-zoom"), null);
	});

	it("a pinch magnifies the page at the pointer, the bar says how much, and a click puts it back", async () => {
		lhWindow.lh = { getZoom: async () => 1.25, onZoom: () => () => {} };
		await mount(
			<MagnifierProvider>
				<BarZoom />
				<MagnifiedPage>
					<p>Page</p>
				</MagnifiedPage>
			</MagnifierProvider>,
		);
		const box = q("magnifier")!;
		Object.assign(box, { getBoundingClientRect: () => ({ left: 0, top: 48, right: 1000, bottom: 848, width: 1000, height: 800 }) });
		Object.defineProperties(box, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
		// What the window would hit: the page below the 48-point bar, the bar above it.
		Object.assign(document, { elementFromPoint: (_x: number, y: number) => (y >= 48 ? box.querySelector("p") : document.body) });
		const pinch = (by: number, x: number, y: number) => act(() => void window.dispatchEvent(new CustomEvent(PINCH, { detail: { by, x, y } })));
		pinch(2, 300, 248);
		const shown = box.firstElementChild as HTMLElement;
		assert.equal(shown.style.transform, "translate(-300px, -200px) scale(2)");
		assert.equal(q("bar-zoom")!.textContent, "200%");
		assert.equal(q("bar-zoom")!.getAttribute("aria-label"), "Magnified 200%, back to 100%");
		assert.ok(q("mini-map"));
		pinch(2, 0, 10);
		assert.equal(q("bar-zoom")!.textContent, "200%", "a pinch over the top bar leaves the page alone");
		assert.equal(shown.style.transform, "translate(-300px, -200px) scale(2)");
		act(() => q("bar-zoom")!.click());
		assert.equal(shown.style.transform, "");
		assert.equal(q("mini-map"), null);
		assert.equal(q("bar-zoom")!.textContent, "125%", "the app's own size shows again");
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
	it("its tabs with their counts, then the signature, with Edit space in the top bar; no name, since the top bar's tab has it", async () => {
		await mount(
			<BarHost>
				<SpaceHead plugins={[]} />
			</BarHost>,
			{ pathname: "/space/files" },
		);
		assert.equal(q("space-head-name"), null);
		assert.doesNotMatch(q("space-head")!.textContent!, /CSE 29/);
		assert.doesNotMatch(q("space-head")!.textContent!, /Systems programming/, "the description is the teacher's, not the head's");
		assert.match(q("space-signature-ink")!.getAttribute("style")!, /--ink:\s*25%/, "inked as far as studied, on every tab");
		assert.equal(q("space-edit")!.textContent, "Edit space");
		assert.equal(q("space-edit")!.parentElement, q("bar-actions"), "Edit space is a word in the top bar");
		assert.match(q("space-edit")!.className, /order-last/, "after the words Files and Graph add");
		assert.ok(!q("space-head")!.contains(q("space-edit")), "not on the page");
		const nav = document.querySelector("[data-testid='space-head'] nav")!;
		assert.ok(nav.nextElementSibling!.contains(q("space-signature")) && nav.parentElement!.lastElementChild === nav.nextElementSibling, "the signature ends the tab row");
		assert.deepEqual(texts("[data-testid='space-head'] nav a"), ["Progress25%", "Files33", `Graph${keyText("jump-graph")}`, "Deadlines"]);
		assert.equal(q("nav-files-count")!.textContent, "33");
		assert.equal(q("nav-files")!.getAttribute("aria-current"), "page");
		assert.equal(q("nav-progress")!.hasAttribute("aria-current"), false, "/space/files is Files, not Progress");
	});
	it("with no space it names the lessons that belong to none: no Edit space, files or deadlines", async () => {
		await mount(<SpaceHead plugins={[]} />, { pathname: "/space", active: null });
		assert.equal(q("space-head-name")!.textContent, "Lessons with no space");
		assert.ok(q("space-edit") === null);
		assert.ok(q("space-signature") === null);
		assert.deepEqual(texts("[data-testid='space-head'] nav a"), ["Progress", `Graph${keyText("jump-graph")}`]);
		assert.equal(q("nav-progress")!.getAttribute("aria-current"), "page");
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
		assert.match(plus.className, /text-ink/, "lit: the paper's ink");
		assert.ok(plus.closest("[data-lit]"), "the paper slides under it");
		await openList();
		assert.equal(plus.getAttribute("aria-expanded"), "true");
		assert.match(plus.className, /\bbg-bar(\s|$)/, "with its list open it is the bar's color over the paper");
		assert.doesNotMatch(plus.className, /text-ink/);
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
	it("Lessons with no space leaves the space and opens Progress", async () => {
		await mount(<SpaceTabs selected="c29" />);
		await openList();
		await settle();
		await click(q("space-option-none")!);
		await act(async () => {});
		assert.deepEqual(pushed, ["/space"]);
		assert.ok(requests.some((r) => r.startsWith("PATCH /api/settings/general") && r.includes('"activeSpace":"none"')));
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
		assert.ok(requests.some((r) => r.startsWith("PATCH /api/settings/general") && r.includes('"activeSpace":"old"')));
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
		assert.ok(!requests.some((r) => r.startsWith("PATCH /api/settings/general")));
	});
});
