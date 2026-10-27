/**
 * The Edit class dialog with Exams (redesign plan, Phase 6 —
 * docs/design/exports/edit-class-exams.html), mounted over linkedom with a fake
 * fetch: exam rows read "Midterm 1 · Thu Oct 29 · 2 files"; one opens to
 * its name, date and a checkbox per study file; Add exam and Remove exam
 * are drafts until Save, which writes the class, then removals, changes
 * and new exams through the exam routes. The dialog has no file list.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ClassFile, ClassRecord } from "../src/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
// linkedom's document has no "oninput"; without it React would watch text
// fields an old-IE way. Set before react-dom loads.
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { ClassDialog } = await import("../src/components/class-dialog.tsx");
const { ServerEventsProvider } = await import("../src/components/server-events.tsx");
const { ClassProvider } = await import("../src/components/class-context.tsx");

function file(id: string, name: string, kind: "study" | "info" = "study"): ClassFile {
	return { id, origin: "copied", name, path: `${id}/${name}`, kind, contentFp: "", status: "ready", addedAt: "" };
}
const RECORD: ClassRecord = {
	id: "cls_a",
	name: "CSE 21",
	description: "Discrete math",
	createdAt: "",
	updatedAt: "",
	archived: false,
	files: [file("f1", "Lecture 1 — Counting.pdf"), file("f2", "Lecture 2 — Permutations.pdf"), file("f3", "Rosen 6.2.pdf"), file("f4", "Syllabus.pdf", "info")],
	exams: [
		{ id: "exm_1", name: "Midterm 1", date: "2026-10-29", fileIds: ["f1", "f2"] },
		{ id: "exm_2", name: "Final", date: "2026-12-09", fileIds: ["f1", "f2", "f3"] },
	],
};

const calls: { method: string; url: string; body?: unknown }[] = [];
const originalFetch = globalThis.fetch;
function fakeFetch() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		if (method !== "GET") calls.push({ method, url, body });
		if (url === "/api/classes") return Response.json({ classes: [{ id: "cls_a", name: "CSE 21" }] });
		if (url === "/api/classes/cls_a" && method === "GET") return Response.json({ class: RECORD });
		if (url === "/api/classes/cls_a/exams" && method === "POST") return Response.json({ exam: { id: "exm_new", ...body } }, { status: 201 });
		return Response.json({ ok: true });
	}) as typeof fetch;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
let closed = 0;
async function mount(mode: { kind: "create" } | { kind: "edit"; classId: string }) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
	await act(async () => {
		root!.render(
			<ServerEventsProvider connect={connect as never}>
				<ClassProvider initialActive="cls_a">
					<ClassDialog mode={mode} onClose={() => closed++} />
				</ClassProvider>
			</ServerEventsProvider>,
		);
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
async function click(el: HTMLElement | null) {
	assert.ok(el, "missing click target");
	await act(async () => el.click());
}
async function typeInto(el: HTMLElement | null, value: string) {
	assert.ok(el, "missing field");
	await act(async () => {
		Object.defineProperty(el, "value", { configurable: true, writable: true, value });
		el.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}
/** linkedom's click doesn't flip a checkbox: flip it, then click. */
async function check(el: HTMLElement | null) {
	assert.ok(el, "missing checkbox");
	const box = el as HTMLInputElement;
	await act(async () => {
		Object.defineProperty(box, "checked", { configurable: true, writable: true, value: !box.checked });
		box.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
}

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	document.body.innerHTML = "";
	root = undefined;
	host = undefined;
	closed = 0;
	calls.length = 0;
	globalThis.fetch = originalFetch;
});

describe("Edit class dialog — exams", () => {
	it("shows name, description and the exams, and no file list", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal(q("class-dialog")!.getAttribute("aria-label"), "Edit class");
		assert.equal((q("class-name") as HTMLInputElement).value, "CSE 21");
		const midterm = q("class-exam-exm_1")!.textContent!;
		assert.match(midterm, /Midterm 1/);
		assert.match(midterm, /Thu Oct 29/);
		assert.match(midterm, /2 files/);
		assert.equal(q("class-files"), null, "the file list moved to the Files page");
		assert.ok(q("class-archive") && q("class-delete") && q("class-save"));
	});

	it("an open exam lists the study files as checkboxes", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		await click(q("class-exam-exm_1"));
		assert.ok(q("class-exam-name"), "the name is a field");
		assert.ok(q("class-exam-date"), "the date is a field");
		assert.equal((q("class-exam-file-f1") as HTMLInputElement).checked, true);
		assert.equal((q("class-exam-file-f3") as HTMLInputElement).checked, false);
		assert.equal(q("class-exam-file-f4"), null, "course info is not offered");
		// One open at a time.
		await click(q("class-exam-exm_2"));
		assert.equal(q("class-exam-exm_1")!.getAttribute("aria-expanded"), "false");
	});

	it("Save writes the class, then removals, changes and new exams", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		// Midterm 1 gains Rosen 6.2.
		await click(q("class-exam-exm_1"));
		await check(q("class-exam-file-f3"));
		assert.match(q("class-exam-exm_1")!.textContent!, /3 files/);
		// The Final goes.
		await click(q("class-exam-exm_2"));
		await click(q("class-exam-remove"));
		assert.equal(q("class-exam-exm_2"), null);
		// A new quiz.
		await click(q("class-add-exam"));
		await typeInto(q("class-exam-name"), "Quiz");
		await typeInto(q("class-exam-date"), "2026-11-02");
		await check(q("class-exam-file-f2"));
		await click(q("class-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(calls, [
			{ method: "PUT", url: "/api/classes/cls_a", body: { name: "CSE 21", description: "Discrete math" } },
			{ method: "DELETE", url: "/api/classes/cls_a/exams/exm_2", body: undefined },
			{ method: "PUT", url: "/api/classes/cls_a/exams/exm_1", body: { fileIds: ["f1", "f2", "f3"] } },
			{ method: "POST", url: "/api/classes/cls_a/exams", body: { name: "Quiz", date: "2026-11-02", fileIds: ["f2"] } },
		]);
		assert.equal(closed, 1);
	});

	it("an exam without a date stops Save before anything is written", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		await click(q("class-add-exam"));
		await typeInto(q("class-exam-name"), "Quiz");
		await click(q("class-save"));
		assert.equal(q("class-dialog-error")!.textContent, "Quiz needs a date.");
		assert.deepEqual(calls, []);
		assert.equal(closed, 0);
	});

	it("New class: name and description only", async () => {
		fakeFetch();
		await mount({ kind: "create" });
		assert.equal(q("class-dialog")!.getAttribute("aria-label"), "New class");
		assert.equal(q("class-exams"), null);
		assert.equal(q("class-save")!.textContent, "Create class");
	});
});
