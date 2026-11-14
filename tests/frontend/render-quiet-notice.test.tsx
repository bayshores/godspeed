/**
 * The "no new files" corner notice: which spaces count as quiet (linked,
 * not closed, 4 days without a folder file, not snoozed), its words,
 * and its buttons. Mounted over linkedom.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceSummary } from "../../src/shared/core/contracts.ts";

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
const { QuietNoticeView } = await import("../../src/frontend/components/quiet-notice.tsx");
const { quietSpaces, quietLine, quietTitle, snoozeEnd } = await import("../../src/frontend/components/quiet-notice-model.ts");

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 6, 18, 0).getTime();
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const space = (id: string, extra: Partial<SpaceSummary>): SpaceSummary => ({
	id,
	name: id.toUpperCase(),
	description: "",
	createdAt: ago(60),
	updatedAt: ago(1),
	closed: false,
	fileCount: 3,
	color: 1,
	filesLeft: 0,
	...extra,
});

describe("quiet spaces", () => {
	const spaces = [
		space("quiet", { linkedFolder: "/drive/CSE 29", lastFolderFileAt: ago(4.1) }),
		space("fresh", { linkedFolder: "/drive/CSE 21", lastFolderFileAt: ago(3.9) }),
		space("by-hand", { lastFolderFileAt: undefined }),
		space("closed", { closed: true, linkedFolder: "/drive/old", lastFolderFileAt: ago(30) }),
		space("empty", { linkedFolder: "/drive/empty" }),
	];

	it("are linked, not closed, and 4 days without a new folder file", () => {
		assert.deepEqual(quietSpaces(spaces, {}, NOW).map((q) => q.spaceId), ["quiet"]);
	});

	it("stay hidden while snoozed, and come back when the snooze ends", () => {
		const snoozed = { quiet: snoozeEnd(NOW) };
		const quiet = (now: number) => quietSpaces(spaces, snoozed, now).some((q) => q.spaceId === "quiet");
		assert.equal(quiet(NOW + 4 * DAY - 1), false);
		assert.equal(quiet(NOW + 4 * DAY + 1), true);
	});

	it("say how many days, and the day the last file came", () => {
		const q = { spaceId: "c", name: "CSE 29", folder: "/d", lastAt: new Date(2026, 10, 2, 15, 40).toISOString() };
		assert.equal(quietTitle(q, NOW), "No new files in CSE 29 for 4 days");
		assert.equal(quietLine(q), "Last one came Mon, Nov 2.");
	});
});

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
});

describe("quiet notice", () => {
	const entry = { spaceId: "c", name: "CSE 29", folder: "/drive/CSE 29", lastAt: ago(4.5) };
	const mount = async (props: Partial<React.ComponentProps<typeof QuietNoticeView>>) => {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => root!.render(<QuietNoticeView quiet={[entry]} now={NOW} onSee={() => {}} onDismiss={() => {}} {...props} />));
	};
	const click = (id: string) => act(async () => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click());

	it("shows the space, and Show folder, See files and close report it", async () => {
		const calls: string[] = [];
		await mount({ onShowFolder: (e) => calls.push(`folder:${e.folder}`), onSee: (e) => calls.push(`see:${e.spaceId}`), onDismiss: (e) => calls.push(`close:${e.spaceId}`) });
		assert.match(document.querySelector('[data-testid="quiet-notice"]')?.textContent ?? "", /No new files in CSE 29 for 4 days/);
		await click("quiet-notice-folder");
		await click("quiet-notice-see");
		await click("quiet-notice-close");
		assert.deepEqual(calls, ["folder:/drive/CSE 29", "see:c", "close:c"]);
	});

	it("has no Show folder outside the desktop app", async () => {
		await mount({});
		assert.ok(document.querySelector('[data-testid="quiet-notice-folder"]') === null);
	});
});
