/**
 * The Files page's Recent changes section: the first 8 changes, then
 * "Show N more" for the rest; removed files greyed. Mounted over linkedom.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { RecentChanges } = await import("../../src/frontend/components/files/recent-changes.tsx");

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
});

describe("recent changes section", () => {
	it("shows 8 changes, then the rest after Show N more", async () => {
		const changes = [
			{ change: "removed" as const, id: "gone", name: "Week4.pdf", at: "2026-11-05T19:00:00.000Z" },
			...Array.from({ length: 11 }, (_, i) => ({ change: "added" as const, id: `f${i}`, name: `HW${i}.pdf`, at: "2026-11-04T19:00:00.000Z" })),
		];
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => root!.render(<RecentChanges changes={changes} collapsed={false} onToggle={() => {}} />));
		const rows = () => document.querySelectorAll('[data-testid^="files-change-"]').length;
		assert.equal(rows(), 8);
		assert.match(document.querySelector('[data-testid="files-change-removed-gone"]')?.textContent ?? "", /Week4\.pdf.*Removed/);
		const more = document.querySelector<HTMLElement>('[data-testid="files-recent-changes-more"]')!;
		assert.equal(more.textContent, "Show 4 more");
		await act(async () => more.click());
		assert.equal(rows(), 12);
		assert.equal(document.querySelector('[data-testid="files-recent-changes-more"]'), null);
	});
});
