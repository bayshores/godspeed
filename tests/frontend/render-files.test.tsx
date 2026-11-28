/**
 * The Files page, mounted over linkedom with a fake fetch: groups from the
 * file names with counts, the linked folder, each row's kind and state
 * (coverage bar, Building facts, Failed + Retry), Move and Unlink writing
 * through the space routes, Add files and the Finder drop targets, search
 * and folded groups, picking files and starting a lesson on them from the
 * picked bar.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceFile, SpaceRecord, FileCoverage, FileWork } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	// The More menu and the folder box place themselves on the next frame.
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});
// linkedom has no focus: remember what was last focused.
let focused: Element | null = null;
(dom.window.HTMLElement.prototype as unknown as { focus: () => void }).focus = function (this: Element) {
	focused = this;
};
Object.defineProperty(dom.document, "activeElement", { get: () => (focused?.isConnected ? focused : dom.document.body) });
// Find selects its field on opening; linkedom has no select().
(dom.window.HTMLElement.prototype as unknown as { select: () => void }).select = () => {};
// React reads the selection when focus moves between its fields.
Object.assign(dom.window, { getSelection: () => ({}) });
// linkedom has no localStorage: a plain one remembers folded groups.
const stored = new Map<string, string>();
Object.defineProperty(dom.window, "localStorage", {
	configurable: true,
	value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), clear: () => stored.clear() },
});

// react-dom reads the DOM globals when it loads: import it after them.
// linkedom's document has no "oninput"; without it React would fall back
// to an old-IE way of watching text fields.
(dom.document as unknown as { oninput: null }).oninput = null;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router");
const { FilesPage } = await import("../../src/frontend/components/files/files-page.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ProgressProvider } = await import("../../src/frontend/components/use-progress.tsx");
const { CopyButton } = await import("../../src/frontend/components/copy-button.tsx");
const { BarHost } = await import("../bar-host.tsx");
const { kbdEventForAction } = await import("../../src/shared/core/index.ts");
const { FULL_LINE } = await import("../../src/frontend/components/files/files-pick-model.ts");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
type TeacherApi = import("../../src/frontend/components/teacher/teacher-context.ts").TeacherApi;

function file(id: string, name: string, over: Partial<SpaceFile> = {}): SpaceFile {
	return { id, origin: "copied", name, path: `${id}/${name}`, kind: "study", contentFp: "", status: "ready", addedAt: "", ...over };
}

const RECORD: SpaceRecord = {
	id: "cls_a",
	name: "CSE 21",
	description: "",
	color: 1,
	createdAt: "",
	updatedAt: "",
	closed: false,
	linkedFolder: "/Users/me/School/CSE 21",
	files: [
		file("f1", "Lecture 1 — Counting.pdf"),
		file("f2", "Rosen 6.2 — Probability theory.pdf", { origin: "linked", path: "Readings/Rosen 6.2 — Probability theory.pdf", foundByScan: true, addedAt: new Date().toISOString() }),
		file("f3", "Rosen 7.1 — Discrete probability.pdf", { status: "extracting" }),
		file("f4", "Week 4 Discussion.srt", { status: "failed", error: "no audio" }),
		file("f5", "Syllabus.pdf", { kind: "info" }),
		file("f6", "Lecture 5.mp3", { status: "needs-whisper", error: "Recordings need whisper.cpp" }),
		file("f7", "Lecture 6.pdf", { status: "pending" }),
	],
};
const COVERAGE: FileCoverage[] = [
	{ fileId: "f1", name: "Lecture 1 — Counting.pdf", displayName: "Lecture 1 — Counting", facts: 31, inLessons: 31, share: 1 },
	{ fileId: "f2", name: "Rosen 6.2 — Probability theory.pdf", displayName: "Rosen 6.2 — Probability theory", facts: 22, inLessons: 0, share: 0 },
];

/** The progress payload's file work; none unless a test sets it. */
let fileWork: FileWork[] = [];

const calls: { method: string; url: string; body?: unknown }[] = [];
let record = RECORD;
/** What POST /api/chats answers. */
let started: Response | (() => Response) = () => Response.json({ id: "chat_new", title: "Rosen 6.2 — Probability theory" });
/** Every place the router went. */
const went: string[] = [];
let folderProblem: string | null = null;
let recordFails = false;
let recordReads = 0;
const originalFetch = globalThis.fetch;
function fakeFetch() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method !== "GET") calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
		if (url === "/api/spaces") return Response.json({ spaces: [{ id: "cls_a", name: "CSE 21" }] });
		if (url.startsWith("/api/spaces/cls_a") && method === "GET") {
			recordReads++;
			return recordFails ? Response.json({ error: "boom" }, { status: 500 }) : Response.json({ space: record, folder: { problem: folderProblem, checkedAt: null, settling: 0 } });
		}
		if (url.startsWith("/api/progress")) return Response.json({ spaceId: "cls_a", files: COVERAGE, fileWork });
		if (url === "/api/chats" && method === "POST") return typeof started === "function" ? started() : started;
		return Response.json({ ok: true });
	}) as typeof fetch;
}

/** The server event handlers the page listens with. */
const events = new Map<string, (raw: string) => void>();

let root: Root | undefined;
let host: HTMLElement | undefined;
/** `teacher`: the lines a page key hands the teacher, when the page can (canAsk). */
async function mount(initialActive: string | null = "cls_a", teacher: { canAsk: boolean; lines: string[] } | null = null) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent: (name: string, cb: (raw: string) => void) => events.set(name, cb), onOpen() {}, close() {} });
	function Where() {
		const { pathname, search } = useLocation();
		if (went.at(-1) !== pathname + search) went.push(pathname + search);
		return null;
	}
	await act(async () => {
		root!.render(
			<MemoryRouter initialEntries={["/files"]}>
				<Where />
				<ServerEventsProvider connect={connect as never}>
					<SpaceProvider initialActive={initialActive}>
						<ProgressProvider>
							<BarHost>
								{teacher ? (
									<TeacherContext.Provider value={{ name: "Ada", canAsk: teacher.canAsk, ask: (line) => void teacher.lines.push(line) } as TeacherApi}>
										<FilesPage />
									</TeacherContext.Provider>
								) : (
									<FilesPage />
								)}
							</BarHost>
						</ProgressProvider>
					</SpaceProvider>
				</ServerEventsProvider>
			</MemoryRouter>,
		);
	});
	// Let the record + progress fetches land.
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
	return host;
}
/** Type into a text field the way a keyboard does. React loaded before this DOM existed, so it
 *  takes its old-browser path for text fields: it watches the focused field and reads it on a key-up. */
async function typeInto(input: HTMLInputElement, value: string) {
	input.setAttribute("type", "text"); // linkedom gives a field with no type attribute a null type
	await act(async () => {
		input.dispatchEvent(new window.Event("focusin", { bubbles: true }));
		Object.defineProperty(input, "value", { configurable: true, writable: true, value });
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
		input.dispatchEvent(new window.Event("keyup", { bubbles: true }));
	});
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	calls.length = 0;
	record = RECORD;
	fileWork = [];
	started = () => Response.json({ id: "chat_new", title: "Rosen 6.2 — Probability theory" });
	went.length = 0;
	folderProblem = null;
	recordFails = false;
	recordReads = 0;
	globalThis.fetch = originalFetch;
	stored.clear();
	mock.timers.reset();
});

describe("FilesPage", () => {
	it("shows the linked folder, the summary, groups from the names with counts, and each row's kind and state", async () => {
		fakeFetch();
		await mount();
		assert.ok(q("space-pick-folder") === null, "a linked space shows its folder, not Link a folder");
		assert.ok(q("space-add-files"));
		assert.equal(q("space-folder-status")!.textContent, "Watching CSE 21");
		const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
		assert.equal(q("files-summary")!.textContent, `6 study material, 1 space info, 1 new since ${today}`);
		assert.ok(q("space-file-new-f2"), "a file a scan just found is marked New");
		assert.ok(q("space-file-new-f1") === null);
		assert.deepEqual(
			[...document.querySelectorAll('[data-testid^="files-group-toggle-"]')].map((b) => b.textContent),
			["Lecture3 files", "Rosen, Probability2 files", "Other2 files"],
		);
		assert.deepEqual(
			[...q("files-group-lecture")!.querySelectorAll('[data-testid^="files-item-"]')].map((i) => i.textContent!.slice(0, 9)),
			["Lecture 1", "Lecture 5", "Lecture 6"],
			"in number order",
		);
		assert.equal(q("space-file-kind-f5")!.textContent, "Info");
		assert.equal(q("space-file-kind-f1")!.textContent, "Study");
		// "studied of facts" with the bar, filled by the share that came up.
		assert.equal(q("space-file-status-f1")!.textContent, "31 of 31 facts studied");
		assert.match(q("space-file-status-f1")!.innerHTML, /width:\s*100%/);
		assert.equal(q("space-file-status-f2")!.textContent, "0 of 22 facts studied");
		assert.match(q("space-file-status-f2")!.innerHTML, /width:\s*0%/, "unstudied file: an empty bar");
		assert.equal(q("space-file-status-f3")!.textContent, "Building facts");
		assert.equal(q("space-file-status-f4")!.textContent, "Failed");
		assert.ok(q("space-file-retry-f4"));
		assert.ok(q("space-file-status-f5") === null, "space info shows no state");
		assert.ok(q("space-file-linked-f2"), "a file from the linked folder is marked");
		assert.ok(q("space-file-linked-f1") === null, "a copied file is not");
		assert.equal(q("space-folder")!.getAttribute("data-problem"), null);
	});

	it("No space asks for a space instead of showing a blank page", async () => {
		fakeFetch();
		const page = await mount(null);
		assert.match(page.textContent!, /Pick a space to see its files\./);
		assert.ok(q("files-summary") === null);
		assert.ok(q("pick-space-cls_a"), "the spaces are right on the page");
		assert.ok(q("pick-space-new"));
		await act(async () => q("pick-space-cls_a")!.click());
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.ok(q("files-summary"), "picking one opens its files");
	});

	it("a space record that fails to load says so, and Try again reads it again", async () => {
		// A held clock: a new minute would add the linked folder's own re-read to the count.
		mock.timers.enable({ apis: ["Date"], now: Date.now() });
		recordFails = true;
		fakeFetch();
		const page = await mount();
		assert.match(page.textContent!, /Couldn't load this space's files\./);
		assert.ok(q("files-summary") === null);
		const reads = recordReads;
		recordFails = false;
		await act(async () => q("load-failed-retry")!.click());
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.equal(recordReads, reads + 1);
		assert.ok(q("files-summary"), "the files show once the read works");
		assert.ok(q("load-failed") === null);
	});

	it("says Loading… until the space record arrives", async () => {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			if (String(input) === "/api/spaces") return Response.json({ spaces: [{ id: "cls_a", name: "CSE 21" }] });
			return new Promise<Response>(() => {});
		}) as typeof fetch;
		const page = await mount();
		assert.match(page.textContent!, /Loading…/);
	});

	it("a waiting file says Waiting", async () => {
		fakeFetch();
		await mount();
		assert.equal(q("space-file-status-f7")!.textContent, "Waiting");
	});

	it("a recording that needs the speech tool shows the install command inline with Copy", async () => {
		fakeFetch();
		await mount();
		assert.equal(q("space-file-status-f6")!.textContent, "Needs a speech tool");
		assert.ok(q("space-file-retry-f6"));
		assert.match(q("space-file-install-f6")!.textContent!, /run this in Terminal, then click Retry\..*brew install whisper-cpp ffmpeg/);
		const copied: string[] = [];
		Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (t: string) => void copied.push(t) } } });
		await act(async () => q("space-file-install-copy-f6")!.click());
		assert.deepEqual(copied, ["brew install whisper-cpp ffmpeg"]);
		assert.equal(q("space-file-install-copy-f6")!.textContent, "Copied");
		assert.ok(q("space-file-install-f1") === null, "other rows have no install line");
	});

	it("a missing linked folder says so and offers Pick folder again", async () => {
		folderProblem = "missing";
		fakeFetch();
		await mount();
		assert.equal(q("space-folder-status")!.textContent, "Can't find this folder");
		await act(async () => q("space-folder")!.click());
		assert.match(q("space-folder-problem")!.textContent!, /Its files and facts are kept/);
		assert.ok(q("space-folder-pick-again"));
		assert.ok(q("space-folder-open") === null, "no Show in Finder for a folder that isn't there");
	});

	it("a folder over the file limit says only the first 500 were added", async () => {
		folderProblem = "too-many-files";
		fakeFetch();
		await mount();
		assert.equal(q("space-folder-status")!.textContent, "Watching CSE 21");
		await act(async () => q("space-folder")!.click());
		assert.match(q("space-folder-problem")!.textContent!, /Only the first 500 files were added/);
		assert.ok(q("space-folder-pick-again"), "Pick folder again is always there: the safe way to switch folders");
	});

	it("Move to Study material and Retry write at once; Move to Space info asks first", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("space-file-menu-f5")!.click());
		assert.equal(q("space-file-move-f5")!.textContent, "Move to Study material");
		await act(async () => q("space-file-move-f5")!.click());
		assert.ok(q("files-confirm") === null, "moving into study material loses nothing");
		await act(async () => q("space-file-retry-f4")!.click());
		await act(async () => q("space-file-menu-f1")!.click());
		assert.equal(q("space-file-move-f1")!.textContent, "Move to Space info");
		await act(async () => q("space-file-move-f1")!.click());
		assert.equal(q("files-confirm")!.getAttribute("aria-label"), "Move to Space info?");
		assert.match(q("files-confirm")!.textContent!, /Its 31 facts leave the graph\. The teacher can still read it\./);
		assert.equal(calls.length, 2, "nothing moves before the OK");
		await act(async () => q("files-confirm-button")!.click());
		assert.deepEqual(calls, [
			{ method: "PUT", url: "/api/spaces/cls_a/files/f5", body: { kind: "study" } },
			{ method: "PUT", url: "/api/spaces/cls_a/files/f4", body: { retry: true } },
			{ method: "PUT", url: "/api/spaces/cls_a/files/f1", body: { kind: "info" } },
		]);
	});

	it("Unlink asks first, says how many files and facts go, and points to Pick folder again", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("space-folder")!.click());
		await act(async () => q("space-unlink-folder")!.click());
		const box = q("files-confirm")!;
		assert.match(box.textContent!, /Unlink this folder\?/);
		assert.match(box.textContent!, /Its 1 file leaves CSE 21, along with the 22 facts built from them\. The folder on your computer is not touched\. This cannot be undone\./);
		assert.match(box.textContent!, /use Pick folder again instead/);
		await act(async () => q("files-confirm-cancel")!.click());
		assert.deepEqual(calls, [], "Cancel keeps the folder");
		await act(async () => q("space-folder")!.click());
		await act(async () => q("space-unlink-folder")!.click());
		await act(async () => q("files-confirm-button")!.click());
		assert.deepEqual(calls, [{ method: "DELETE", url: "/api/spaces/cls_a/folder", body: undefined }]);
	});

	it("Remove asks first and says how many facts go", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("space-file-menu-f1")!.click());
		await act(async () => q("space-file-remove-f1")!.click());
		assert.match(q("files-confirm")!.textContent!, /Remove Lecture 1 — Counting\.pdf\?.*It leaves CSE 21, along with the 31 facts built from it\./);
		assert.deepEqual(calls, []);
		await act(async () => q("files-confirm-button")!.click());
		assert.deepEqual(calls, [{ method: "DELETE", url: "/api/spaces/cls_a/files/f1", body: undefined }]);
	});

	it("a .tex and its PDF are one row, the PDF's: a click picks the PDF, and Remove names both", async () => {
		record = { ...RECORD, files: [file("f_pdf", "HW 3.pdf"), file("f_tex", "HW 3.tex", { pdfId: "f_pdf" })] };
		fakeFetch();
		await mount();
		assert.ok(q("space-file-f_tex") === null, "no row of its own");
		assert.equal(q("space-file-source-f_pdf")!.textContent, ".tex");
		await act(async () => q("space-file-pick-f_pdf")!.click());
		assert.equal(q("files-picked-names")!.textContent, "HW 3.pdf");
		await act(async () => q("space-file-menu-f_pdf")!.click());
		await act(async () => q("space-file-remove-f_pdf")!.click());
		assert.match(q("files-confirm")!.textContent!, /Remove 2 files\?.*HW 3\.pdf and HW 3\.tex leave CSE 21/);
		await act(async () => q("files-confirm-button")!.click());
		assert.deepEqual(calls, [{ method: "DELETE", url: "/api/spaces/cls_a/files/f_pdf", body: undefined }], "the server removes the .tex with it");
	});

	it("a picked .tex whose PDF arrives joins the PDF's row and leaves the picks", async () => {
		record = { ...RECORD, files: [file("f_tex", "HW 3.tex")] };
		fakeFetch();
		await mount();
		await act(async () => q("space-file-pick-f_tex")!.click());
		assert.equal(q("files-picked-names")!.textContent, "HW 3.tex");
		record = { ...RECORD, files: [file("f_tex", "HW 3.tex", { pdfId: "f_pdf" }), file("f_pdf", "HW 3.pdf")] };
		await act(async () => {
			events.get("spaces-changed")!("{}");
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.ok(q("space-file-f_tex") === null);
		assert.equal(q("space-file-pick-f_pdf")!.getAttribute("aria-pressed"), "false");
		assert.equal(q("files-picked-bar")!.getAttribute("data-state"), "closed", "nothing is left picked");
	});

	it("files dropped anywhere on the page are added, and the page says so while they are dragged in", async () => {
		fakeFetch();
		await mount();
		const transfer = (types: string[], files: File[] = []) => ({ types, files, items: { length: files.length }, dropEffect: "none" });
		const fire = async (el: Element, type: string, dataTransfer: unknown) => {
			await act(async () => {
				const e = new window.Event(type, { bubbles: true, cancelable: true });
				Object.assign(e, { dataTransfer });
				el.dispatchEvent(e);
			});
		};
		const pdf = new File(["x"], "Syllabus v2.pdf");
		assert.ok(q("files-drop") === null, "no cue until files are dragged in");
		await fire(q("files-page")!, "dragover", transfer(["Files"], [pdf]));
		assert.equal(q("files-drop")!.textContent, "Drop to add 1 file");
		await fire(q("files-summary")!, "drop", transfer(["Files"], [pdf]));
		assert.equal(calls.at(-1)!.method, "POST");
		assert.equal(calls.at(-1)!.url, "/api/spaces/cls_a/files");
		assert.ok(q("files-drop") === null, "the cue leaves after the drop");

		// Text dragged over the page is not a file: no cue.
		await fire(q("files-page")!, "dragover", transfer(["text/plain"]));
		assert.ok(q("files-drop") === null);
	});

	it("Add files opens the file picker on the first click", async () => {
		fakeFetch();
		await mount();
		const input = q("space-file-input") as HTMLInputElement;
		let picked = 0;
		input.click = () => void picked++;
		await act(async () => q("space-add-files")!.click());
		assert.equal(picked, 1);
		Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "HW5.pdf")] });
		await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
		assert.equal(calls.at(-1)!.method, "POST");
		assert.equal(calls.at(-1)!.url, "/api/spaces/cls_a/files");
	});

	const field = () => q("files-search")!.querySelector("input") as HTMLInputElement;
	const sendFind = () => act(async () => window.dispatchEvent(new dom.window.CustomEvent(kbdEventForAction("find"))));

	it("the bar has Find, then the linked folder, then Add files; Find shows its key and opens a field", async () => {
		fakeFetch();
		await mount();
		const bar = q("bar-actions")!;
		assert.deepEqual([...bar.children].map((el) => el.getAttribute("data-testid")).filter((id) => id && id !== "space-file-input"), ["files-find", "space-folder", "space-add-files"]);
		assert.equal(q("files-find")!.getAttribute("aria-label"), "Find a file");
		assert.ok(q("files-find")!.querySelector("kbd"), "the magnifying glass shows the find key");
		assert.ok(q("files-search") === null);
		await act(async () => q("files-find")!.click());
		assert.ok(q("files-search")!.closest("[data-testid='bar-actions']"), "the field is in the bar");
		assert.ok(q("space-folder") === null && q("space-add-files") === null, "the other words make room");
		assert.ok(document.activeElement === field());
	});

	it("search narrows the groups to matching names, says when nothing matches, and Close brings all back", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("files-find")!.click());
		await typeInto(field(), "rosen 7");
		assert.ok(q("space-file-f3"));
		assert.ok(q("space-file-f2") === null);
		assert.ok(q("files-group-lecture") === null, "groups with no match leave");
		await typeInto(field(), "zzz");
		assert.match(q("files-no-match")!.textContent!, /No file names have .zzz./);
		await act(async () => document.querySelector<HTMLElement>("[aria-label='Close Find']")!.click());
		assert.ok(q("files-search") === null && q("files-find") && q("space-add-files"));
		assert.ok(q("files-group-lecture"));
		assert.ok(q("files-no-match") === null);
	});

	it("a search that finds no name offers to have the teacher look inside, and hands over what was typed", async () => {
		fakeFetch();
		const lines: string[] = [];
		await mount("cls_a", { canAsk: true, lines });
		await act(async () => q("files-find")!.click());
		await typeInto(field(), "rosen 7");
		assert.ok(q("files-ask-inside") === null, "names match: nothing to ask");
		await typeInto(field(), "  eigen\nvalues\t ");
		assert.equal(q("files-ask-inside")!.textContent, "Ask Ada to look inside");
		assert.ok(!q("files-no-match")!.textContent!.includes("look inside"), "the sentence does not repeat the key");
		await act(async () => q("files-ask-inside")!.click());
		assert.deepEqual(lines, ['Find "eigen values" in my files']);
	});

	it("no such key where the teacher cannot be handed a line, or outside the app shell", async () => {
		fakeFetch();
		await mount("cls_a", { canAsk: false, lines: [] });
		await act(async () => q("files-find")!.click());
		await typeInto(field(), "zzz");
		assert.ok(q("files-no-match"));
		assert.ok(q("files-ask-inside") === null);
	});

	it("Escape clears the search and closes the field; reopened, it is empty", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("files-find")!.click());
		await typeInto(field(), "rosen 7");
		await act(async () => {
			const escape = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
			Object.defineProperty(escape, "key", { value: "Escape" });
			field().dispatchEvent(escape);
		});
		assert.ok(q("files-search") === null);
		assert.ok(q("files-group-lecture"), "every group is back");
		await act(async () => q("files-find")!.click());
		assert.equal(field().value, "");
	});

	it("the find shortcut opens the search; not while a dialog is on top", async () => {
		fakeFetch();
		await mount();
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.append(dialog);
		await sendFind();
		dialog.remove();
		assert.ok(q("files-search") === null);
		await sendFind();
		assert.ok(q("files-search"));
		assert.ok(document.activeElement === field());
	});

	it("a group folds and stays folded for this space", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("files-group-toggle-lecture")!.click());
		assert.equal(q("space-file-f1")!.closest(".lh-collapse")!.getAttribute("data-state"), "closed", "the rows fold shut before they leave");
		await act(() => new Promise((r) => setTimeout(r, 200)));
		assert.ok(q("space-file-f1") === null);
		assert.equal(q("files-group-toggle-lecture")!.getAttribute("aria-expanded"), "false");
		await act(async () => root?.unmount());
		host?.remove();
		await mount();
		assert.ok(q("space-file-f1") === null, "still folded after the page opens again");
		await act(async () => q("files-find")!.click());
		await typeInto(field(), "lecture 1");
		assert.ok(q("space-file-f1"), "a search shows matches in folded groups too");
	});

	it("a space with no files says what to add", async () => {
		fakeFetch();
		const files = RECORD.files;
		RECORD.files = [];
		await mount();
		RECORD.files = files;
		assert.match(q("files-empty")!.textContent!, /Add notes, readings, recordings or a syllabus/);
		assert.ok(q("files-summary") === null, "no summary without files");
		assert.ok(q("space-folder"), "the linked folder still shows");
		assert.ok(q("files-find") === null, "nothing to search");
	});

	it("Link a folder without the desktop picker opens a path field that links the folder", async () => {
		fakeFetch();
		const linked = RECORD.linkedFolder;
		delete RECORD.linkedFolder;
		await mount();
		RECORD.linkedFolder = linked;
		await act(async () => q("space-pick-folder")!.click());
		assert.ok(q("space-folder-form"), "the path field replaces the folder row");
		const input = q("space-folder-input") as HTMLInputElement;
		await typeInto(input, "/Users/me/New");
		// linkedom's submit button doesn't submit its form: submit it directly.
		await act(async () => {
			q("space-folder-form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		});
		assert.deepEqual(calls.at(-1), { method: "PUT", url: "/api/spaces/cls_a/folder", body: { path: "/Users/me/New" } });
	});
});

describe("FilesPage: picking files to study", () => {
	const pressed = (id: string) => q(`space-file-pick-${id}`)!.getAttribute("aria-pressed");
	const pick = (id: string) => act(async () => q(`space-file-pick-${id}`)!.click());
	const settle = () =>
		act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});

	it("a click on a row picks it; the bar rises with the names in click order, and Clear lets them all go", async () => {
		fakeFetch();
		await mount();
		assert.ok(q("files-picked-bar") === null, "no bar with nothing picked");
		await pick("f2");
		await pick("f1");
		assert.equal(pressed("f2"), "true");
		assert.ok(q("space-file-f1")!.hasAttribute("data-picked"));
		assert.equal(q("files-picked-names")!.textContent, "Rosen 6.2 — Probability theory.pdf, Lecture 1 — Counting.pdf");
		assert.match(q("files-picked-bar")!.className, /\bw-fit max-w-\[min\(880px,100%\)\] min-w-\[min\(560px,100%\)\]/, "as wide as the names need, 560 to 880, never past its room");
		await pick("f2");
		assert.equal(pressed("f2"), "false", "a second click lets it go");
		assert.equal(q("files-picked-names")!.textContent, "Lecture 1 — Counting.pdf");
		await act(async () => q("space-file-retry-f4")!.click());
		await act(async () => q("space-file-menu-f5")!.click());
		assert.equal(pressed("f4"), "false", "Retry keeps its own click");
		assert.equal(pressed("f5"), "false", "More keeps its own click");
		await act(async () => q("files-picked-clear")!.click());
		assert.equal(pressed("f1"), "false");
		assert.equal(q("files-picked-bar")!.getAttribute("data-state"), "closed", "the bar leaves");
	});

	it("Pick files to study shows tick boxes and a bar that says none is picked; Cancel leaves", async () => {
		fakeFetch();
		await mount();
		const ticks = () => q("files-page")!.querySelectorAll("[class*='border-ink'][class*='lh-notch']").length;
		assert.ok(q("files-pick"), "the key sits in the head");
		assert.equal(q("files-pick")!.textContent, "Pick files to study");
		assert.equal(ticks(), 0, "no tick boxes before");
		await act(async () => q("files-pick")!.click());
		assert.ok(q("files-pick") === null, "the key goes while picking");
		assert.equal(ticks(), 7, "every row has an empty box");
		assert.equal(q("files-picked-names")!.textContent, "No files picked yet");
		assert.equal(q("files-picked-clear")!.textContent, "Cancel");
		assert.ok((q("files-picked-study") as HTMLButtonElement).disabled, "Study waits for a pick");
		await act(async () => q("files-picked-clear")!.click());
		assert.equal(q("files-picked-bar")!.getAttribute("data-state"), "closed");
		assert.equal(ticks(), 0, "the boxes go");
		assert.ok(q("files-pick"), "and the key is back");
	});

	it("picking a file while picking ticks its box, and Clear leaves pick mode", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("files-pick")!.click());
		await pick("f1");
		assert.equal(q("files-picked-names")!.textContent, "Lecture 1 — Counting.pdf");
		assert.equal(q("files-picked-clear")!.textContent, "Clear");
		assert.ok(!(q("files-picked-study") as HTMLButtonElement).disabled);
		assert.match(q("space-file-pick-f1")!.innerHTML, /bg-tint/, "its box is ticked");
		assert.ok(q("files-pick") === null);
		await act(async () => q("files-picked-clear")!.click());
		assert.equal(q("files-picked-bar")!.getAttribute("data-state"), "closed");
		assert.ok(q("files-pick"), "pick mode is over");
		assert.ok(!/bg-tint/.test(q("space-file-pick-f1")!.innerHTML));
	});

	it("a space with no files has no Pick files key", async () => {
		record = { ...RECORD, files: [] };
		fakeFetch();
		await mount();
		assert.ok(q("files-pick") === null);
	});

	it("Study starts a lesson on the picked files, first picked first, and opens it", async () => {
		fakeFetch();
		await mount();
		await pick("f2");
		await pick("f1");
		await act(async () => q("files-picked-study")!.click());
		await settle();
		assert.deepEqual(calls.find((c) => c.url === "/api/chats")?.body, { fileIds: ["f2", "f1"], spaceId: "cls_a" });
		assert.equal(went.at(-1), `/chat/chat_new?prompt=${encodeURIComponent("Rosen 6.2 — Probability theory")}`);
	});

	it("a refused start says the server's reason on the bar, and the next pick takes it away", async () => {
		fakeFetch();
		started = () => Response.json({ error: "This space is closed." }, { status: 400 });
		await mount();
		await pick("f1");
		await act(async () => q("files-picked-study")!.click());
		await settle();
		assert.equal(q("files-picked-names-failure")!.textContent, "This space is closed.");
		assert.equal(q("files-picked-names-failure")!.getAttribute("role"), "alert");
		assert.equal(went.at(-1), "/files", "the page stays");
		await pick("f2");
		assert.ok(q("files-picked-names-failure") === null);
		assert.equal(q("files-picked-names")!.textContent, "Lecture 1 — Counting.pdf, Rosen 6.2 — Probability theory.pdf");
	});

	it("while Study runs its key shows it and a second click sends nothing", async () => {
		fakeFetch();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const answer = Response.json({ error: "later" }, { status: 400 });
		started = answer;
		const plain = globalThis.fetch;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input) === "/api/chats") await gate;
			return plain(input, init);
		}) as typeof fetch;
		await mount();
		await pick("f1");
		await act(async () => q("files-picked-study")!.click());
		assert.equal(q("files-picked-study")!.getAttribute("aria-busy"), "true");
		await act(async () => q("files-picked-study")!.click());
		release();
		await settle();
		assert.equal(calls.filter((c) => c.url === "/api/chats").length, 1);
		assert.equal(q("files-picked-study")!.getAttribute("aria-busy"), null);
	});

	it("at eight picked the other rows no longer pick", async () => {
		record = { ...RECORD, files: Array.from({ length: 9 }, (_, i) => file(`p${i}`, `Practice ${i}.pdf`)) };
		fakeFetch();
		await mount();
		for (let i = 0; i < 8; i++) await pick(`p${i}`);
		assert.equal(q("space-file-pick-p8")!.getAttribute("aria-disabled"), "true", "the ninth is held back");
		await pick("p8");
		assert.equal(pressed("p8"), "false", "and does not pick");
		assert.equal(q("files-picked-names-failure")!.textContent, FULL_LINE, "the bar says why");
		assert.equal(q("space-file-pick-p0")!.getAttribute("aria-disabled"), null, "a picked one can still be let go");
		await pick("p0");
		assert.equal(q("space-file-pick-p8")!.getAttribute("aria-disabled"), null, "room again");
		assert.ok(q("files-picked-names-failure") === null, "and the names are back");
	});

	it("a file's problems take the place of its facts, from the progress payload, and link to its lesson", async () => {
		fileWork = [
			{ fileId: "f1", problems: { done: 2, total: 4 }, lessonId: "chat_mid" },
			{ fileId: "f2", problems: { done: 1, total: 3 } },
			{ fileId: "f7", problems: { done: 0, total: 2 } },
		];
		fakeFetch();
		await mount();
		const linked = q("space-file-status-f1")!;
		assert.equal(linked.textContent, "2 of 4 problems done", "in place of 31 of 31 facts studied");
		assert.equal(linked.getAttribute("href"), "/chat/chat_mid");
		assert.equal(linked.getAttribute("aria-label"), "Lecture 1 — Counting.pdf, 2 of 4 problems done");
		assert.ok(linked.contains(q("space-file-blocks-f1")), "the blocks are part of the link");
		assert.ok(!q("space-file-pick-f1")!.contains(linked), "the link sits beside the row's button");
		await act(async () => linked.click());
		assert.equal(went.at(-1), "/chat/chat_mid");
		assert.equal(pressed("f1"), "false", "the link never picks");
		const plain = q("space-file-status-f2")!;
		assert.equal(plain.textContent, "1 of 3 problems done");
		assert.ok(q("space-file-pick-f2")!.contains(plain), "with no lesson the blocks are part of the row's button");
		await act(async () => q("space-file-blocks-f2")!.click());
		assert.equal(pressed("f2"), "true", "and pick like the rest of the row");
		assert.equal(q("space-file-status-f7")!.textContent, "Waiting", "a state that needs the learner keeps its words");
		assert.ok(q("space-file-blocks-f7"), "after the blocks");
	});
});

describe("CopyButton", () => {
	async function mountButton(button: React.ReactElement) {
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => root!.render(button));
		return host.querySelector("button")!;
	}

	it("reads the text at click time, runs onClick, and says Copied", async () => {
		const copied: string[] = [];
		Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (t: string) => void copied.push(t) } } });
		let source = "old";
		let clicks = 0;
		const button = await mountButton(<CopyButton text={() => source} aria-label="Copy code" onClick={() => clicks++} />);
		assert.equal(button.textContent, "Copy");
		source = "new";
		await act(async () => button.click());
		assert.deepEqual(copied, ["new"]);
		assert.equal(clicks, 1);
		assert.equal(button.textContent, "Copied");
	});

	it("when the clipboard API refuses, the legacy copy path still copies", async () => {
		Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } } });
		const doc = document as unknown as { execCommand?: (cmd: string) => boolean };
		const commands: string[] = [];
		doc.execCommand = (cmd) => (commands.push(cmd), true);
		// linkedom's textarea has no select().
		const proto = dom.window.HTMLElement.prototype as unknown as { select?: () => void };
		proto.select = () => {};
		try {
			const button = await mountButton(<CopyButton text="hello" />);
			await act(async () => button.click());
			assert.deepEqual(commands, ["copy"]);
			assert.equal(button.textContent, "Copied");
		} finally {
			delete doc.execCommand;
			delete proto.select;
		}
	});
});
