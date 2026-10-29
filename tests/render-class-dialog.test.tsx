/**
 * The Edit class dialog with Deadlines (plan 2026-10-28; exams before that),
 * mounted over linkedom with a fake fetch: rows read "Midterm 1 · Exam ·
 * Thu Oct 29, 7:00 PM · 2 files" (done ones show a tick); one opens to its
 * kind, name, date, time, a checkbox per study file and Done; Add deadline
 * and Remove deadline are drafts until Save, which writes the class, then
 * removals, changes and new deadlines through the deadline routes. The
 * dialog has no file list.
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
	deadlines: [
		{ id: "exm_1", kind: "exam", name: "Midterm 1", date: "2026-10-29", time: "19:00", fileIds: ["f1", "f2"], done: false },
		{ id: "ddl_3", kind: "homework", name: "HW 1", date: "2026-11-01", fileIds: [], done: true, doneAt: "2026-10-28T10:00:00.000Z" },
		{ id: "exm_2", kind: "exam", name: "Final", date: "2026-12-09", fileIds: ["f1", "f2", "f3"], done: false },
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
		if (url === "/api/classes/cls_a/deadlines" && method === "POST")
			return Response.json({ deadline: { id: "ddl_new", done: false, ...body } }, { status: 201 });
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
async function choose(el: HTMLElement | null, value: string) {
	assert.ok(el, "missing select");
	await act(async () => {
		Object.defineProperty(el, "value", { configurable: true, writable: true, value });
		el.dispatchEvent(new window.Event("change", { bubbles: true }));
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

describe("Edit class dialog — deadlines", () => {
	it("shows name, description and the deadlines, and no file list", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal(q("class-dialog")!.getAttribute("aria-label"), "Edit class");
		assert.equal((q("class-name") as HTMLInputElement).value, "CSE 21");
		assert.match(q("class-deadlines")!.textContent!, /Deadlines/);
		assert.match(q("class-add-deadline")!.textContent!, /Add deadline/);
		const midterm = q("class-deadline-exm_1")!.textContent!;
		assert.match(midterm, /Midterm 1/);
		assert.match(midterm, /Exam/);
		assert.match(midterm, /Thu Oct 29, 7:00 PM/);
		assert.match(midterm, /2 files/);
		assert.equal(q("class-deadline-exm_1")!.querySelector('[data-testid="class-deadline-done-tick"]'), null);
		const hw = q("class-deadline-ddl_3")!;
		assert.match(hw.textContent!, /HW 1/);
		assert.match(hw.textContent!, /Homework/);
		assert.match(hw.textContent!, /Sun Nov 1/);
		assert.doesNotMatch(hw.textContent!, /PM|AM/, "no time, no clock");
		assert.ok(hw.querySelector('[data-testid="class-deadline-done-tick"]'), "a done one shows a tick");
		assert.equal(hw.getAttribute("data-done"), "true");
		assert.equal(q("class-files"), null, "the file list moved to the Files page");
		assert.ok(q("class-archive") && q("class-delete") && q("class-save"));
	});

	it("an open deadline has kind, name, date, time, the study files and Done", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		await click(q("class-deadline-exm_1"));
		assert.equal((q("class-deadline-kind") as HTMLSelectElement).value, "exam");
		assert.deepEqual(
			[...q("class-deadline-kind")!.querySelectorAll("option")].map((o) => o.textContent),
			["Exam", "Homework", "Quiz", "Project"],
		);
		assert.ok(q("class-deadline-name"), "the name is a field");
		assert.ok(q("class-deadline-date"), "the date is a field");
		assert.equal((q("class-deadline-time") as HTMLInputElement).value, "19:00");
		assert.ok(q("class-deadline-time-clear"), "a set time can be cleared");
		assert.equal((q("class-deadline-file-f1") as HTMLInputElement).checked, true);
		assert.equal((q("class-deadline-file-f3") as HTMLInputElement).checked, false);
		assert.equal(q("class-deadline-file-f4"), null, "course info is not offered");
		assert.equal((q("class-deadline-done") as HTMLInputElement).checked, false);
		assert.match(q("class-deadline-remove")!.textContent!, /Remove deadline/);
		// One open at a time.
		await click(q("class-deadline-exm_2"));
		assert.equal(q("class-deadline-exm_1")!.getAttribute("aria-expanded"), "false");
	});

	it("Save writes the class, then removals, changes and new deadlines", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		// Midterm 1 gains Rosen 6.2, loses its time, and is done.
		await click(q("class-deadline-exm_1"));
		await check(q("class-deadline-file-f3"));
		await click(q("class-deadline-time-clear"));
		await check(q("class-deadline-done"));
		assert.match(q("class-deadline-exm_1")!.textContent!, /3 files/);
		// HW 1 is not done after all, and becomes a quiz.
		await click(q("class-deadline-ddl_3"));
		await check(q("class-deadline-done"));
		await choose(q("class-deadline-kind"), "quiz");
		// The Final goes.
		await click(q("class-deadline-exm_2"));
		await click(q("class-deadline-remove"));
		assert.equal(q("class-deadline-exm_2"), null);
		// A new homework, due at 5 PM, already done.
		await click(q("class-add-deadline"));
		await choose(q("class-deadline-kind"), "homework");
		await typeInto(q("class-deadline-name"), "HW 2");
		await typeInto(q("class-deadline-date"), "2026-11-02");
		await typeInto(q("class-deadline-time"), "17:00");
		await check(q("class-deadline-file-f2"));
		await check(q("class-deadline-done"));
		await click(q("class-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(calls, [
			{ method: "PUT", url: "/api/classes/cls_a", body: { name: "CSE 21", description: "Discrete math", signature: null } },
			{ method: "DELETE", url: "/api/classes/cls_a/deadlines/exm_2", body: undefined },
			{ method: "PUT", url: "/api/classes/cls_a/deadlines/exm_1", body: { time: null, fileIds: ["f1", "f2", "f3"], done: true } },
			{ method: "PUT", url: "/api/classes/cls_a/deadlines/ddl_3", body: { kind: "quiz", done: false } },
			{
				method: "POST",
				url: "/api/classes/cls_a/deadlines",
				body: { kind: "homework", name: "HW 2", date: "2026-11-02", time: "17:00", fileIds: ["f2"] },
			},
			{ method: "PUT", url: "/api/classes/cls_a/deadlines/ddl_new", body: { done: true } },
		]);
		assert.equal(closed, 1);
	});

	it("a deadline without a date stops Save before anything is written", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		await click(q("class-add-deadline"));
		await typeInto(q("class-deadline-name"), "Quiz");
		await click(q("class-save"));
		assert.equal(q("class-dialog-error")!.textContent, "Quiz needs a date.");
		assert.deepEqual(calls, []);
		assert.equal(closed, 0);
	});

	it("the signature: pick a kind, type one line, see it in the cover's type, save it", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal((q("class-signature") as HTMLInputElement).value, "");
		assert.equal(q("class-signature-preview"), null, "nothing typed, no preview");
		await choose(q("class-signature-kind"), "code");
		await typeInto(q("class-signature"), "int *p = &x;");
		assert.match(q("class-signature-preview")!.innerHTML, /font-mono/);
		await click(q("class-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(calls[0], {
			method: "PUT",
			url: "/api/classes/cls_a",
			body: { name: "CSE 21", description: "Discrete math", signature: { kind: "code", value: "int *p = &x;" } },
		});
	});

	it("New class: name and description only", async () => {
		fakeFetch();
		await mount({ kind: "create" });
		assert.equal(q("class-dialog")!.getAttribute("aria-label"), "New class");
		assert.equal(q("class-deadlines"), null);
		assert.equal(q("class-signature"), null);
		assert.equal(q("class-save")!.textContent, "Create class");
	});
});
