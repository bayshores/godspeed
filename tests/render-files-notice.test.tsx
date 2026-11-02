/**
 * The "new files" corner notice: one entry per class that later scans
 * join, its title and names, See files and close. Mounted over linkedom.
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
const { FilesNoticeView } = await import("../src/components/files-notice.tsx");
const { addedNames, addedTitle, mergeAdded } = await import("../src/components/files-notice-model.ts");

type Kind = "study" | "info";
const file = (id: string, name: string, kind: Kind = "study") => ({ id, name, kind });

describe("new files notice model", () => {
	it("merges scans into one entry per class, a file counted once", () => {
		let list = mergeAdded([], { classId: "a", files: [file("1", "Day1.pdf")] });
		list = mergeAdded(list, { classId: "b", files: [file("9", "HW1.pdf", "info")] });
		list = mergeAdded(list, { classId: "a", files: [file("1", "Day1.pdf"), file("2", "Day2.pdf")] });
		assert.deepEqual(list.map((e) => [e.classId, e.files.map((f) => f.id)]), [["a", ["1", "2"]], ["b", ["9"]]]);
	});

	it("says how many, and that study material waits when no agent is connected", () => {
		const study = { classId: "a", files: [file("1", "Day1.pdf"), file("2", "Day2.pdf"), file("3", "HW5.pdf", "info")] };
		const info = { classId: "a", files: [file("3", "HW5.pdf", "info")] };
		assert.equal(addedTitle(study, "CSE 21", true), "3 new files in CSE 21");
		assert.equal(addedTitle(study, "CSE 21", false), "3 new files in CSE 21 · read when your agent connects");
		assert.equal(addedTitle(info, "CSE 21", false), "1 new file in CSE 21", "course info needs no agent");
		assert.equal(addedNames(study.files), "Day1.pdf and 2 more");
		assert.equal(addedNames(study.files.slice(0, 2)), "Day1.pdf and Day2.pdf");
		assert.equal(addedNames(info.files), "HW5.pdf");
	});
});

let root: Root | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	document.body.innerHTML = "";
});

describe("new files notice", () => {
	it("shows one card per known class; See files and close report the class", async () => {
		const seen: string[] = [];
		const closed: string[] = [];
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () =>
			root!.render(
				<FilesNoticeView
					added={[
						{ classId: "a", files: [file("1", "Lecture11.srt"), file("2", "Lecture12.srt"), file("3", "HW5.pdf", "info")] },
						{ classId: "gone", files: [file("4", "x.pdf")] },
					]}
					agentConnected={false}
					nameOf={(id) => (id === "a" ? "CSE 21" : null)}
					onSee={(id) => seen.push(id)}
					onDismiss={(id) => closed.push(id)}
				/>,
			),
		);
		const cards = document.querySelectorAll('[data-testid="files-notice"]');
		assert.equal(cards.length, 1, "a deleted class's entry is hidden");
		assert.match(cards[0]!.textContent ?? "", /3 new files in CSE 21 · read when your agent connects/);
		assert.match(cards[0]!.textContent ?? "", /Lecture11\.srt and 2 more/);
		assert.match(cards[0]!.textContent ?? "", /See files/);
		await act(async () => document.querySelector<HTMLElement>('[data-testid="files-notice-see"]')!.click());
		await act(async () => document.querySelector<HTMLElement>('[data-testid="files-notice-close"]')!.click());
		assert.deepEqual([seen, closed], [["a"], ["a"]]);
	});
});
