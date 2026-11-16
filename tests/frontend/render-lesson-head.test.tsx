/**
 * The lesson's title line under the app's bar: the lesson's name, the
 * homework file, the plugins, "Cheat sheet", "Find" and the size, Find
 * taking their place, and the bar marking the lesson's own space.
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
});
// Find selects its field on opening; linkedom has no select().
(dom.window.HTMLElement.prototype as unknown as { select: () => void }).select = () => {};

const { createRoot } = await import("react-dom/client");
const { LessonHead } = await import("../../src/frontend/components/lesson/lesson-head.tsx");
const { SpaceProvider, useSpaces } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { MemoryRouter } = await import("react-router");

const space = (id: string, name: string): SpaceSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", closed: false, fileCount: 3, color: 2, filesLeft: 0 });
const SPACES: SpaceSummary[] = [space("c21", "CSE 21"), space("c29", "CSE 29")];

/** The active space, as a page under the bar would read it. */
function ActiveSpace() {
	return <span data-testid="active-space">{useSpaces().active ?? "none"}</span>;
}

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
});

const rename = (over: Record<string, unknown> = {}) =>
	({ title: "Study: counting", renaming: false, draft: "", setDraft() {}, inputRef: { current: null }, start() {}, commit: async () => {}, cancel() {}, ...over }) as never;

async function mount(props: Partial<React.ComponentProps<typeof LessonHead>> = {}, active: string | null = "c21") {
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<MemoryRouter initialEntries={["/chat/ses_1"]}>
				<ServerEventsProvider connect={quietEvents as never}>
					<SpaceProvider initialActive={active} initialSpaces={SPACES}>
						<LessonHead rename={rename()} spaceId="c21" plugins={{ words: [], open: null, onToggle() {} }} stats={<button type="button">3k</button>} scopeRef={{ current: null }} scrollContextRef={{ current: null }} {...props} />
						<ActiveSpace />
					</SpaceProvider>
				</ServerEventsProvider>
			</MemoryRouter>,
		);
	});
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const click = (el: HTMLElement) => act(async () => el.click());
const buttons = () => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());

describe("the lesson's title line", () => {
	it("shows the lesson's name, with no bar or Back of its own", async () => {
		await mount();
		assert.equal(q("lesson-title")!.textContent, "Study: counting");
		assert.ok(q("page-back") === null);
		assert.ok(!document.querySelector(".lh-own-bar"), "the app's bar stays");
	});

	it("marks the lesson's own space in the bar, and no space for a lesson without one", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => Response.json({ spaces: SPACES })) as typeof fetch;
		try {
			await mount({}, "c29");
			assert.equal(q("active-space")!.textContent, "c21");
			act(() => root?.unmount());
			document.body.innerHTML = "";
			await mount({ spaceId: undefined }, "c29");
			assert.equal(q("active-space")!.textContent, "none");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("a lesson with no space has no Cheat sheet", async () => {
		await mount({ spaceId: undefined });
		assert.ok(q("lesson-cheat-sheet") === null);
		assert.ok(q("lesson-find"));
	});

	it("a plugin's word sits left of Cheat sheet, lit while its page is open, and a click reports it", async () => {
		const clicked: string[] = [];
		const plugins = { words: [{ id: "memes", label: "Memes" }, { id: "cards", label: "Cards" }], open: "memes", onToggle: (id: string) => void clicked.push(id) };
		await mount({ sheet: { open: false, onToggle() {} }, plugins });
		const words = [...document.querySelectorAll("[data-testid='lesson-head'] button")].map((b) => b.textContent?.trim());
		assert.deepEqual(words.slice(-5), ["Memes", "Cards", "Cheat sheet", "Find", "3k"]);
		assert.equal(q("lesson-plugin-memes")!.getAttribute("aria-pressed"), "true");
		assert.equal(q("lesson-plugin-cards")!.getAttribute("aria-pressed"), "false");
		assert.ok(!q("lesson-plugin-memes")!.className.includes("lh-btn-quiet"), "marked as a key");
		assert.ok(q("lesson-plugin-cards")!.className.includes("lh-btn-quiet"));
		await click(q("lesson-plugin-cards")!);
		assert.deepEqual(clicked, ["cards"]);
	});

	it("Cheat sheet toggles and reports whether it is open", async () => {
		let toggled = 0;
		await mount({ sheet: { open: true, onToggle: () => void toggled++ } });
		assert.equal(q("lesson-cheat-sheet")!.getAttribute("aria-pressed"), "true");
		await click(q("lesson-cheat-sheet")!);
		assert.equal(toggled, 1);
	});

	it("shows the homework file by its name", async () => {
		(window as unknown as { lh: unknown }).lh = { openPath: async () => {}, showInFolder: async () => {} };
		await mount({ file: { name: "HW6.pdf", path: "/tmp/HW6.pdf" } });
		assert.equal(q("lesson-assignment")!.textContent, "HW6.pdf");
		delete (window as unknown as { lh?: unknown }).lh;
	});

	it("adds the page of the open homework problem to the file word", async () => {
		(window as unknown as { lh: unknown }).lh = { openPath: async () => {}, showInFolder: async () => {} };
		await mount({ file: { name: "HW6.pdf", path: "/tmp/HW6.pdf" }, page: 1 });
		assert.equal(q("lesson-assignment")!.textContent, "HW6.pdf, page 1");
		delete (window as unknown as { lh?: unknown }).lh;
	});

	it("renaming swaps the name for a field", async () => {
		await mount({ rename: rename({ renaming: true, draft: "New name" }) });
		assert.ok(q("lesson-title") === null);
		assert.equal(document.querySelector<HTMLInputElement>("input[aria-label='Lesson name']")!.value, "New name");
	});
});

describe("Find in the title line", () => {
	it("replaces Cheat sheet and Find with the find field, and Close Find brings them back", async () => {
		await mount({ sheet: { open: false, onToggle() {} } });
		assert.deepEqual(buttons().filter((b) => b === "Cheat sheet" || b === "Find"), ["Cheat sheet", "Find"]);
		await click(q("lesson-find")!);
		assert.ok(q("session-find"));
		assert.ok(q("lesson-find") === null);
		assert.ok(q("lesson-cheat-sheet") === null);
		assert.deepEqual(buttons().filter((b) => b?.includes("match") || b === "Close Find"), ["Previous match", "Next match", "Close Find"]);
		assert.ok(document.querySelector("input[placeholder='Find in lesson']"));
		await click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Close Find")!);
		assert.ok(q("session-find") === null);
		assert.ok(q("lesson-find"));
		assert.ok(q("lesson-cheat-sheet"));
	});
});
