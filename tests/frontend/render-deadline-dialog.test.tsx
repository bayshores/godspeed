/**
 * "Add a deadline" and "Edit deadline", mounted over linkedom with a fake
 * fetch: the fields, what Save sends, the questions asked before changes or
 * the deadline are lost (with its mocks named), a deadline an agent removed
 * meanwhile, and an interview that was waiting for its date.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceDeadline, SpaceFile, WaitingDeadline } from "../../src/shared/core/index.ts";

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
// A new error scrolls into view.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const { createRoot } = await import("react-dom/client");
const { DeadlineDialog } = await import("../../src/frontend/components/space-page/deadline-dialog.tsx");

function file(id: string, name: string, kind: "study" | "info" = "study"): SpaceFile {
	return { id, origin: "copied", name, path: `${id}/${name}`, kind, contentFp: "", status: "ready", addedAt: "" };
}
const FILES = [file("f1", "Lecture 11 2026-10-27.pdf"), file("f2", "Lecture 12.pdf"), file("f3", "Rosen 6.2.pdf"), file("f4", "Syllabus.pdf", "info")];
const MIDTERM: SpaceDeadline = { id: "exm_1", kind: "exam", name: "Midterm 1", date: "2026-10-29", time: "19:00", fileIds: ["f1", "f2"], done: false };

const calls: { method: string; url: string; body?: unknown }[] = [];
const originalFetch = globalThis.fetch;
/** The PUT and DELETE of the deadline answer "no such deadline". */
let gone = false;
/** What GET …/mocks?deadline= answers; the deadlines it was asked for. */
let mockList: unknown[] = [];
const mocksAsked: string[] = [];
function fakeFetch() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const mocks = /\/mocks\?deadline=(.+)$/.exec(String(input));
		if (mocks) {
			mocksAsked.push(mocks[1]!);
			return Response.json({ mocks: mockList });
		}
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		calls.push({ method: init?.method ?? "GET", url: String(input), body });
		if (gone) return Response.json({ code: "deadline_not_found", error: "No such deadline" }, { status: 404 });
		return Response.json({ ok: true });
	}) as typeof fetch;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
let closed = 0;
let removed = 0;
async function mount(deadline: SpaceDeadline | null, files: readonly SpaceFile[] = FILES, waiting?: WaitingDeadline) {
	fakeFetch();
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const mode = { spaceId: "cls_a", deadline, files, ...(waiting ? { waiting } : {}) };
	await act(async () => {
		root!.render(<DeadlineDialog mode={mode} onClose={() => closed++} onRemoved={() => removed++} />);
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
async function pressEscape() {
	const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.assign(esc, { key: "Escape" });
	await act(async () => {
		document.dispatchEvent(esc);
	});
}
const settle = () =>
	act(async () => {
		await new Promise((r) => setTimeout(r, 10));
	});

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	document.body.innerHTML = "";
	root = undefined;
	host = undefined;
	closed = 0;
	removed = 0;
	gone = false;
	mockList = [];
	mocksAsked.length = 0;
	calls.length = 0;
	globalThis.fetch = originalFetch;
});

describe("Edit deadline", () => {
	it("shows the kind, name, date, time, the study files and Done", async () => {
		await mount(MIDTERM);
		assert.match(q("deadline-dialog")!.textContent!, /Edit deadline/);
		assert.equal(q("deadline-kind-exam")!.getAttribute("aria-checked"), "true");
		assert.deepEqual(["exam", "homework", "quiz", "project"].map((k) => q(`deadline-kind-${k}`)!.textContent), ["Exam", "Homework", "Quiz", "Project"]);
		assert.equal((q("deadline-name") as HTMLInputElement).value, "Midterm 1");
		assert.equal((q("deadline-date") as HTMLInputElement).value, "2026-10-29");
		assert.equal((q("deadline-time") as HTMLInputElement).value, "19:00");
		assert.equal((q("deadline-file-f1") as HTMLInputElement).checked, true);
		assert.equal((q("deadline-file-f3") as HTMLInputElement).checked, false);
		assert.match(q("deadline-file-f1")!.closest("label")!.textContent!, /Oct 27/, "a dated file shows its day");
		assert.ok(q("deadline-file-f4") === null, "space info is not offered");
		assert.ok(q("deadline-file-filter") === null, "a short list has no filter");
		assert.equal((q("deadline-done") as HTMLInputElement).checked, false);
		assert.equal(q("deadline-save")!.textContent, "Save");
		assert.match(q("deadline-remove")!.textContent!, /Remove deadline/);
	});

	it("Save sends only what changed, then closes", async () => {
		await mount(MIDTERM);
		await click(q("deadline-kind-quiz"));
		await check(q("deadline-file-f3"));
		await click(q("deadline-time-clear"));
		assert.ok(q("deadline-time-clear") === null, "no time, nothing to clear");
		await check(q("deadline-done"));
		await click(q("deadline-save"));
		await settle();
		assert.deepEqual(calls, [{ method: "PUT", url: "/api/spaces/cls_a/deadlines/exm_1", body: { kind: "quiz", time: null, fileIds: ["f1", "f2", "f3"], done: true } }]);
		assert.equal(closed, 1);
	});

	it("Save with nothing changed closes without a write", async () => {
		await mount(MIDTERM);
		await click(q("deadline-save"));
		assert.deepEqual(calls, []);
		assert.equal(closed, 1);
	});

	it("a cleared name stops Save before anything is written", async () => {
		await mount(MIDTERM);
		await typeInto(q("deadline-name"), "  ");
		await click(q("deadline-save"));
		assert.equal(q("deadline-dialog-error")!.textContent, "A deadline needs a name.");
		assert.deepEqual(calls, []);
		assert.equal(closed, 0);
	});

	it("with changes, Close and Esc ask \"Discard your changes?\" first", async () => {
		await mount(MIDTERM);
		await typeInto(q("deadline-name"), "Midterm A");
		await click(q("deadline-dialog-close"));
		assert.equal(closed, 0);
		assert.match(q("deadline-discard")!.textContent!, /Discard your changes\?/);
		assert.ok(q("deadline-save") === null, "the question takes the foot's place");
		await pressEscape();
		assert.ok(q("deadline-discard") === null, "Esc on the question keeps editing");
		assert.equal((q("deadline-name") as HTMLInputElement).value, "Midterm A");
		await pressEscape();
		await click(q("deadline-discard-keep"));
		assert.equal(closed, 0);
		await pressEscape();
		await click(q("deadline-discard-go"));
		assert.equal(closed, 1);
		assert.deepEqual(calls, [], "nothing saved");
	});

	it("with no changes, Esc closes at once", async () => {
		await mount(MIDTERM);
		await pressEscape();
		assert.equal(closed, 1);
	});

	it("Remove deadline asks first, then deletes", async () => {
		await mount(MIDTERM);
		await click(q("deadline-remove"));
		assert.equal(q("deadline-remove-confirm")!.querySelector("span")!.textContent, "Remove Midterm 1? This can't be undone.");
		assert.deepEqual(calls, []);
		await click(q("deadline-remove-confirm-keep"));
		assert.ok(q("deadline-save"), "Cancel goes back to the foot");
		await click(q("deadline-remove"));
		await click(q("deadline-remove-confirm-go"));
		await settle();
		assert.deepEqual(calls, [{ method: "DELETE", url: "/api/spaces/cls_a/deadlines/exm_1", body: undefined }]);
		assert.equal(removed, 1);
		assert.equal(closed, 0);
	});

	it("Remove deadline says its mocks go too; a homework has none to ask about", async () => {
		mockList = [{ id: "mock_1" }, { id: "mock_2" }, { id: "mock_3" }];
		await mount(MIDTERM);
		assert.deepEqual(mocksAsked, [], "asked only once the question is up");
		await click(q("deadline-remove"));
		await settle();
		assert.deepEqual(mocksAsked, ["exm_1"]);
		assert.match(q("deadline-remove-confirm")!.textContent!, /Remove Midterm 1\? This can't be undone\.Its 3 mocks are removed too\./);
		await act(async () => root?.unmount());
		mocksAsked.length = 0;
		await mount({ ...MIDTERM, id: "ddl_hw", kind: "homework" });
		await click(q("deadline-remove"));
		await settle();
		assert.deepEqual(mocksAsked, []);
		assert.doesNotMatch(q("deadline-remove-confirm")!.textContent!, /mocks/);
	});

	it("a deadline an agent removed meanwhile: Save says so, Remove counts as done", async () => {
		gone = true;
		await mount(MIDTERM);
		await typeInto(q("deadline-name"), "Midterm A");
		await click(q("deadline-save"));
		await settle();
		assert.equal(q("deadline-dialog-error")!.textContent, "Midterm 1 was removed while you were editing it, so your changes weren't saved.");
		assert.equal(closed, 0);
		await click(q("deadline-remove"));
		await click(q("deadline-remove-confirm-go"));
		await settle();
		assert.equal(removed, 1);
	});

	it("a long file list has a filter; a file the deadline lists stays offered even as space info", async () => {
		const many = [...Array.from({ length: 9 }, (_, i) => file(`g${i}`, `Lecture ${i}.pdf`)), file("info", "Syllabus.pdf", "info")];
		await mount({ ...MIDTERM, fileIds: ["info"] }, many);
		assert.equal((q("deadline-file-info") as HTMLInputElement).checked, true);
		await typeInto(q("deadline-file-filter"), "lecture 3");
		assert.ok(q("deadline-file-g3"));
		assert.ok(q("deadline-file-g4") === null);
		await typeInto(q("deadline-file-filter"), "zzz");
		assert.match(q("deadline-dialog")!.textContent!, /No file matches\./);
	});
});

describe("Add a deadline", () => {
	it("starts as an empty homework, with no Done and no Remove deadline", async () => {
		await mount(null);
		assert.match(q("deadline-dialog")!.textContent!, /Add a deadline/);
		assert.equal(q("deadline-kind-homework")!.getAttribute("aria-checked"), "true");
		assert.equal((q("deadline-name") as HTMLInputElement).value, "");
		assert.ok(q("deadline-done") === null);
		assert.ok(q("deadline-remove") === null);
		assert.equal(q("deadline-save")!.textContent, "Add deadline");
		await pressEscape();
		assert.equal(closed, 1, "nothing typed: closes at once");
	});

	it("an interview waiting for its date opens filled in, and is added under its id", async () => {
		const waiting = { id: "ddl_0a1b2c3d4e5f", name: "Onsite interview", aboutFileId: "f4", fileIds: ["f3"] };
		await mount(null, FILES, waiting);
		assert.equal(q("deadline-kind-interview")!.getAttribute("aria-checked"), "true");
		assert.equal((q("deadline-name") as HTMLInputElement).value, "Onsite interview");
		assert.equal((q("deadline-file-f3") as HTMLInputElement).checked, true);
		await pressEscape();
		assert.equal(closed, 1, "filled in is not a change");
		await typeInto(q("deadline-date"), "2026-11-24");
		await typeInto(q("deadline-time"), "14:00");
		await click(q("deadline-save"));
		await settle();
		assert.deepEqual(calls, [
			{
				method: "POST",
				url: "/api/spaces/cls_a/deadlines",
				body: { id: "ddl_0a1b2c3d4e5f", kind: "interview", name: "Onsite interview", date: "2026-11-24", time: "14:00", fileIds: ["f3"], aboutFileId: "f4" },
			},
		]);
	});

	it("an interview's name shows an interview as the example", async () => {
		await mount(null);
		await click(q("deadline-kind-interview"));
		assert.equal((q("deadline-name") as HTMLInputElement).getAttribute("placeholder"), "Onsite interview");
	});

	it("needs a date; then Add deadline posts it and closes", async () => {
		await mount(null);
		await typeInto(q("deadline-name"), "HW 6");
		await click(q("deadline-save"));
		assert.equal(q("deadline-dialog-error")!.textContent, "A deadline needs a date.");
		assert.deepEqual(calls, []);
		await typeInto(q("deadline-date"), "2026-11-13");
		await typeInto(q("deadline-time"), "23:59");
		await check(q("deadline-file-f2"));
		await click(q("deadline-save"));
		await settle();
		assert.deepEqual(calls, [{ method: "POST", url: "/api/spaces/cls_a/deadlines", body: { kind: "homework", name: "HW 6", date: "2026-11-13", time: "23:59", fileIds: ["f2"] } }]);
		assert.equal(closed, 1);
	});
});
