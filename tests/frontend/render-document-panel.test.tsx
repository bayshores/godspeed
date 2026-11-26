/**
 * The Document panel beside a lesson: its header with one file (the page in view, no name) and
 * with several (the picker of their names), the pages drawn in
 * the theme's ink, the open problem's box, a page that fails to load with Try again, and a PDF
 * that does not open.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { LessonDocument } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
const store = new Map<string, string>();
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	Event: dom.window.Event,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
	localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
});
// The panel measures its pages and scrolls its view; linkedom lays nothing out.
const scrolls: number[] = [];
for (const [name, value] of Object.entries({ clientWidth: 340, clientHeight: 450, scrollHeight: 5000, offsetTop: 0 })) {
	Object.defineProperty(dom.window.HTMLElement.prototype, name, { get: () => value, configurable: true });
}
(dom.window.HTMLElement.prototype as unknown as { scrollTo: (o: { top: number }) => void }).scrollTo = ({ top }) => void scrolls.push(top);
Object.assign(dom.window, { innerWidth: 1600 });

const { DocumentPanel } = await import("../../src/frontend/components/lesson/document-panel.tsx");
const { problemPlace } = await import("../../src/frontend/components/lesson/document-model.ts");
const { SINGLE_PIECE } = await import("../piece-fixtures.ts");

const TEST: LessonDocument = { id: "f_9", name: "Midterm 2022", path: "/files/Midterm 2022.pdf", pdf: true, pages: 3, aspect: 0.77 };
const KEY: LessonDocument = { id: "f_key", name: "Midterm 2022 key", path: "/files/Midterm 2022 key.pdf", pdf: true, pages: 2, aspect: 0.77 };

let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
});

function mount(over: Partial<React.ComponentProps<typeof DocumentPanel>> = {}) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	act(() => root!.render(<DocumentPanel choices={[TEST]} shown={TEST} place={null} there={false} onPick={() => {}} onRetry={() => {}} onClose={() => {}} {...over} />));
	return host;
}
const q = (host: Element, id: string) => host.querySelector(`[data-testid='${id}']`);
const reactProps = (el: Element) => Object.entries(el).find(([k]) => k.startsWith("__reactProps"))![1] as { onChange: (e: unknown) => void };

describe("the Document panel", () => {
	it("with one file shows the page in view and Close, not the file's name, and every page in the theme's ink", () => {
		let closed = 0;
		const host = mount({ onClose: () => void closed++ });
		const header = host.querySelector("header")!;
		assert.ok(header.querySelector("select") === null, "no picker");
		assert.equal(q(host, "document-dock-page")!.textContent, "Page 1 of 3");
		assert.doesNotMatch(header.textContent!, /Midterm/);
		assert.equal(q(host, "document-dock")!.getAttribute("aria-label"), "Document");
		assert.equal(q(host, "document-dock-resize")!.getAttribute("aria-label"), "Drag to resize the document");
		assert.match(q(host, "document-dock")!.getAttribute("style")!, /--lh-dock-w:\s*520px/, "wider than the cheat sheet, so a page reads");
		const pages = [...host.querySelectorAll("[data-testid='document-page']")];
		assert.deepEqual(
			pages.map((p) => p.getAttribute("data-page")),
			["1", "2", "3"],
		);
		const img = pages[1]!.querySelector("img")!;
		assert.match(img.getAttribute("src")!, /^\/api\/cited\/f_9\/page\/2\?w=480&ink=[0-9a-f]{6}$/);
		assert.equal(img.getAttribute("loading"), "lazy", "drawn once it nears the view");
		assert.equal(img.getAttribute("alt"), "Page 2");
		const scroller = q(host, "document-pages")!;
		assert.deepEqual([scroller.getAttribute("role"), scroller.getAttribute("aria-label")], ["region", "Pages"], "a named region, so the label is read");
		act(() => (q(host, "document-dock-close") as HTMLElement).click());
		assert.equal(closed, 1);
	});

	it("boxes the open problem on its page at its own shape, nothing else, and goes to it", () => {
		scrolls.length = 0;
		const host = mount({ place: problemPlace(SINGLE_PIECE, undefined, null) });
		const boxes = [...host.querySelectorAll("[data-testid='document-box']")];
		assert.equal(boxes.length, 1);
		const page = boxes[0]!.closest("[data-testid='document-page']")!;
		assert.ok(page === host.querySelector("[data-page='1']"), "on page 1");
		assert.match(boxes[0]!.getAttribute("style")!, /left:10%;top:20%;width:80%;height:20(\.0+\d*)?%/);
		assert.match(boxes[0]!.className, /lh-doc-box-in/, "in a panel opened after the lesson, the box closes in");
		assert.match(page.firstElementChild!.getAttribute("style")!, /aspect-ratio:0\.5/, "its page has the piece's shape");
		assert.match(host.querySelector("[data-page='2']")!.firstElementChild!.getAttribute("style")!, /aspect-ratio:0\.77/);
		assert.equal(host.querySelectorAll("[data-testid='piece-veil']").length, 0, "nothing dimmed");
		assert.ok(scrolls.length > 0, "the view went to the box");
		assert.equal(page.querySelector("img")!.getAttribute("alt"), "Page 1, the open problem is on this page", "the box is only drawn, so the picture says so");
		assert.equal(host.querySelector("[data-page='2'] img")!.getAttribute("alt"), "Page 2");
		act(() => root!.unmount());
		const there = mount({ place: problemPlace(SINGLE_PIECE, undefined, null), there: true });
		assert.equal(q(there, "document-box")!.className.includes("lh-doc-box-in"), false, "in a panel open as the lesson showed, the box is just there");
		there.remove();
	});

	it("has no box for a problem in another file", () => {
		const host = mount({ place: { ...problemPlace(SINGLE_PIECE, undefined, null)!, fileId: "f_key" } });
		assert.equal(host.querySelectorAll("[data-testid='document-box']").length, 0);
		assert.equal(host.querySelector("[data-page='1'] img")!.getAttribute("alt"), "Page 1");
	});

	it("with several files has a picker of their names, the list's file first", () => {
		const picked: string[] = [];
		const host = mount({ choices: [TEST, KEY], onPick: (id) => void picked.push(id) });
		const pick = q(host, "document-dock-pick") as HTMLSelectElement;
		assert.deepEqual(
			[...pick.querySelectorAll("option")].map((o) => o.textContent),
			["Midterm 2022", "Midterm 2022 key"],
		);
		assert.equal(q(host, "document-dock-page")!.textContent, "Page 1 of 3", "the page in view stays beside the picker");
		act(() => reactProps(pick).onChange({ target: { value: "f_key" } }));
		assert.deepEqual(picked, ["f_key"]);
	});

	it("shows a page that did not load with Try again, which asks for it again", () => {
		const host = mount();
		const page = () => host.querySelector("[data-page='2']")!;
		act(() => void page().querySelector("img")!.dispatchEvent(new Event("error")));
		assert.ok(page().querySelector("img") === null);
		assert.equal(page().querySelector("[data-testid='load-failed'] p")!.textContent, "Couldn't load page 2.");
		assert.ok(host.querySelector("[data-page='1'] img"), "the other pages stay");
		act(() => (page().querySelector("[data-testid='load-failed-retry']") as HTMLElement).click());
		assert.ok(page().querySelector("img"));
		assert.ok(page().querySelector("[data-testid='load-failed']") === null);
	});

	it("says a PDF that does not open, and Try again reads the lesson's files again", () => {
		let retried = 0;
		const broken: LessonDocument = { id: "f_bad", name: "Scan", path: "/files/Scan.pdf", pdf: true };
		const host = mount({ choices: [broken], shown: broken, onRetry: () => void retried++ });
		assert.equal(host.querySelector("[data-testid='load-failed'] p")!.textContent, "Couldn't open this document.");
		assert.equal(q(host, "document-dock-page")!.textContent, "", "no page count");
		act(() => (q(host, "load-failed-retry") as HTMLElement).click());
		assert.equal(retried, 1);
	});
});
