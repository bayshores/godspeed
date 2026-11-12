/**
 * The lesson's own bar: the way back with the class's name, the lesson's
 * name, the homework file, "Cheat sheet" and "Find", and Find taking their
 * place in the bar.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ClassSummary } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	self: globalThis,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
});
// Find selects its field on opening; linkedom has no select().
(dom.window.HTMLElement.prototype as unknown as { select: () => void }).select = () => {};

const { createRoot } = await import("react-dom/client");
const { LessonTopBar } = await import("../../src/frontend/components/lesson/lesson-top-bar.tsx");
const { ClassProvider } = await import("../../src/frontend/components/class-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");

const CLASSES: ClassSummary[] = [{ id: "c21", name: "CSE 21", description: "", createdAt: "", updatedAt: "", archived: false, fileCount: 3, color: 2 }];

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
});

const rename = (over: Record<string, unknown> = {}) =>
	({ title: "Study: counting", renaming: false, draft: "", setDraft() {}, inputRef: { current: null }, start() {}, commit: async () => {}, cancel() {}, ...over }) as never;

async function mount(props: Partial<React.ComponentProps<typeof LessonTopBar>> = {}) {
	const router = { push() {}, prefetch() {} } as unknown as React.ContextType<typeof AppRouterContext>;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<AppRouterContext.Provider value={router}>
				<ServerEventsProvider connect={quietEvents as never}>
					<ClassProvider initialActive="c21" initialClasses={CLASSES}>
						<LessonTopBar rename={rename()} classId="c21" scopeRef={{ current: null }} scrollContextRef={{ current: null }} {...props} />
					</ClassProvider>
				</ServerEventsProvider>
			</AppRouterContext.Provider>,
		);
	});
}

const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const click = (el: HTMLElement) => act(async () => el.click());
const buttons = () => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());

describe("the lesson's own bar", () => {
	it("goes back to the class's lessons under the class's name, and shows the lesson's name", async () => {
		await mount();
		const back = q("page-back")!;
		assert.equal(back.textContent, "CSE 21");
		assert.equal(back.getAttribute("href"), "/class/lessons");
		assert.equal(q("lesson-title")!.textContent, "Study: counting");
		assert.ok(q("lesson-bar")!.className.includes("lh-own-bar"));
	});

	it("a lesson with no class goes back to Lessons and has no Cheat sheet", async () => {
		await mount({ classId: undefined });
		assert.equal(q("page-back")!.textContent, "Lessons");
		assert.equal(q("lesson-cheat-sheet"), null);
		assert.ok(q("lesson-find"));
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

	it("renaming swaps the name for a field", async () => {
		await mount({ rename: rename({ renaming: true, draft: "New name" }) });
		assert.equal(q("lesson-title"), null);
		assert.equal(document.querySelector<HTMLInputElement>("input[aria-label='Lesson name']")!.value, "New name");
	});
});

describe("Find in the bar", () => {
	it("replaces Cheat sheet and Find with the find field, and Close Find brings them back", async () => {
		await mount({ sheet: { open: false, onToggle() {} } });
		assert.deepEqual(buttons().filter((b) => b === "Cheat sheet" || b === "Find"), ["Cheat sheet", "Find"]);
		await click(q("lesson-find")!);
		assert.ok(q("session-find"));
		assert.equal(q("lesson-find"), null);
		assert.equal(q("lesson-cheat-sheet"), null);
		assert.deepEqual(buttons().filter((b) => b?.includes("match") || b === "Close Find"), ["Previous match", "Next match", "Close Find"]);
		assert.ok(document.querySelector("input[placeholder='Find in lesson']"));
		await click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Close Find")!);
		assert.equal(q("session-find"), null);
		assert.ok(q("lesson-find"));
		assert.ok(q("lesson-cheat-sheet"));
	});
});
