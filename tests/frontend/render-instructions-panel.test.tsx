/**
 * The instructions panel sends one request at a time (Save and Reset wait
 * for it), and a request that never reaches the app shows the panel's
 * own "Could not save" line instead of failing silently. Reset and leaving
 * with unsaved text ask first.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body><div id='root'></div></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	// The row of parts follows its tabs' sizes; linkedom lays nothing out.
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});

const { createRoot } = await import("react-dom/client");
const { InstructionsPanel } = await import("../../src/frontend/components/settings/instructions-panel.tsx");

const area = { id: "voice", label: "Voice", about: "", parts: ["shared/10-voice.md"] } as const;
const part: { path: string; sourceText: string; overrideText: string | null; shared: boolean } = { path: "shared/10-voice.md", sourceText: "Original", overrideText: "Mine", shared: true };

function buttons() {
	const all = [...document.querySelectorAll<HTMLButtonElement>("footer button")];
	return { reset: all[0]!, save: all[1]! };
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (id: string) => act(async () => q(id)!.click());
async function type(text: string) {
	const el = q("instructions-editor")!;
	await act(async () => {
		Object.defineProperty(el, "value", { configurable: true, writable: true, value: text });
		el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
}
async function pressEscape() {
	const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
	Object.assign(esc, { key: "Escape" });
	await act(async () => {
		document.dispatchEvent(esc);
	});
}

let root: ReturnType<typeof createRoot> | undefined;
let closed = 0;
let methods: string[] = [];
async function mount(parts: (typeof part)[]) {
	globalThis.fetch = (async (_url: string, init?: RequestInit) => {
		methods.push(init?.method ?? "GET");
		return new Response(null, { status: 200 });
	}) as typeof fetch;
	root = createRoot(document.getElementById("root")!);
	await act(async () => root!.render(<InstructionsPanel area={{ ...area }} parts={parts} teacherName="Teacher" onChanged={() => {}} onClose={() => closed++} />));
}
afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	closed = 0;
	methods = [];
});

describe("InstructionsPanel", () => {
	it("disables Save and Reset while a request runs, and shows a failed one", async () => {
		let finish: (res: Response) => void = () => {};
		let fail = false;
		globalThis.fetch = (() => (fail ? Promise.reject(new TypeError("offline")) : new Promise<Response>((resolve) => (finish = resolve)))) as typeof fetch;
		root = createRoot(document.getElementById("root")!);
		await act(async () => root!.render(<InstructionsPanel area={{ ...area }} parts={[part]} teacherName="Teacher" onChanged={() => {}} onClose={() => {}} />));

		await act(async () => buttons().reset.click());
		await click("instructions-reset-go");
		assert.equal(buttons().reset.disabled, true, "Reset waits for its request");
		assert.equal(buttons().save.disabled, true);
		await act(async () => finish(new Response(null, { status: 500 })));
		assert.equal(buttons().reset.disabled, false);
		assert.match(document.querySelector("footer")!.textContent!, /Could not reset\. Try again\./);

		fail = true;
		await act(async () => buttons().reset.click());
		await click("instructions-reset-go");
		assert.match(document.querySelector("footer")!.textContent!, /Could not reset\. Try again\./, "an unreachable app is a failure too");
		assert.equal(buttons().reset.disabled, false);
	});

	it("Reset to original asks first: the first click deletes nothing, Cancel goes back, Reset deletes", async () => {
		await mount([part]);
		await act(async () => buttons().reset.click());
		assert.match(q("instructions-reset")!.textContent!, /Reset to the original\?Your version is deleted\.CancelReset/);
		assert.deepEqual(methods, []);
		await click("instructions-reset-keep");
		assert.equal(q("instructions-reset"), null);
		assert.deepEqual(methods, []);
		await act(async () => buttons().reset.click());
		await click("instructions-reset-go");
		assert.deepEqual(methods, ["DELETE"]);
		assert.equal(q("instructions-reset"), null);
	});

	it("Reset on typed text with no saved version asks the quiet way and drops the text", async () => {
		await mount([{ ...part, overrideText: null }]);
		await type("Typed");
		await act(async () => buttons().reset.click());
		assert.match(q("instructions-discard")!.textContent!, /Discard your changes\?Keep editingDiscard/);
		assert.equal((q("instructions-editor") as unknown as HTMLTextAreaElement).value, "Typed");
		await click("instructions-discard-keep");
		assert.equal((q("instructions-editor") as unknown as HTMLTextAreaElement).value, "Typed");
		await act(async () => buttons().reset.click());
		await click("instructions-discard-go");
		assert.equal((q("instructions-editor") as unknown as HTMLTextAreaElement).value, "Original");
		assert.deepEqual(methods, []);
		assert.equal(closed, 0);
	});

	it("Escape and Back leave at once when nothing is typed", async () => {
		await mount([part]);
		await pressEscape();
		assert.equal(closed, 1);
		await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
		assert.equal(closed, 2);
	});

	it("leaving with unsaved text asks first; Keep editing keeps the text, Escape on the question too, Discard leaves", async () => {
		await mount([part]);
		await type("Typed");
		await pressEscape();
		assert.equal(closed, 0);
		assert.match(q("instructions-discard")!.textContent!, /Discard your changes\?Keep editingDiscard/);
		await click("instructions-discard-keep");
		assert.equal(q("instructions-discard"), null);
		assert.equal((q("instructions-editor") as unknown as HTMLTextAreaElement).value, "Typed");
		await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
		assert.ok(q("instructions-discard"));
		await pressEscape();
		assert.equal(q("instructions-discard"), null, "Escape on the question keeps editing");
		assert.equal(closed, 0);
		await pressEscape();
		await click("instructions-discard-go");
		assert.equal(closed, 1);
	});

	it("text typed in another part also asks before leaving, and switching parts keeps it", async () => {
		const other = { ...part, path: "shared/20-other.md", sourceText: "Other", overrideText: null };
		await mount([part, other]);
		await type("Typed");
		await act(async () => document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click());
		assert.equal(q("instructions-discard"), null);
		await pressEscape();
		assert.ok(q("instructions-discard"));
	});
});
