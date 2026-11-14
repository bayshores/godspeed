/**
 * The Edit space dialog, mounted over linkedom with a fake fetch: Save
 * writes only the fields the learner changed. The dialog has no file list
 * and no deadlines (those have their own tabs).
 */
import React, { act, useEffect } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceFile, SpaceRecord } from "../../src/shared/core/index.ts";

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
const { SpaceDialog } = await import("../../src/frontend/components/space-dialog.tsx");
const { MoveLessonDialog } = await import("../../src/frontend/components/lessons/move-lesson-dialog.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SpaceProvider, useSpaces } = await import("../../src/frontend/components/space-context.tsx");
const { useSpaceRecord } = await import("../../src/frontend/components/files/space-files-api.ts");
const { MemoryRouter, useLocation } = await import("react-router");

/** Where the window was sent. */
const pushed: string[] = [];
function Spy() {
	const { pathname, search } = useLocation();
	useEffect(() => {
		pushed.push(pathname + search);
	}, [pathname, search]);
	return null;
}

/** A space page behind the dialog: it reads the space the window is on. */
function SpacePage() {
	const { active } = useSpaces();
	useSpaceRecord(active);
	return null;
}

function file(id: string, name: string, kind: "study" | "info" = "study"): SpaceFile {
	return { id, origin: "copied", name, path: `${id}/${name}`, kind, contentFp: "", status: "ready", addedAt: "" };
}
const RECORD: SpaceRecord = {
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
/** Every GET, in order. */
const reads: string[] = [];
const originalFetch = globalThis.fetch;
/** The record the server holds now (an agent may change it mid-test). */
let served: SpaceRecord = RECORD;
/** The mounted dialog's server event handlers, by event name. */
const events = new Map<string, (raw: string) => void>();
function fakeFetch() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		if (method !== "GET") calls.push({ method, url, body });
		else reads.push(url);
		if (url === "/api/spaces") return Response.json({ spaces: [{ id: "cls_a", name: "CSE 21" }] });
		if (url === "/api/spaces/cls_a" && method === "GET") return Response.json({ space: served });
		if (url === "/api/spaces/cls_a" && method === "DELETE") return Response.json({ ok: true, lessonIds: ["l1", "l2"] });
		return Response.json({ ok: true });
	}) as typeof fetch;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
let closed = 0;
async function mount(mode: { kind: "create" } | { kind: "edit"; spaceId: string }) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent: (name: string, cb: (raw: string) => void) => events.set(name, cb), onOpen() {}, close() {} });
	await act(async () => {
		root!.render(
			<ServerEventsProvider connect={connect as never}>
				<MemoryRouter initialEntries={["/space"]}>
					<SpaceProvider initialActive="cls_a">
						<SpacePage />
						<SpaceDialog mode={mode} onClose={() => closed++} />
					</SpaceProvider>
					<Spy />
				</MemoryRouter>
			</ServerEventsProvider>,
		);
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
	pushed.length = 0;
}
/** A promise the test ends by hand. */
function held() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve: () => resolve() };
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
	reads.length = 0;
	pushed.length = 0;
	served = RECORD;
	events.clear();
	globalThis.fetch = originalFetch;
});

describe("Edit space dialog", () => {
	it("shows name and description, and no deadlines or file list", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.equal(q("space-dialog")!.getAttribute("aria-label"), "Edit space");
		assert.equal((q("space-name") as HTMLInputElement).value, "CSE 21");
		assert.equal(q("space-deadlines"), null, "deadlines moved to the Deadlines tab");
		assert.equal(q("space-files"), null, "the file list moved to the Files page");
		assert.ok(q("space-archive") && q("space-delete") && q("space-save"));
	});

	it("the signature: pick a kind, type one line, see it in the cover's type, save it", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.equal((q("space-signature") as HTMLInputElement).value, "");
		assert.equal(q("space-signature-preview"), null, "nothing typed, no preview");
		await click(q("space-signature-kind-code"));
		await typeInto(q("space-signature"), "int *p = &x;");
		assert.match(q("space-signature-preview")!.innerHTML, /font-mono/);
		await click(q("space-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(calls[0], {
			method: "PUT",
			url: "/api/spaces/cls_a",
			body: { signature: { kind: "code", value: "int *p = &x;" } },
		});
	});

	it("Save writes only the learner's edits, never undoing an agent's change made while the dialog was open", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		const [midterm, , final] = RECORD.deadlines!;
		// The agent moves Midterm 1, removes HW 1, adds Quiz 1 and sets a signature.
		served = {
			...RECORD,
			signature: { kind: "math", value: "n choose k" },
			deadlines: [{ ...midterm!, date: "2026-10-30" }, final!, { id: "ddl_9", kind: "quiz", name: "Quiz 1", date: "2026-11-05", fileIds: [], done: false }],
		};
		assert.ok(events.has("spaces-changed"));
		await act(async () => {
			events.get("spaces-changed")!("{}");
			await new Promise((r) => setTimeout(r, 20));
		});
		// The learner only renames the space.
		await typeInto(q("space-name"), "CSE 21A");
		await click(q("space-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(calls, [{ method: "PUT", url: "/api/spaces/cls_a", body: { name: "CSE 21A" } }]);
		assert.equal(closed, 1);
	});

	it("the icon: pick a subject icon and save it", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.equal(q("space-icon-sigma")!.getAttribute("aria-checked"), "false");
		await click(q("space-icon-sigma"));
		assert.equal(q("space-icon-sigma")!.getAttribute("aria-checked"), "true");
		await click(q("space-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.equal((calls[0] as { body: { icon?: string } }).body.icon, "sigma");
	});

	it("the color: the space's color is picked, another one saves", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.equal(q("space-color-2")!.getAttribute("aria-checked"), "true");
		await click(q("space-color-5"));
		assert.equal(q("space-color-5")!.getAttribute("aria-checked"), "true");
		await click(q("space-save"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual((calls[0] as { body: unknown }).body, { color: 5 });
	});

	it("Edit space says the agent picks the icon", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.match(q("space-dialog")!.textContent!, /Your agent picks one when it sets up the space\./);
	});

	it("Add a space: name and description only", async () => {
		fakeFetch();
		await mount({ kind: "create" });
		assert.equal(q("space-dialog")!.getAttribute("aria-label"), "Add a space");
		assert.equal(q("space-deadlines"), null);
		assert.equal(q("space-signature"), null);
		assert.equal(q("space-icon"), null);
		assert.equal(q("space-color"), null);
		assert.equal(q("space-save")!.textContent, "Add space");
	});
});

describe("Delete space", () => {
	it("drops the saved drafts of the space's lessons", async () => {
		const store = new Map([["lh:lesson-draft:l1", "{}"], ["lh:lesson-draft:l2", "{}"], ["lh:lesson-draft:other", "{}"]]);
		(globalThis as { localStorage?: unknown }).localStorage = { removeItem: (k: string) => store.delete(k) };
		try {
			fakeFetch();
			await mount({ kind: "edit", spaceId: "cls_a" });
			await click(q("space-delete"));
			assert.equal(q("space-dialog")!.getAttribute("aria-label"), "Delete CSE 21?");
			assert.match(q("space-delete-confirm")!.textContent!, /This cannot be undone\./);
			assert.doesNotMatch(q("space-delete-confirm")!.textContent!, /mocks/, "an ordinary space has none");
			await click(q("space-delete-confirm-button"));
			await act(async () => {
				await new Promise((r) => setTimeout(r, 10));
			});
			assert.ok(calls.some((c) => `${c.method} ${c.url}` === "DELETE /api/spaces/cls_a"));
			assert.equal(closed, 1);
			assert.deepEqual([...store.keys()], ["lh:lesson-draft:other"], "another lesson's draft stays");
		} finally {
			delete (globalThis as { localStorage?: unknown }).localStorage;
		}
	});
});

describe("Delete space, while the server deletes it", () => {
	it("leaves the space first, so nothing asks for it again, then goes to Today", async () => {
		fakeFetch();
		const deleting = held();
		const fallback = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/spaces/cls_a" && init?.method === "DELETE") await deleting.promise;
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", spaceId: "cls_a" });
		await click(q("space-delete"));
		await click(q("space-delete-confirm-button"));
		const before = reads.length;
		// The server says the spaces changed before its answer arrives.
		await act(async () => {
			events.get("spaces-changed")?.("{}");
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.ok(q("space-delete-confirm"), "the question stays while it runs");
		await act(async () => {
			deleting.resolve();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(
			reads.slice(before).filter((url) => url.startsWith("/api/spaces/cls_a")),
			[],
			"neither the dialog nor the page behind it reads the deleted space",
		);
		assert.deepEqual(pushed, ["/"], "to Today");
		assert.equal(closed, 1);
		assert.ok(calls.some((c) => c.url === "/api/settings/general" && (c.body as { activeSpace?: string }).activeSpace === "none"));
	});

	it("comes back to the space when the delete is refused", async () => {
		fakeFetch();
		const fallback = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/spaces/cls_a" && init?.method === "DELETE") return Response.json({ error: "Counting: a turn is running" }, { status: 409 });
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", spaceId: "cls_a" });
		await click(q("space-delete"));
		await click(q("space-delete-confirm-button"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.match(q("space-dialog-error")!.textContent!, /a turn is running/);
		assert.deepEqual(pushed, []);
		assert.equal(closed, 0);
		const settings = calls.filter((c) => c.url === "/api/settings/general").map((c) => (c.body as { activeSpace?: string }).activeSpace);
		assert.deepEqual(settings, ["none", "cls_a"], "back on the space");
	});
});

describe("Esc on the space dialogs", () => {
	it("Esc closes the space dialog", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 1);
	});

	it("with unsaved changes, Esc and X ask \"Discard your changes?\" first", async () => {
		fakeFetch();
		await mount({ kind: "edit", spaceId: "cls_a" });
		await typeInto(q("space-name"), "CSE 21A");
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 0);
		assert.match(q("space-discard")!.textContent!, /Discard your changes\?What you changed here hasn't been saved\./);
		assert.equal(q("space-save"), null, "the question takes the footer's place");
		assert.equal(await pressEscape(), true, "Esc on the question keeps editing");
		assert.equal(q("space-discard"), null);
		assert.equal(closed, 0);
		await click(q("space-dialog-close"));
		await click(q("space-discard-keep"));
		assert.equal(q("space-discard"), null);
		assert.equal((q("space-name") as HTMLInputElement).value, "CSE 21A", "Keep editing keeps the edit");
		await click(q("space-dialog-close"));
		await click(q("space-discard-go"));
		assert.equal(closed, 1);
		assert.deepEqual(calls, [], "nothing saved");
	});

	it("Edit space shows Loading, not empty fields, until the space arrives", async () => {
		fakeFetch();
		const fallback = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/spaces/cls_a" && (init?.method ?? "GET") === "GET") return new Promise<Response>(() => {});
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.ok(q("space-dialog-loading"));
		assert.equal(q("space-name"), null);
		assert.equal((q("space-save") as HTMLButtonElement).disabled, true);
	});

	it("Edit space that can't load shows Try again in place of the fields, and Save is off", async () => {
		fakeFetch();
		const fallback = globalThis.fetch;
		let down = true;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (down && String(input) === "/api/spaces/cls_a" && (init?.method ?? "GET") === "GET") return Response.json({ error: "boom" }, { status: 500 });
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", spaceId: "cls_a" });
		assert.match(q("load-failed")!.textContent!, /Couldn't load this space\./);
		assert.equal(q("space-name"), null);
		assert.equal((q("space-save") as HTMLButtonElement).disabled, true);
		down = false;
		await click(q("load-failed-retry"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.equal(q("load-failed"), null);
		assert.equal((q("space-name") as HTMLInputElement).value, "CSE 21");
		assert.equal((q("space-save") as HTMLButtonElement).disabled, false);
	});

	it("Add a space asks before throwing away a typed name", async () => {
		fakeFetch();
		await mount({ kind: "create" });
		await typeInto(q("space-name"), "MATH 20C");
		await click(q("space-dialog-close"));
		assert.equal(closed, 0);
		assert.match(q("space-discard")!.textContent!, /What you typed here hasn't been saved\./);
	});

	it("while Save runs, Esc is claimed but the dialog stays open and the close button is off", async () => {
		fakeFetch();
		const saving = held();
		const fallback = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/spaces/cls_a" && init?.method === "PUT") await saving.promise;
			return fallback(input, init);
		}) as typeof fetch;
		await mount({ kind: "edit", spaceId: "cls_a" });
		await typeInto(q("space-name"), "CSE 21A");
		await click(q("space-save"));
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 0);
		assert.equal((q("space-dialog-close") as HTMLButtonElement).disabled, true);
		assert.equal((q("space-delete") as HTMLButtonElement).disabled, true, "Delete space waits like Archive");
		assert.equal((q("space-name") as HTMLInputElement).disabled, true, "nothing typed mid-save is lost");
		assert.equal((q("space-description") as HTMLTextAreaElement).disabled, true);
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
					<SpaceProvider initialActive="cls_a">
						<MoveLessonDialog lesson={{ id: "chat_1", title: "Counting" }} onClose={() => closed++} onMoved={() => {}} />
					</SpaceProvider>
				</ServerEventsProvider>,
			);
		});
		assert.ok(q("move-lesson-dialog"));
		assert.equal(await pressEscape(), true);
		assert.equal(closed, 1);
	});
});
