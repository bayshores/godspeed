/**
 * A deadline's mocks, mounted: "Take a mock" opens the mock box (questions
 * 1 to 10 from 5, no time limit unless picked, minutes 5 to 240 from 45),
 * "Write the mock" asks with what was picked and says why it failed; a
 * row's cross asks "Remove it?", Keep gives the focus back, Remove removes.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseHTML } from "linkedom";
import type { MockSummary } from "../../src/shared/core/index.ts";

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
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
// linkedom has no focus: remember what was last focused. Nodes are only
// compared with ===, since a failed assert.equal on one prints the whole tree.
let focused: Element | null = null;
(dom.window.HTMLElement.prototype as unknown as { focus: () => void }).focus = function (this: Element) {
	focused = this;
};

const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { PathMocks } = await import("../../src/frontend/components/deadline/path-mocks.tsx");

const GRADED: MockSummary = { id: "mock_1", deadlineId: "ddl_1", n: 1, state: "graded", format: { questions: 5 }, createdAt: "2026-10-30T09:00:00.000Z", endedAt: "2026-10-30T10:00:00.000Z", solved: 3, working: false };

let root: ReturnType<typeof createRoot> | undefined;
let written: Array<[number, number | null]> = [];
let removed: string[] = [];
let writeAnswer: string | null = null;

async function mount(mocks: readonly MockSummary[] = [GRADED]) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<MemoryRouter>
				<PathMocks
					spaceId="spc_1"
					mocks={mocks}
					failed={false}
					done={false}
					offReason={null}
					nowMs={Date.parse("2026-11-02T10:00:00")}
					onRetry={() => {}}
					onWrite={async (questions, minutes) => {
						written.push([questions, minutes]);
						return writeAnswer;
					}}
					onRemove={async (id) => {
						removed.push(id);
						return null;
					}}
				/>
			</MemoryRouter>,
		);
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
	await act(async () => el.dispatchEvent(new window.Event("focusout", { bubbles: true })));
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const value = (id: string) => (q(id) as HTMLInputElement).value;

afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
	written = [];
	removed = [];
	writeAnswer = null;
});

describe("the mock box", () => {
	it("opens with 5 questions and no time limit, and writes that", async () => {
		await mount();
		assert.ok(!q("mock-box"), "closed until asked for");
		await click(q("deadline-mock-take"));
		await settle();
		assert.equal(q("deadline-mock-take")!.getAttribute("aria-expanded"), "true");
		assert.equal(q("mock-box")!.getAttribute("role"), "dialog");
		assert.equal(value("mock-box-questions"), "5");
		assert.equal(q("mock-box-time-none")!.getAttribute("aria-checked"), "true");
		assert.ok(!q("mock-box-minutes"), "minutes only with a time limit");
		await click(q("mock-box-write"));
		await settle();
		assert.deepEqual(written, [[5, null]]);
	});

	it("steps and types within range, and a time limit sends its minutes", async () => {
		await mount();
		await click(q("deadline-mock-take"));
		await settle();
		await click(q("mock-box-questions-less"));
		assert.equal(value("mock-box-questions"), "4");
		await typeInto(q("mock-box-questions"), "40");
		assert.equal(value("mock-box-questions"), "10", "kept at most 10");
		assert.equal((q("mock-box-questions-more") as HTMLButtonElement).disabled, true);
		await click(q("mock-box-time-limit"));
		assert.equal(value("mock-box-minutes"), "45");
		await click(q("mock-box-minutes-more"));
		assert.equal(value("mock-box-minutes"), "50");
		await typeInto(q("mock-box-minutes"), "1");
		assert.equal(value("mock-box-minutes"), "5", "kept at least 5");
		await click(q("mock-box-write"));
		await settle();
		assert.deepEqual(written, [[10, 5]]);
	});

	it("says why a mock wasn't made and lets you try again", async () => {
		writeAnswer = "Finish Mock 1 first.";
		await mount();
		await click(q("deadline-mock-take"));
		await settle();
		await click(q("mock-box-write"));
		await settle();
		assert.equal(q("mock-box-error")!.textContent, "Finish Mock 1 first.");
		assert.equal((q("mock-box-write") as HTMLButtonElement).disabled, false);
	});
});

describe("removing a mock", () => {
	it("asks Remove it? in its row; Keep gives the focus back to the cross, Remove removes it", async () => {
		await mount();
		await click(q("deadline-mock-remove"));
		const row = q("deadline-mock-mock_1")!;
		assert.match(row.textContent!, /Mock 1Remove it\?RemoveKeep/);
		assert.ok(focused === q("deadline-mock-remove-confirm-keep"), "the question takes the focus");
		await click(q("deadline-mock-remove-confirm-keep"));
		assert.ok(focused === q("deadline-mock-remove"), "Keep gives the focus back to the cross");
		await click(q("deadline-mock-remove"));
		await click(q("deadline-mock-remove-confirm-go"));
		await settle();
		assert.deepEqual(removed, ["mock_1"]);
	});
});
