/**
 * The Files page (redesign plan, Phase 6 — docs/design/exports/files.html),
 * mounted over linkedom with a fake fetch: the two sections and counts,
 * the linked folder, each row's state (coverage bar, Building facts…,
 * Failed + Retry), the Study/Info toggle and Unlink writing through the
 * class routes, and a "#file-<id>" link outlining its row.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { ClassFile, ClassRecord, FileCoverage } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	// The ⋯ menu and the folder box place themselves on the next frame.
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});
// linkedom has no location: a plain one carries the hash.
Object.defineProperty(dom.window, "location", { value: { hash: "", pathname: "/class/files", href: "http://localhost/class/files" }, configurable: true });
const scrolled: string[] = [];
(dom.window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = function (this: HTMLElement) {
	scrolled.push(this.id);
};

// react-dom reads the DOM globals when it loads: import it after them.
// linkedom's document has no "oninput"; without it React would fall back
// to an old-IE way of watching text fields.
(dom.document as unknown as { oninput: null }).oninput = null;
const { createRoot } = await import("react-dom/client");
const { FilesPage } = await import("../src/components/files/files-page.tsx");
const { ServerEventsProvider } = await import("../src/components/server-events.tsx");
const { ClassProvider } = await import("../src/components/class-context.tsx");
const { AgentStatusProvider } = await import("../src/components/agent-status.tsx");

function file(id: string, name: string, over: Partial<ClassFile> = {}): ClassFile {
	return { id, origin: "copied", name, path: `${id}/${name}`, kind: "study", contentFp: "", status: "ready", addedAt: "", ...over };
}

const RECORD: ClassRecord = {
	id: "cls_a",
	name: "CSE 21",
	description: "",
	createdAt: "",
	updatedAt: "",
	archived: false,
	linkedFolder: "/Users/me/School/CSE 21",
	files: [
		file("f1", "Lecture 1 — Counting.pdf"),
		file("f2", "Rosen 6.2 — Probability theory.pdf", { origin: "linked", path: "Readings/Rosen 6.2 — Probability theory.pdf" }),
		file("f3", "Rosen 7.1 — Discrete probability.pdf", { status: "extracting" }),
		file("f4", "Week 4 Discussion.srt", { status: "failed", error: "no audio" }),
		file("f5", "Syllabus.pdf", { kind: "info" }),
		file("f6", "Lecture 5.mp3", { status: "needs-whisper", error: "Recordings need whisper.cpp" }),
		file("f7", "Lecture 6.pdf", { status: "pending" }),
	],
};
const COVERAGE: FileCoverage[] = [
	{ fileId: "f1", name: "Lecture 1 — Counting.pdf", facts: 31, inLessons: 31, share: 1 },
	{ fileId: "f2", name: "Rosen 6.2 — Probability theory.pdf", facts: 22, inLessons: 0, share: 0 },
];

const calls: { method: string; url: string; body?: unknown }[] = [];
let folderProblem: string | null = null;
let recordFails = false;
let agentTeaching = true;
let recordReads = 0;
const originalFetch = globalThis.fetch;
function fakeFetch() {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? "GET";
		if (method !== "GET") calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
		if (url === "/api/classes") return Response.json({ classes: [{ id: "cls_a", name: "CSE 21" }] });
		if (url === "/api/mcp-access") return Response.json({ agentConnected: true, agentTeaching, pendingWork: 0 });
		if (url.startsWith("/api/classes/cls_a") && method === "GET") {
			recordReads++;
			return recordFails ? Response.json({ error: "boom" }, { status: 500 }) : Response.json({ class: RECORD, folderProblem });
		}
		if (url.startsWith("/api/progress")) return Response.json({ classId: "cls_a", files: COVERAGE });
		return Response.json({ ok: true });
	}) as typeof fetch;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
async function mount(initialActive: string | null = "cls_a") {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
	await act(async () => {
		root!.render(
			<ServerEventsProvider connect={connect as never}>
				<AgentStatusProvider>
					<ClassProvider initialActive={initialActive}>
						<FilesPage />
					</ClassProvider>
				</AgentStatusProvider>
			</ServerEventsProvider>,
		);
	});
	// Let the record + progress fetches land.
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
	return host;
}
/** Type into a text field (React hears the "input" event). */
async function typeInto(input: HTMLInputElement, value: string) {
	await act(async () => {
		Object.defineProperty(input, "value", { configurable: true, writable: true, value });
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	calls.length = 0;
	scrolled.length = 0;
	folderProblem = null;
	recordFails = false;
	agentTeaching = true;
	recordReads = 0;
	globalThis.fetch = originalFetch;
	window.location.hash = "";
});

describe("FilesPage", () => {
	it("shows the linked folder, both panels with counts and Add, and each row's state", async () => {
		fakeFetch();
		await mount();
		assert.equal(q("class-pick-folder"), null, "a linked class shows its folder, not Link folder");
		assert.ok(q("class-add-study"), "Study material's Add");
		assert.ok(q("class-add-info"), "Course info's Add");
		assert.equal(q("class-folder-path")!.textContent, "~/School/CSE 21");
		assert.equal(q("files-count-study")!.textContent, "6");
		assert.equal(q("files-count-info")!.textContent, "1");
		// "studied/facts" with the bar: a fill only when some came up.
		assert.match(q("class-file-status-f1")!.textContent!, /31\/31\s*facts studied/);
		assert.ok(q("class-file-f1")!.querySelector('[data-testid="file-coverage-fill"]'));
		assert.match(q("class-file-status-f2")!.textContent!, /0\/22\s*facts studied/);
		assert.equal(q("class-file-f2")!.querySelector('[data-testid="file-coverage-fill"]'), null, "unstudied file: an empty bar");
		assert.match(q("class-file-status-f3")!.textContent!, /Building facts…/);
		assert.equal(q("class-file-status-f4")!.textContent, "Failed");
		assert.ok(q("class-file-retry-f4"));
		assert.equal(q("class-file-status-f5"), null, "course info shows no state");
		assert.equal(document.querySelector('[data-testid^="class-file-kind-"]'), null, "no Study/Info toggle");
		assert.ok(q("class-file-linked-f2"), "a file from the linked folder is marked");
		assert.equal(q("class-file-linked-f1"), null, "a copied file is not");
		assert.equal(q("class-folder")!.getAttribute("data-problem"), null);
	});

	it("No class asks for a class instead of showing a blank page", async () => {
		fakeFetch();
		const page = await mount(null);
		assert.match(page.textContent!, /Pick a class to see its files\./);
		assert.equal(q("files-section-study"), null);
	});

	it("a class record that fails to load says so, and Try again reads it again", async () => {
		recordFails = true;
		fakeFetch();
		const page = await mount();
		assert.match(page.textContent!, /Couldn't load this class's files\./);
		assert.equal(q("files-section-study"), null);
		const reads = recordReads;
		recordFails = false;
		await act(async () => q("load-failed-retry")!.click());
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		assert.equal(recordReads, reads + 1);
		assert.ok(q("files-section-study"), "the files show once the read works");
		assert.equal(q("load-failed"), null);
	});

	it("says Loading… until the class record arrives", async () => {
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			if (String(input) === "/api/classes") return Response.json({ classes: [{ id: "cls_a", name: "CSE 21" }] });
			return new Promise<Response>(() => {});
		}) as typeof fetch;
		const page = await mount();
		assert.match(page.textContent!, /Loading…/);
	});

	it("a waiting file says it waits for your agent when none is teaching", async () => {
		agentTeaching = false;
		fakeFetch();
		await mount();
		assert.equal(q("class-file-status-f7")!.textContent, "Waiting for your agent");
	});

	it("a waiting file just says Waiting while an agent is teaching", async () => {
		fakeFetch();
		await mount();
		assert.equal(q("class-file-status-f7")!.textContent, "Waiting");
	});

	it("a recording that needs the speech tool shows the install command inline with Copy", async () => {
		fakeFetch();
		await mount();
		assert.equal(q("class-file-status-f6")!.textContent, "Needs a speech tool");
		assert.ok(q("class-file-retry-f6"));
		assert.match(q("class-file-install-f6")!.textContent!, /run this in Terminal, then click Retry\..*brew install whisper-cpp ffmpeg/);
		const copied: string[] = [];
		Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (t: string) => void copied.push(t) } } });
		await act(async () => q("class-file-install-copy-f6")!.click());
		assert.deepEqual(copied, ["brew install whisper-cpp ffmpeg"]);
		assert.equal(q("class-file-install-copy-f6")!.textContent, "Copied");
		assert.equal(q("class-file-install-f1"), null, "other rows have no install line");
	});

	it("a missing linked folder says so and offers Pick folder again", async () => {
		folderProblem = "missing";
		fakeFetch();
		await mount();
		assert.equal(q("class-folder-path")!.textContent, "Can't find this folder");
		await act(async () => q("class-folder")!.click());
		assert.match(q("class-folder-problem")!.textContent!, /Its files and facts are kept/);
		assert.ok(q("class-folder-pick-again"));
		assert.equal(q("class-folder-open"), null, "no Open in Finder for a folder that isn't there");
	});

	it("a folder over the file limit says only the first 500 were added", async () => {
		folderProblem = "too-many-files";
		fakeFetch();
		await mount();
		assert.equal(q("class-folder-path")!.textContent, "~/School/CSE 21");
		await act(async () => q("class-folder")!.click());
		assert.match(q("class-folder-problem")!.textContent!, /Only the first 500 files were added/);
		assert.ok(q("class-folder-pick-again"), "Pick folder again is always there: the safe way to switch folders");
	});

	it("Move to Study material and Retry write at once; Move to Course info asks first", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("class-file-menu-f5")!.click());
		assert.equal(q("class-file-move-f5")!.textContent, "Move to Study material");
		await act(async () => q("class-file-move-f5")!.click());
		assert.equal(q("files-confirm"), null, "moving into study material loses nothing");
		await act(async () => q("class-file-retry-f4")!.click());
		await act(async () => q("class-file-menu-f1")!.click());
		assert.equal(q("class-file-move-f1")!.textContent, "Move to Course info");
		await act(async () => q("class-file-move-f1")!.click());
		assert.equal(q("files-confirm")!.getAttribute("aria-label"), "Move to Course info?");
		assert.match(q("files-confirm")!.textContent!, /Its 31 facts leave the graph\. The teacher can still read it\./);
		assert.equal(calls.length, 2, "nothing moves before the OK");
		await act(async () => q("files-confirm-button")!.click());
		assert.deepEqual(calls, [
			{ method: "PUT", url: "/api/classes/cls_a/files/f5", body: { kind: "study" } },
			{ method: "PUT", url: "/api/classes/cls_a/files/f4", body: { retry: true } },
			{ method: "PUT", url: "/api/classes/cls_a/files/f1", body: { kind: "info" } },
		]);
	});

	it("Unlink asks first, says how many files and facts go, and points to Pick folder again", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("class-folder")!.click());
		await act(async () => q("class-unlink-folder")!.click());
		const box = q("files-confirm")!;
		assert.match(box.textContent!, /Unlink this folder\?/);
		assert.match(box.textContent!, /Its 1 file leaves CSE 21, along with the 22 facts built from them\. The folder on your computer is not touched\. This cannot be undone\./);
		assert.match(box.textContent!, /use Pick folder again instead/);
		await act(async () => q("files-confirm-cancel")!.click());
		assert.deepEqual(calls, [], "Cancel keeps the folder");
		await act(async () => q("class-folder")!.click());
		await act(async () => q("class-unlink-folder")!.click());
		await act(async () => q("files-confirm-button")!.click());
		assert.deepEqual(calls, [{ method: "DELETE", url: "/api/classes/cls_a/folder", body: undefined }]);
	});

	it("Remove asks first and says how many facts go", async () => {
		fakeFetch();
		await mount();
		await act(async () => q("class-file-menu-f1")!.click());
		await act(async () => q("class-file-remove-f1")!.click());
		assert.match(q("files-confirm")!.textContent!, /Remove Lecture 1 — Counting\.pdf\?.*It leaves CSE 21, along with the 31 facts built from it\./);
		assert.deepEqual(calls, []);
		await act(async () => q("files-confirm-button")!.click());
		assert.deepEqual(calls, [{ method: "DELETE", url: "/api/classes/cls_a/files/f1", body: undefined }]);
	});

	it("dragging a row into the other panel warns, then moves it; files dropped from Finder are added to that panel", async () => {
		fakeFetch();
		await mount();
		const data = new Map<string, string>();
		const transfer = (types: string[], files: File[] = []) => ({
			types,
			files,
			items: { length: files.length || 2 },
			dropEffect: "none",
			effectAllowed: "all",
			setData: (t: string, v: string) => data.set(t, v),
			getData: (t: string) => data.get(t) ?? "",
		});
		const fire = async (el: Element, type: string, dataTransfer: unknown) => {
			await act(async () => {
				const e = new window.Event(type, { bubbles: true, cancelable: true });
				Object.assign(e, { dataTransfer });
				el.dispatchEvent(e);
			});
		};
		const ROW = "application/x-godspeed-class-file";
		await fire(q("class-file-f1")!, "dragstart", transfer([]));
		assert.equal(q("class-file-f1")!.className.includes("opacity-30"), true, "the dragged row fades");
		await fire(q("files-section-info")!, "dragover", transfer([ROW]));
		assert.match(q("files-drop-target")!.textContent!, /Move to Course info.*Its 31 facts leave the graph/);
		await fire(q("files-section-info")!, "drop", transfer([ROW]));
		assert.deepEqual(calls.at(-1), { method: "PUT", url: "/api/classes/cls_a/files/f1", body: { kind: "info" } });
		assert.equal(q("files-drop-target"), null);

		// Its own panel is not a drop target.
		await fire(q("class-file-f2")!, "dragstart", transfer([]));
		await fire(q("files-section-study")!, "dragover", transfer([ROW]));
		assert.equal(q("files-drop-target"), null);
		await fire(q("class-file-f2")!, "dragend", transfer([]));

		const pdf = new File(["x"], "Lecture 4.pdf");
		await fire(q("files-section-study")!, "dragover", transfer(["Files"], [pdf]));
		assert.equal(q("files-drop-target")!.textContent, "Drop to add 1 file as study material");
		await fire(q("files-section-study")!, "drop", transfer(["Files"], [pdf]));
		assert.equal(calls.at(-1)!.method, "POST");
		assert.equal(calls.at(-1)!.url, "/api/classes/cls_a/files");
	});

	it("Link folder without the desktop picker opens a path field that links the folder", async () => {
		fakeFetch();
		const linked = RECORD.linkedFolder;
		delete RECORD.linkedFolder;
		await mount();
		RECORD.linkedFolder = linked;
		await act(async () => q("class-pick-folder")!.click());
		assert.ok(q("class-folder-form"), "the path field replaces the folder row");
		const input = q("class-folder-input") as HTMLInputElement;
		await typeInto(input, "/Users/me/New");
		// linkedom's submit button doesn't submit its form: submit it directly.
		await act(async () => {
			q("class-folder-form")!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		});
		assert.deepEqual(calls.at(-1), { method: "PUT", url: "/api/classes/cls_a/folder", body: { path: "/Users/me/New" } });
	});

	it("a #file-<id> hash scrolls to that row and outlines it", async () => {
		fakeFetch();
		window.location.hash = "#file-f2";
		await mount();
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(scrolled, ["file-f2"]);
		assert.equal(q("class-file-f2")!.getAttribute("data-flash"), "true");
		assert.equal(q("class-file-f1")!.getAttribute("data-flash"), null);
	});
});
