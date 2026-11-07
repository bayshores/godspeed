/**
 * The folder corner notices: one entry per class and change (new or
 * removed files) that later scans join, its title and names, See files /
 * See changes and close. Mounted over linkedom.
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
const { FilesNoticeView } = await import("../../src/frontend/components/files-notice.tsx");
const { changeNames, changeTitle, mergeChange } = await import("../../src/frontend/components/files-notice-model.ts");

type Kind = "study" | "info";
const file = (id: string, name: string, kind: Kind = "study") => ({ id, name, kind });

const added = (classId: string, files: ReturnType<typeof file>[]) => ({ classId, change: "added" as const, files });
const removed = (classId: string, files: { id: string; name: string }[]) => ({ classId, change: "removed" as const, files });

describe("folder notice model", () => {
	it("merges scans into one entry per class and change, a file counted once", () => {
		let list = mergeChange([], added("a", [file("1", "Day1.pdf")]));
		list = mergeChange(list, added("b", [file("9", "HW1.pdf", "info")]));
		list = mergeChange(list, removed("a", [{ id: "7", name: "Old.pdf" }]));
		list = mergeChange(list, added("a", [file("1", "Day1.pdf"), file("2", "Day2.pdf")]));
		assert.deepEqual(
			list.map((e) => [e.classId, e.change, e.files.map((f) => f.id)]),
			[["a", "added", ["1", "2"]], ["b", "added", ["9"]], ["a", "removed", ["7"]]],
		);
	});

	it("says how many files were removed", () => {
		assert.equal(changeTitle(removed("a", [{ id: "7", name: "Old.pdf" }]), "CSE 21", false), "1 file removed from CSE 21");
		assert.equal(changeTitle(removed("a", [{ id: "7", name: "a" }, { id: "8", name: "b" }]), "CSE 21", true), "2 files removed from CSE 21");
	});

	it("says how many, and that study material waits when no agent is connected", () => {
		const study = added("a", [file("1", "Day1.pdf"), file("2", "Day2.pdf"), file("3", "HW5.pdf", "info")]);
		const info = added("a", [file("3", "HW5.pdf", "info")]);
		assert.equal(changeTitle(study, "CSE 21", true), "3 new files in CSE 21");
		assert.equal(changeTitle(study, "CSE 21", false), "3 new files in CSE 21 · read when your agent connects");
		assert.equal(changeTitle(info, "CSE 21", false), "1 new file in CSE 21", "course info needs no agent");
		assert.equal(changeNames(study.files), "Day1.pdf and 2 more");
		assert.equal(changeNames(study.files.slice(0, 2)), "Day1.pdf and Day2.pdf");
		assert.equal(changeNames(info.files), "HW5.pdf");
	});
});

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
});

describe("folder notices", () => {
	it("shows one card per known class and change; See and close report the entry", async () => {
		const seen: string[] = [];
		const closed: string[] = [];
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () =>
			root!.render(
				<FilesNoticeView
					changes={[
						added("a", [file("1", "Lecture11.srt"), file("2", "Lecture12.srt"), file("3", "HW5.pdf", "info")]),
						added("gone", [file("4", "x.pdf")]),
						removed("a", [{ id: "5", name: "Week4.pdf" }]),
					]}
					agentConnected={false}
					nameOf={(id) => (id === "a" ? "CSE 21" : null)}
					onSee={(e) => seen.push(`${e.classId}:${e.change}`)}
					onDismiss={(e) => closed.push(`${e.classId}:${e.change}`)}
				/>,
			),
		);
		const cards = document.querySelectorAll('[data-testid="files-notice-added"]');
		assert.equal(cards.length, 1, "a deleted class's entry is hidden");
		const gone = document.querySelector('[data-testid="files-notice-removed"]');
		assert.match(gone?.textContent ?? "", /1 file removed from CSE 21/);
		assert.match(gone?.textContent ?? "", /Week4\.pdf/);
		assert.match(gone?.textContent ?? "", /See changes/);
		assert.match(cards[0]!.textContent ?? "", /3 new files in CSE 21 · read when your agent connects/);
		assert.match(cards[0]!.textContent ?? "", /Lecture11\.srt and 2 more/);
		assert.match(cards[0]!.textContent ?? "", /See files/);
		await act(async () => document.querySelector<HTMLElement>('[data-testid="files-notice-see"]')!.click());
		await act(async () => document.querySelector<HTMLElement>('[data-testid="files-notice-close"]')!.click());
		assert.deepEqual([seen, closed], [["a:added"], ["a:added"]]);
	});
});
