/**
 * Rules an agent saved, in the window: the chat line ("Saved a rule for
 * every lesson: …" with Undo and Edit), the corner notice for a rule saved
 * from the terminal, and the "Saved by Halley" label in a rule list.
 * Mounted over linkedom with a fake fetch.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";

const dom = parseHTML("<!doctype html><html><body></body></html>");
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
const { RuleSavedLine } = await import("../src/components/artifacts/rule-saved-line.tsx");
const { RuleNotice } = await import("../src/components/rule-notice.tsx");
const { RuleChips } = await import("../src/components/rule-chips.tsx");
const { ServerEventsProvider } = await import("../src/components/server-events.tsx");

const posts: unknown[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
	const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { action: string; newText?: string }) : null;
	if (body) posts.push(body);
	if (body?.action === "edit") return Response.json({ ok: true, rule: body.newText });
	return Response.json({ ok: true });
}) as typeof fetch;

let root: Root | undefined;
const events = new Map<string, (raw: string) => void>();
async function mount(node: React.ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent: (name: string, cb: (raw: string) => void) => events.set(name, cb), onOpen() {}, close() {} });
	await act(async () => root!.render(<ServerEventsProvider connect={connect as never}>{node}</ServerEventsProvider>));
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

afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
	posts.length = 0;
});
process.on("exit", () => {
	globalThis.fetch = originalFetch;
});

const PART = {
	type: "tool-save_rule",
	state: "output-available",
	toolCallId: "t1",
	output: { saved: true, rule: "Use Python for code examples.", for: "every lesson", where: { area: "teaching" }, note: "Saved." },
};

describe("the chat line", () => {
	it("says what was saved, and Undo removes it", async () => {
		await mount(<RuleSavedLine part={PART} />);
		assert.match(q("rule-saved")!.textContent!, /Saved a rule for every lesson: Use Python for code examples\.UndoEdit/);
		await click(q("rule-saved-undo"));
		assert.deepEqual(posts, [{ action: "remove", where: { area: "teaching" }, text: "Use Python for code examples." }]);
		assert.match(q("rule-saved")!.textContent!, /Removed the rule: Use Python for code examples\./);
	});

	it("Edit opens a text box; Save writes the new rule", async () => {
		await mount(<RuleSavedLine part={PART} />);
		await click(q("rule-saved-edit"));
		await typeInto(q("saved-rule-input"), "Use Python 3 for code examples.");
		await click(q("saved-rule-save"));
		assert.deepEqual(posts, [{ action: "edit", where: { area: "teaching" }, text: "Use Python for code examples.", newText: "Use Python 3 for code examples." }]);
		assert.match(q("rule-saved")!.textContent!, /every lesson: Use Python 3 for code examples\./);
	});

	it("renders nothing for a refusal", async () => {
		await mount(<RuleSavedLine part={{ ...PART, output: "That list is full." }} />);
		assert.equal(q("rule-saved"), null);
	});
});

describe("the terminal notice", () => {
	it("shows when an outside agent saves a rule, with Undo and Edit", async () => {
		await mount(<RuleNotice />);
		assert.equal(q("rule-notice"), null);
		const saved = { text: "Shorter answers.", where: { area: "voice" }, label: "Every lesson, under Voice", agent: "Claude Code" };
		await act(async () => events.get("rules-changed")!(JSON.stringify({ saved })));
		assert.match(q("rule-notice")!.textContent!, /Claude Code saved a ruleShorter answers\.Every lesson, under VoiceUndoEdit/);
		await click(q("rule-notice-undo"));
		assert.deepEqual(posts, [{ action: "remove", where: { area: "voice" }, text: "Shorter answers." }]);
		assert.match(q("rule-notice")!.textContent!, /Rule removed/);
	});

	it("stays hidden for changes made in the window", async () => {
		await mount(<RuleNotice />);
		await act(async () => events.get("rules-changed")!(JSON.stringify({})));
		assert.equal(q("rule-notice"), null);
	});
});

describe("the Settings label", () => {
	it("marks only the rules the agent saved", () => {
		const html = renderToStaticMarkup(
			<RuleChips rules={["Mine.", "Use Python."]} onChange={() => {}} saved={{ "Use Python.": "2026-10-30T12:00:00.000Z" }} teacherName="Halley" />,
		);
		assert.equal(html.match(/Saved by Halley</g)?.length, 1);
		assert.match(html, /title="Saved by Halley on Oct 30"/);
	});
});
