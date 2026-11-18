/**
 * The open lesson in the top bar: its name after the lit space tab, then on
 * the bar's right the plugins, the size, Find, "Cheat sheet", "More" and the
 * homework file, Find taking their place, and the bar lighting the lesson's
 * own space.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
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
// Find selects its field on opening; linkedom has no select().
(dom.window.HTMLElement.prototype as unknown as { select: () => void }).select = () => {};
// linkedom has no focus: remember what was last focused.
let focused: Element | null = null;
(dom.window.HTMLElement.prototype as unknown as { focus: () => void }).focus = function (this: Element) {
	focused = this;
};
Object.defineProperty(dom.document, "activeElement", { get: () => (focused?.isConnected ? focused : dom.document.body) });
// React reads the selection when focus moves between its fields.
Object.assign(dom.window, { getSelection: () => ({}) });

const { createRoot } = await import("react-dom/client");
const { LessonBar } = await import("../../src/frontend/components/lesson/lesson-bar.tsx");
const { AppBar } = await import("../../src/frontend/components/app-bar.tsx");
const { BarSlotsProvider } = await import("../../src/frontend/components/top-bar/bar-slots.tsx");
const { SpaceProvider, useSpaces } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { kbdEventForAction } = await import("../../src/shared/core/index.ts");
const { createMemoryRouter, RouterProvider } = await import("react-router");

const space = (id: string, name: string): SpaceSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", closed: false, fileCount: 3, color: 2, filesLeft: 0 });
const SPACES: SpaceSummary[] = [space("c21", "CSE 21"), space("c29", "CSE 29")];

/** The active space, as a page under the bar would read it. */
function ActiveSpace() {
	return <span data-testid="active-space">{useSpaces().active ?? "none"}</span>;
}

const served = (init?: RequestInit) => (init?.method === "DELETE" ? Response.json({ graphRevision: 2 }) : Response.json({ spaces: SPACES, chats: [] }));
let originalFetch: typeof fetch;
let asked: string[];
let root: Root | null = null;
beforeEach(() => {
	originalFetch = globalThis.fetch;
	asked = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		asked.push(`${init?.method ?? "GET"} ${url}`);
		return served(init);
	}) as typeof fetch;
});
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	globalThis.fetch = originalFetch;
});

const rename = (over: Record<string, unknown> = {}) =>
	({ title: "Study: counting", renaming: false, draft: "", setDraft() {}, inputRef: { current: null }, start() {}, commit: async () => {}, cancel() {}, ...over }) as never;

/** The lesson route's loader runs once per read of the record; "/space" is where a delete goes. */
let router: ReturnType<typeof createMemoryRouter> | null = null;
let loads = 0;

async function mount(props: Partial<React.ComponentProps<typeof LessonBar>> = {}, active: string | null = "c21") {
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	loads = 0;
	const page = (
		<ServerEventsProvider connect={quietEvents as never}>
			<SpaceProvider initialActive={active} initialSpaces={SPACES}>
				<BarSlotsProvider>
					<AppBar />
					<main>
						<LessonBar chatId="ses_1" rename={rename()} spaceId="c21" plugins={{ words: [], open: null, onToggle() {} }} stats={<button type="button">3k</button>} scopeRef={{ current: null }} scrollContextRef={{ current: null }} {...props} />
						<ActiveSpace />
					</main>
				</BarSlotsProvider>
			</SpaceProvider>
		</ServerEventsProvider>
	);
	router = createMemoryRouter(
		[
			{ path: "/chat/:id", loader: () => ++loads, HydrateFallback: () => null, element: page },
			{ path: "/space", element: <span data-testid="progress-page" /> },
		],
		{ initialEntries: ["/chat/ses_1"] },
	);
	await act(async () => {
		root!.render(<RouterProvider router={router!} />);
	});
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const click = (el: HTMLElement) => act(async () => el.click());
/** The bar's right-hand words, each by its name. */
const words = () => [...q("bar-actions")!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
const pressEscape = () =>
	act(async () => {
		const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.assign(esc, { key: "Escape" });
		document.dispatchEvent(esc);
	});

describe("the open lesson in the top bar", () => {
	it("puts the lesson's name after the lit space tab, and nothing of it on the page but its heading", async () => {
		await mount();
		const title = q("lesson-title")!;
		assert.equal(title.querySelector(".truncate")!.textContent, "Study: counting", "the shown name; the spans beside it only size it");
		assert.equal(title.getAttribute("title"), "Study: counting");
		assert.ok(q("space-option-c21")!.parentElement!.contains(title), "in the lit tab's group");
		assert.equal(q("space-option-c21")!.getAttribute("aria-current"), "page");
		assert.equal(document.querySelector("main h1")!.textContent, "Study: counting");
		assert.ok(!document.querySelector("main button"), "no words left on the page");
		assert.ok(q("lesson-head") === null);
	});

	it("lights the lesson's own space, and the + for a lesson without one", async () => {
		await mount({}, "c29");
		assert.equal(q("active-space")!.textContent, "c21");
		assert.equal(q("space-option-c21")!.getAttribute("aria-current"), "page");
		act(() => root?.unmount());
		document.body.innerHTML = "";
		await mount({ spaceId: undefined }, "c29");
		assert.equal(q("active-space")!.textContent, "none");
		assert.ok(q("bar-crumb")!.previousElementSibling === q("spaces-plus"));
		assert.ok(q("bar-crumb")!.contains(q("lesson-title")));
	});

	it("lays its words out in order: plugins, the size, Find, Cheat sheet, More, then the homework file", async () => {
		(window as unknown as { lh: unknown }).lh = { openPath: async () => {}, showInFolder: async () => {} };
		const plugins = { words: [{ id: "memes", label: "Memes" }], open: null, onToggle() {} };
		await mount({ sheet: { open: false, onToggle() {} }, plugins, file: { name: "HW6.pdf", path: "/tmp/HW6.pdf" }, page: 2 });
		assert.deepEqual(words(), ["Memes", "3k", "Find in lesson", "Cheat sheet", "More for Study: counting", "HW6.pdf, page 2"]);
		assert.equal(q("lesson-assignment")!.textContent, "HW6.pdf, page 2");
		delete (window as unknown as { lh?: unknown }).lh;
	});

	it("Find is the magnifying glass with its key, and says both to a screen reader", async () => {
		await mount();
		const find = q("lesson-find")!;
		assert.equal(find.getAttribute("aria-label"), "Find in lesson");
		assert.ok(find.querySelector("svg"), "the glass");
		assert.ok(find.querySelector("kbd"), "its key");
		assert.ok(find.getAttribute("aria-keyshortcuts"));
	});

	it("a lesson with no space has no Cheat sheet, in the bar or in More", async () => {
		await mount({ spaceId: undefined });
		assert.ok(q("lesson-cheat-sheet") === null);
		await click(q("lesson-more")!);
		assert.ok(q("ctx-cheat-sheet") === null);
	});

	it("a plugin's word is lit while its page is open, and a click reports it", async () => {
		const clicked: string[] = [];
		const plugins = { words: [{ id: "memes", label: "Memes" }, { id: "cards", label: "Cards" }], open: "memes", onToggle: (id: string) => void clicked.push(id) };
		await mount({ plugins });
		assert.equal(q("lesson-plugin-memes")!.getAttribute("aria-pressed"), "true");
		assert.equal(q("lesson-plugin-cards")!.getAttribute("aria-pressed"), "false");
		assert.match(q("lesson-plugin-memes")!.className, /bg-bar-ink /, "marked as the bar marks an open panel");
		assert.doesNotMatch(q("lesson-plugin-cards")!.className, /bg-bar-ink /);
		await click(q("lesson-plugin-cards")!);
		assert.deepEqual(clicked, ["cards"]);
	});

	it("Cheat sheet toggles and says whether it is open", async () => {
		let toggled = 0;
		await mount({ sheet: { open: true, onToggle: () => void toggled++ } });
		const word = q("lesson-cheat-sheet")!;
		assert.equal(word.getAttribute("aria-pressed"), "true");
		await click(word);
		assert.equal(toggled, 1);
	});

	it("renaming swaps the name for a field in the bar", async () => {
		await mount({ rename: rename({ renaming: true, draft: "New name" }) });
		assert.ok(q("lesson-title") === null);
		const field = document.querySelector<HTMLInputElement>("input[aria-label='Lesson name']")!;
		assert.equal(field.value, "New name");
		assert.ok(q("bar-crumb")!.contains(field));
	});
});

describe("More in the bar", () => {
	const pick = (testid: string) => act(async () => q(testid)!.click());

	it("is named for the lesson and opens the lesson menu, Rename showing F2", async () => {
		await mount();
		const more = q("lesson-more")!;
		assert.equal(more.textContent, "More");
		assert.equal(more.getAttribute("aria-label"), "More for Study: counting");
		assert.equal(more.getAttribute("aria-haspopup"), "menu");
		assert.equal(more.getAttribute("aria-expanded"), "false");
		assert.doesNotMatch(more.className, /bg-bar-ink /);
		await click(more);
		assert.ok(q("lesson-menu"));
		assert.equal(q("lesson-more")!.getAttribute("aria-expanded"), "true");
		assert.match(q("lesson-more")!.className, /bg-bar-ink /, "lit while its menu is open");
		assert.deepEqual([...document.querySelectorAll("[data-testid=lesson-menu] [role=menuitem]")].map((b) => b.getAttribute("data-testid")), ["ctx-rename", "ctx-export-md", "ctx-move-space", "ctx-delete"]);
		const renameItem = q("ctx-rename")!;
		assert.equal(renameItem.querySelector("kbd")!.textContent, "F2");
		assert.equal(renameItem.getAttribute("aria-keyshortcuts"), "F2");
	});

	it("Rename closes the menu and starts the title rename", async () => {
		let started = 0;
		await mount({ rename: rename({ start: () => void started++ }) });
		await click(q("lesson-more")!);
		await pick("ctx-rename");
		assert.equal(started, 1);
		await act(async () => new Promise((r) => setTimeout(r, 400))); // the exit plays
		assert.ok(q("lesson-menu") === null);
	});

	it("Delete opens the Delete lesson? pop-up for this lesson, and a delete leaves for Progress", async () => {
		await mount();
		await click(q("lesson-more")!);
		await pick("ctx-delete");
		assert.ok(q("delete-lesson-dialog"));
		assert.equal(q("delete-lesson-name")!.textContent, "Study: counting");
		await pick("delete-confirm");
		assert.ok(asked.includes("DELETE /api/chats/ses_1?mode=preserve-graph"));
		assert.equal(router!.state.location.pathname, "/space");
	});

	it("Move keeps the lesson open and reads its record again, so the bar can mark the new space", async () => {
		await mount();
		assert.equal(loads, 1);
		await click(q("lesson-more")!);
		await pick("ctx-move-space");
		const other = [...document.querySelectorAll<HTMLInputElement>("[data-testid=move-lesson-dialog] input[type=radio]")].find((r) => r.parentElement?.textContent?.includes("CSE 29"))!;
		await act(async () => other.click());
		await pick("move-lesson-confirm");
		assert.ok(asked.includes("PUT /api/chats/ses_1/space"));
		assert.equal(router!.state.location.pathname, "/chat/ses_1");
		assert.equal(loads, 2);
	});
});

describe("Find in the bar", () => {
	it("swaps the words for the field, and Close Find brings them back", async () => {
		await mount({ sheet: { open: false, onToggle() {} } });
		await click(q("lesson-find")!);
		assert.ok(q("session-find"));
		assert.ok(q("bar-actions")!.contains(q("session-find")), "in the bar");
		for (const gone of ["lesson-find", "lesson-cheat-sheet", "lesson-more"]) assert.ok(q(gone) === null, gone);
		assert.deepEqual(words(), ["Previous match", "Next match", "Close Find"]);
		assert.ok(document.querySelector("input[placeholder='Find in lesson']"));
		await click(document.querySelector<HTMLElement>("button[aria-label='Close Find']")!);
		assert.ok(q("session-find") === null);
		assert.ok(q("lesson-find"));
		assert.ok(q("lesson-cheat-sheet"));
	});

	it("opens on the Find key, and Escape closes it keeping the query", async () => {
		await mount();
		await act(async () => {
			window.dispatchEvent(new CustomEvent(kbdEventForAction("find")));
		});
		const field = document.querySelector<HTMLInputElement>("input[placeholder='Find in lesson']")!;
		assert.ok(field);
		// linkedom's input has no type until one is set, and React only hears typing in a field whose type it knows.
		field.setAttribute("type", "text");
		await act(async () => {
			Object.defineProperty(field, "value", { configurable: true, writable: true, value: "count" });
			field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		assert.equal(q("session-find-count")!.textContent, "0 of 0");
		await pressEscape();
		assert.ok(q("session-find") === null);
		await click(q("lesson-find")!);
		assert.equal(document.querySelector<HTMLInputElement>("input[placeholder='Find in lesson']")!.value, "count");
	});

	it("gives focus back to the magnifying glass when it was opened from there", async () => {
		await mount();
		q("lesson-find")!.focus();
		await click(q("lesson-find")!);
		assert.ok(document.activeElement === document.querySelector("input[placeholder='Find in lesson']"), "the field has focus");
		await pressEscape();
		assert.ok(q("session-find") === null);
		assert.ok(document.activeElement === q("lesson-find"), "the glass, drawn again, has it back");
	});

	it("waits while a menu is open over the lesson", async () => {
		await mount();
		await click(q("lesson-more")!);
		await act(async () => {
			window.dispatchEvent(new CustomEvent(kbdEventForAction("find")));
		});
		assert.ok(q("session-find") === null);
	});
});
