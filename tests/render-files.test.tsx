/**
 * The Files page (redesign plan, Phase 6 — design/exports/files.html),
 * mounted over linkedom with a fake fetch: the two sections and counts,
 * the linked folder, each row's state (coverage bar, Building facts…,
 * Failed + Retry), the Study/Info toggle and Unlink writing through the
 * class routes, and a "#file-<id>" link outlining its row.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ClassFile, ClassRecord, FileCoverage } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});
// linkedom has no location: a plain one carries the hash.
Object.defineProperty(dom.window, "location", { value: { hash: "", pathname: "/class/files", href: "http://localhost/class/files" }, configurable: true });
const scrolled: string[] = [];
(dom.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: HTMLElement) {
	scrolled.push(this.id);
};

// react-dom reads the DOM globals when it loads: import it after them.
// linkedom's document has no "oninput"; without it React would fall back
// to an old-IE way of watching text fields.
(dom.document as unknown as { oninput: null }).oninput = null;
const { createRoot } = await import("react-dom/client");
const { FilesPage } = await import("../components/files/files-page.tsx");
const { ServerEventsProvider } = await import("../components/server-events.tsx");
const { ClassProvider } = await import("../components/class-context.tsx");

function file(id: string, name: string, over: Partial<ClassFile> = {}): ClassFile {
	return { id, origin: "copied", name, path: `${id}/${name}`, kind: "study", contentFp: "", status: "ready", addedAt: "", ...over };
}

const RECORD: ClassRecord = {
	id: "cls_a",
	name: "CSE 21",
	description: "",
	createdAt: "",
	updatedAt: "",
	archived: false,
	linkedFolder: "/Users/me/School/CSE 21",
	files: [
		file("f1", "Lecture 1 — Counting.pdf"),
		file("f2", "Rosen 6.2 — Probability theory.pdf"),
		file("f3", "Rosen 7.1 — Discrete probability.pdf", { status: "extracting" }),
		file("f4", "Week 4 Discussion.srt", { status: "failed", error: "no audio" }),
		file("f5", "Syllabus.pdf", { kind: "info" }),
	],
};
const COVERAGE: FileCoverage[] = [
	{ fileId: "f1", name: "Lecture 1 — Counting.pdf", facts: 31, inLessons: 31, share: 1 },
	{ fileId: "f2", name: "Rosen 6.2 — Probability theory.pdf", facts: 22, inLessons: 0, share: 0 },
];

const calls: { method: string; url: string; body?: unknown }[] = [];
const originalFetch = globalThis.fetch;
function fakeFetch() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method !== "GET") calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
		if (url === "/api/classes") return Response.json({ classes: [{ id: "cls_a", name: "CSE 21" }] });
		if (url.startsWith("/api/classes/cls_a") && method === "GET") return Response.json({ class: RECORD });
		if (url.startsWith("/api/progress")) return Response.json({ classId: "cls_a", files: COVERAGE });
		return Response.json({ ok: true });
	}) as typeof fetch;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
async function mount() {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
	await act(async () => {
		root!.render(
			<ServerEventsProvider connect={connect as never}>
				<ClassProvider initialActive="cls_a">
					<FilesPage />
				</ClassProvider>
			</ServerEventsProvider>,
		);
	});
	// Let the record + progress fetches land.
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
	return host;
}
/** Type into a text field (React hears the "input" event). */
async function typeInto(input: HTMLInputElement, value: string) {
	await act(async () => {
		Object.defineProperty(input, "value", { configurable: true, writable: true, value });
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	calls.length = 0;
	scrolled.length = 0;
	globalThis.fetch = originalFetch;
	window.location.hash = "";
});

describe("FilesPage", () => {
	it("shows the linked folder, both sections with counts, and each row's state", async () => {
		fakeFetch();
		await mount();
		assert.ok(q("class-pick-folder"), "Link folder");
		assert.ok(q("class-add-files"), "Add files");
		assert.equal(q("class-folder-path")!.textContent, "~/School/CSE 21");
		assert.match(q("files-section-study")!.textContent!, /Study material · 4/);
		assert.match(q("files-section-info")!.textContent!, /Course info · 1/);
		// Studied: the fill is the share; unstudied: the white bar.
		assert.match(q("class-file-status-f1")!.textContent!, /31 facts/);
		assert.ok(q("class-file-f1")!.querySelector('[data-testid="file-coverage-fill"]'));
		assert.ok(q("class-file-status-f2")!.innerHTML.includes("bg-ink"), "unstudied file: white bar");
		assert.match(q("class-file-status-f3")!.textContent!, /Building facts…/);
		assert.equal(q("class-file-status-f4")!.textContent, "Failed");
		assert.ok(q("class-file-retry-f4"));
		assert.equal(q("class-file-status-f5"), null, "course info shows no state");
		assert.equal(q("class-file-kind-f5-info")!.getAttribute("aria-pressed"), "true");
	});

	it("the Study/Info toggle, Retry and Unlink write through the class routes", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("class-file-kind-f1-info")!.click());
		await act(async () => q("class-file-retry-f4")!.click());
		await act(async () => q("class-unlink-folder")!.click());
		// The lit segment does nothing.
		await act(async () => q("class-file-kind-f1-study")!.click());
		assert.deepEqual(calls, [
			{ method: "PUT", url: "/api/classes/cls_a/files/f1", body: { kind: "info" } },
			{ method: "PUT", url: "/api/classes/cls_a/files/f4", body: { retry: true } },
			{ method: "DELETE", url: "/api/classes/cls_a/folder", body: undefined },
		]);
	});

	it("Link folder without the desktop picker opens a path field that links the folder", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("class-pick-folder")!.click());
		assert.ok(q("class-folder-form"), "the path field replaces the folder row");
		const input = q("class-folder-input") as HTMLInputElement;
		await typeInto(input, "/Users/me/New");
		// linkedom's submit button doesn't submit its form: submit it directly.
		await act(async () => {
			q("class-folder-form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		});
		assert.deepEqual(calls.at(-1), { method: "PUT", url: "/api/classes/cls_a/folder", body: { path: "/Users/me/New" } });
	});

	it("a #file-<id> hash scrolls to that row and outlines it", async () => {
		fakeFetch();
		window.location.hash = "#file-f2";
		await mount();
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(scrolled, ["file-f2"]);
		assert.equal(q("class-file-f2")!.getAttribute("data-flash"), "true");
		assert.equal(q("class-file-f1")!.getAttribute("data-flash"), null);
	});
});
