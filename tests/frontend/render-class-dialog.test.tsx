/**
 * The Edit class dialog, mounted over linkedom with a fake fetch: Save
 * writes only the fields the learner changed. The dialog has no file list
 * and no deadlines (those have their own tabs).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ClassFile, ClassRecord } from "../../src/shared/core/index.ts";

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
const { ClassDialog } = await import("../../src/frontend/components/class-dialog.tsx");
const { MoveLessonDialog } = await import("../../src/frontend/components/lessons/move-lesson-dialog.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { ClassProvider } = await import("../../src/frontend/components/class-context.tsx");

function file(id: string, name: string, kind: "study" | "info" = "study"): ClassFile {
	return { id, origin: "copied", name, path: `${id}/${name}`, kind, contentFp: "", status: "ready", addedAt: "" };
}
const RECORD: ClassRecord = {
	id: "cls_a",
	name: "CSE 21",
	description: "Discrete math",
	color: 2,
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
/** The record the server holds now (an agent may change it mid-test). */
let served: ClassRecord = RECORD;
/** The mounted dialog's server event handlers, by event name. */
const events = new Map<string, (raw: string) => void>();
function fakeFetch() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		if (method !== "GET") calls.push({ method, url, body });
		if (url === "/api/classes") return Response.json({ classes: [{ id: "cls_a", name: "CSE 21" }] });
		if (url === "/api/classes/cls_a" && method === "GET") return Response.json({ class: served });
		if (url === "/api/classes/cls_a" && method === "DELETE") return Response.json({ ok: true, lessonIds: ["l1", "l2"] });
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
	const connect = () => ({ onEvent: (name: string, cb: (raw: string) => void) => events.set(name, cb), onOpen() {}, close() {} });
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
/** Esc on the document; returns whether something claimed it. */
async function pressEscape() {
	const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.assign(esc, { key: "Escape" });
	await act(async () => {
		document.dispatchEvent(esc);
	});
	return esc.defaultPrevented;
}
afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	document.body.innerHTML = "";
	root = undefined;
	host = undefined;
	closed = 0;
	calls.length = 0;
	served = RECORD;
	events.clear();
	globalThis.fetch = originalFetch;
});

describe("Edit class dialog", () => {
	it("shows name and description, and no deadlines or file list", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal(q("class-dialog")!.getAttribute("aria-label"), "Edit class");
		assert.equal((q("class-name") as HTMLInputElement).value, "CSE 21");
		assert.equal(q("class-deadlines"), null, "deadlines moved to the Deadlines tab");
		assert.equal(q("class-files"), null, "the file list moved to the Files page");
		assert.ok(q("class-archive") && q("class-delete") && q("class-save"));
	});

	it("the signature: pick a kind, type one line, see it in the cover's type, save it", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal((q("class-signature") as HTMLInputElement).value, "");
		assert.equal(q("class-signature-preview"), null, "nothing typed, no preview");
		await click(q("class-signature-kind-code"));
		await typeInto(q("class-signature"), "int *p = &x;");
		assert.match(q("class-signature-preview")!.innerHTML, /font-mono/);
		await click(q("class-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(calls[0], {
			method: "PUT",
			url: "/api/classes/cls_a",
			body: { signature: { kind: "code", value: "int *p = &x;" } },
		});
	});

	it("Save writes only the learner's edits, never undoing an agent's change made while the dialog was open", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		const [midterm, , final] = RECORD.deadlines!;
		// The agent moves Midterm 1, removes HW 1, adds Quiz 1 and sets a signature.
		served = {
			...RECORD,
			signature: { kind: "math", value: "n choose k" },
			deadlines: [{ ...midterm!, date: "2026-10-30" }, final!, { id: "ddl_9", kind: "quiz", name: "Quiz 1", date: "2026-11-05", fileIds: [], done: false }],
		};
		assert.ok(events.has("classes-changed"));
		await act(async () => {
			events.get("classes-changed")!("{}");
			await new Promise((r) => setTimeout(r, 20));
		});
		// The learner only renames the class.
		await typeInto(q("class-name"), "CSE 21A");
		await click(q("class-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(calls, [{ method: "PUT", url: "/api/classes/cls_a", body: { name: "CSE 21A" } }]);
		assert.equal(closed, 1);
	});

	it("the icon: pick a subject icon and save it", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal(q("class-icon-sigma")!.getAttribute("aria-checked"), "false");
		await click(q("class-icon-sigma"));
		assert.equal(q("class-icon-sigma")!.getAttribute("aria-checked"), "true");
		await click(q("class-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.equal((calls[0] as { body: { icon?: string } }).body.icon, "sigma");
	});

	it("the color: the class's color is picked, another one saves", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal(q("class-color-2")!.getAttribute("aria-checked"), "true");
		await click(q("class-color-5"));
		assert.equal(q("class-color-5")!.getAttribute("aria-checked"), "true");
		await click(q("class-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual((calls[0] as { body: unknown }).body, { color: 5 });
	});

	it("Add a class: name and description only", async () => {
		fakeFetch();
		await mount({ kind: "create" });
		assert.equal(q("class-dialog")!.getAttribute("aria-label"), "Add a class");
		assert.equal(q("class-deadlines"), null);
		assert.equal(q("class-signature"), null);
		assert.equal(q("class-icon"), null);
		assert.equal(q("class-color"), null);
		assert.equal(q("class-save")!.textContent, "Add class");
	});
});

describe("Delete class", () => {
	it("drops the saved drafts of the class's lessons", async () => {
		const store = new Map([["lh:lesson-draft:l1", "{}"], ["lh:lesson-draft:l2", "{}"], ["lh:lesson-draft:other", "{}"]]);
		(globalThis as { localStorage?: unknown }).localStorage = { removeItem: (k: string) => store.delete(k) };
		try {
			fakeFetch();
			await mount({ kind: "edit", classId: "cls_a" });
			await click(q("class-delete"));
			assert.equal(q("class-dialog")!.getAttribute("aria-label"), "Delete CSE 21?");
			assert.match(q("class-delete-confirm")!.textContent!, /This cannot be undone\./);
			await click(q("class-delete-confirm-button"));
			await act(async () => {
				await new Promise((r) => setTimeout(r, 10));
			});
			assert.equal(`${calls[0]?.method} ${calls[0]?.url}`, "DELETE /api/classes/cls_a");
			assert.equal(closed, 1);
			assert.deepEqual([...store.keys()], ["lh:lesson-draft:other"], "another lesson's draft stays");
		} finally {
			delete (globalThis as { localStorage?: unknown }).localStorage;
		}
	});
});

describe("Esc on the class dialogs", () => {
	it("Esc closes the class dialog", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 1);
	});

	it("with unsaved changes, Esc and X ask \"Discard your changes?\" first", async () => {
		fakeFetch();
		await mount({ kind: "edit", classId: "cls_a" });
		await typeInto(q("class-name"), "CSE 21A");
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 0);
		assert.match(q("class-discard")!.textContent!, /Discard your changes\?What you changed here hasn't been saved\./);
		assert.equal(q("class-save"), null, "the question takes the footer's place");
		assert.equal(await pressEscape(), true, "Esc on the question keeps editing");
		assert.equal(q("class-discard"), null);
		assert.equal(closed, 0);
		await click(q("class-dialog-close"));
		await click(q("class-discard-keep"));
		assert.equal(q("class-discard"), null);
		assert.equal((q("class-name") as HTMLInputElement).value, "CSE 21A", "Keep editing keeps the edit");
		await click(q("class-dialog-close"));
		await click(q("class-discard-go"));
		assert.equal(closed, 1);
		assert.deepEqual(calls, [], "nothing saved");
	});

	it("Edit class shows Loading, not empty fields, until the class arrives", async () => {
		fakeFetch();
		const fallback = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/classes/cls_a" && (init?.method ?? "GET") === "GET") return new Promise<Response>(() => {});
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", classId: "cls_a" });
		assert.ok(q("class-dialog-loading"));
		assert.equal(q("class-name"), null);
		assert.equal((q("class-save") as HTMLButtonElement).disabled, true);
	});

	it("Edit class that can't load shows Try again in place of the fields, and Save is off", async () => {
		fakeFetch();
		const fallback = globalThis.fetch;
		let down = true;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (down && String(input) === "/api/classes/cls_a" && (init?.method ?? "GET") === "GET") return Response.json({ error: "boom" }, { status: 500 });
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", classId: "cls_a" });
		assert.match(q("load-failed")!.textContent!, /Couldn't load this class\./);
		assert.equal(q("class-name"), null);
		assert.equal((q("class-save") as HTMLButtonElement).disabled, true);
		down = false;
		await click(q("load-failed-retry"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.equal(q("load-failed"), null);
		assert.equal((q("class-name") as HTMLInputElement).value, "CSE 21");
		assert.equal((q("class-save") as HTMLButtonElement).disabled, false);
	});

	it("Add a class asks before throwing away a typed name", async () => {
		fakeFetch();
		await mount({ kind: "create" });
		await typeInto(q("class-name"), "MATH 20C");
		await click(q("class-dialog-close"));
		assert.equal(closed, 0);
		assert.match(q("class-discard")!.textContent!, /What you typed here hasn't been saved\./);
	});

	it("while Save runs, Esc is claimed but the dialog stays open and the close button is off", async () => {
		fakeFetch();
		const saving = Promise.withResolvers<void>();
		const fallback = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/classes/cls_a" && init?.method === "PUT") await saving.promise;
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", classId: "cls_a" });
		await typeInto(q("class-name"), "CSE 21A");
		await click(q("class-save"));
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 0);
		assert.equal((q("class-dialog-close") as HTMLButtonElement).disabled, true);
		assert.equal((q("class-delete") as HTMLButtonElement).disabled, true, "Delete class waits like Archive");
		assert.equal((q("class-name") as HTMLInputElement).disabled, true, "nothing typed mid-save is lost");
		assert.equal((q("class-description") as HTMLTextAreaElement).disabled, true);
		await act(async () => {
			saving.resolve();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.equal(closed, 1);
	});

	it("Esc closes the Move lesson dialog", async () => {
		fakeFetch();
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
		await act(async () => {
			root!.render(
				<ServerEventsProvider connect={connect as never}>
					<ClassProvider initialActive="cls_a">
						<MoveLessonDialog lesson={{ id: "chat_1", title: "Counting" }} onClose={() => closed++} onMoved={() => {}} />
					</ClassProvider>
				</ServerEventsProvider>,
			);
		});
		assert.ok(q("move-lesson-dialog"));
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 1);
	});
});
