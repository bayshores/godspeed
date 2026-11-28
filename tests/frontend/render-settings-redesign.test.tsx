/**
 * The settings page in a DOM: requested sections land where they live
 * (unknown ids open General), General holds the update rows, the teacher's
 * name and start command, Web search and Remembered, and the corner notice
 * for an old setup left on the computer.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
// linkedom's document has no "oninput"; without it React would watch text
// fields an old-IE way.
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	// The agent menu (MenuShell) places itself on the next frame.
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	// The tabs' underline watches the row's size (lit-marker.ts).
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { SettingsPage, sectionFor } = await import("../../src/frontend/components/settings/settings-page.tsx");
const { WebSearch } = await import("../../src/frontend/components/settings/web-search.tsx");
const { RememberedNotes } = await import("../../src/frontend/components/settings/remembered-notes.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SettingsProvider } = await import("../../src/frontend/components/settings-context.tsx");
const { UpdateStateProvider } = await import("../../src/frontend/components/settings/update-settings.tsx");
const { AgentFolderProvider } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");
const { OldSetupNotice } = await import("../../src/frontend/components/agent-folder/old-setup.tsx");
const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
/** The page with the window's settings it reads. */
const Settings = ({ section }: { section: string }) => (
	<SettingsProvider boot={{ sounds: true, startupSound: true }}>
		<UpdateStateProvider>
			<SettingsPage section={section} />
		</UpdateStateProvider>
	</SettingsProvider>
);

const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLElement | undefined;
async function mount(element: React.ReactElement) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(<ServerEventsProvider connect={quietEvents as never}>{element}</ServerEventsProvider>));
	await act(async () => {
		await new Promise((r) => setTimeout(r, 10));
	});
	return host;
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const FOLDER = {
	folder: "/Users/me/godspeed",
	short: "~/godspeed",
	exists: false,
	startCommands: {},
	oldSetup: { plugin: false, codex: false },
	agent: "claude",
	model: {},
};

const NO_KEY = { keyEnd: null, used: null, limit: null, error: null };

/** The reads: the saved notes, the godspeed folder and the search key. */
function settingsFetch({ notes = [], search = NO_KEY }: { notes?: object[]; search?: object } = {}) {
	return (async (url: string) => {
		const path = String(url);
		if (path.startsWith("/api/web-search")) return Response.json(search);
		return Response.json(path.startsWith("/api/agent-notes") ? { notes } : path.startsWith("/api/agent-folder") ? FOLDER : {});
	}) as unknown as typeof fetch;
}

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	globalThis.fetch = originalFetch;
});

describe("settings restyle", () => {
	it("sectionFor: known ids open their section; anything else lands on General", () => {
		assert.equal(sectionFor("general"), "general");
		assert.equal(sectionFor("teaching"), "teaching");
		assert.equal(sectionFor("agent"), "general", "the old Agent section id");
		assert.equal(sectionFor(undefined), "general");
		assert.equal(sectionFor("nope"), "general");
	});

	it("General holds the update rows, and no Lessons and graph group (the graph switch is in Teaching)", async () => {
		globalThis.fetch = (async () => Response.json({ settings: { version: 1 } })) as typeof fetch;
		await mount(<Settings section="general" />);
		assert.equal(q("settings-nav-general")!.getAttribute("aria-current"), "true");
		assert.ok(q("row-version"));
		assert.ok(q("group-lessons") === null);
		assert.ok(q("graph-row-enabled") === null);
	});

	it("Escape in the teacher name field drops the edit without saving it", async () => {
		const saves: string[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (init?.method) saves.push(String(url));
			return Response.json({ settings: { version: 1 } });
		}) as typeof fetch;
		await mount(<Settings section="teacher" />);
		const input = q("teacher-name") as HTMLInputElement;
		await act(async () => {
			Object.defineProperty(input, "value", { configurable: true, writable: true, value: "Ada" });
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		const escape = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(escape, "key", { value: "Escape" });
		await act(async () => input.dispatchEvent(escape));
		assert.equal(escape.defaultPrevented, true, "the field claims its Escape");
		assert.deepEqual(saves, [], "the dropped edit is not saved");
	});

	it("a corner notice warns about the old plugin left on the computer, and Remove says to restart open chats", async () => {
		const posted: unknown[] = [];
		const left = { ...FOLDER, exists: true, oldSetup: { plugin: true, codex: false } };
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.startsWith("/api/agent-folder")) {
				if (init?.method === "POST") {
					posted.push(JSON.parse(String(init.body)));
					return Response.json({ ...left, oldSetup: { plugin: false, codex: false } });
				}
				return Response.json(left);
			}
			return Response.json({});
		}) as unknown as typeof fetch;
		await mount(
			<AgentFolderProvider>
				<OldSetupNotice />
			</AgentFolderProvider>,
		);
		assert.equal(q("old-setup-notice")!.textContent, "The old godspeed plugin is still on this computer.It lets Claude Code chats outside ~/godspeed use godspeed.LaterRemove", "the first sentence is its title");
		await act(async () => q("old-setup-remove")!.click());
		assert.deepEqual(posted, [{ action: "remove-old-setup" }]);
		assert.ok(q("old-setup-remove") === null);
		assert.ok(q("old-setup-notice")!.textContent!.includes("Removed. Restart any open Claude Code chats to finish."));
	});

	it("Web search: the teacher's own search until a key is saved, then Tavily with its count", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (!path.startsWith("/api/web-search")) return Response.json(path.startsWith("/api/agent-folder") ? FOLDER : {});
			calls.push(`${init?.method ?? "GET"} ${path} ${init?.body ?? ""}`.trim());
			if (init?.method === "PUT") return Response.json({ keyEnd: "4f2a", used: 412, limit: 1000, error: null });
			return Response.json(NO_KEY);
		}) as unknown as typeof fetch;
		const el = await mount(<WebSearch />);
		assert.ok(q("web-search-agent")!.hasAttribute("data-picked"));
		assert.equal(q("web-search-tavily")!.hasAttribute("data-picked"), false);
		const input = q("web-search-key-input") as HTMLInputElement;
		await act(async () => {
			Object.defineProperty(input, "value", { configurable: true, writable: true, value: "tvly-dev-00004f2a" });
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		await act(async () => {
			q("web-search-save")!.closest("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.ok(calls.includes('PUT /api/web-search/key {"key":"tvly-dev-00004f2a"}'));
		assert.ok(q("web-search-tavily")!.hasAttribute("data-picked"));
		assert.equal(q("web-search-used")!.textContent, "412");
		assert.equal(q("web-search-key")!.textContent, "Key ending in 4f2a");
		assert.ok(el.textContent!.includes("of 1,000 searches used this month"));
		assert.ok(!el.textContent!.includes("tvly-dev"), "the key is not shown again");
		await act(async () => {
			q("web-search-remove")!.click();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.ok(calls.includes("DELETE /api/web-search/key"));
		assert.ok(q("web-search-agent")!.hasAttribute("data-picked"));
	});

	it("Web search: a key Tavily refuses is not saved, and a saved key that stopped working says so", async () => {
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (!path.startsWith("/api/web-search")) return Response.json(path.startsWith("/api/agent-folder") ? FOLDER : {});
			return init?.method === "PUT" ? Response.json({ error: "Tavily did not accept that key." }, { status: 400 }) : Response.json(NO_KEY);
		}) as unknown as typeof fetch;
		await mount(<WebSearch />);
		const input = q("web-search-key-input") as HTMLInputElement;
		await act(async () => {
			Object.defineProperty(input, "value", { configurable: true, writable: true, value: "nope" });
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		await act(async () => {
			q("web-search-save")!.closest("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.equal(q("web-search-failed")!.textContent, "Tavily did not accept that key.");
		assert.ok(q("web-search-key-input"), "the field stays for another try");
		await act(async () => root?.unmount());
		host?.remove();

		globalThis.fetch = settingsFetch({ search: { keyEnd: "4f2a", used: null, limit: null, error: "This key is out of searches for now." } });
		await mount(<WebSearch />);
		assert.equal(q("web-search-error")!.textContent, "This key is out of searches for now. Teacher's own search is used until it works again.");
		assert.ok(q("web-search-agent")!.hasAttribute("data-picked"), "the teacher's own search is the one in use");
	});

	it("Teacher: Change opens a box for the picked agent's own start command, and Save keeps it", async () => {
		const posted: unknown[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (!path.startsWith("/api/agent-folder")) return Response.json(path.startsWith("/api/agent-notes") ? { notes: [] } : {});
			if (init?.method !== "POST") return Response.json(FOLDER);
			const body = JSON.parse(String(init.body)) as { command: string };
			posted.push(body);
			return Response.json({ ...FOLDER, startCommands: { claude: body.command } });
		}) as unknown as typeof fetch;
		const el = await mount(
			<AgentFolderProvider>
				<Settings section="teacher" />
			</AgentFolderProvider>,
		);
		assert.ok(q("agent-start-command") === null, "closed until asked for");
		await act(async () => q("agent-start-command-change")!.click());
		assert.ok(el.textContent!.includes("Command that starts Claude Code"));
		assert.ok(el.textContent!.includes("Leave empty to use claude"));
		const input = el.querySelector<HTMLInputElement>("#agent-start-command-input")!;
		assert.equal(input.value, "");
		await act(async () => {
			Object.defineProperty(input, "value", { configurable: true, writable: true, value: "standardcompute launch claude --" });
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		await act(async () => {
			q("agent-start-command")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(posted, [{ action: "set-start-command", agent: "claude", command: "standardcompute launch claude --" }]);
		await act(() => new Promise((r) => setTimeout(r, 200)));
		assert.ok(q("agent-start-command") === null, "saved: the box folds away");
		await act(async () => q("agent-start-command-change")!.click());
		assert.equal(el.querySelector<HTMLInputElement>("#agent-start-command-input")!.value, "standardcompute launch claude --", "the saved command is there to edit");
	});

	it("Remembered lists the agent's notes with a Delete button", async () => {
		globalThis.fetch = settingsFetch({
			notes: [{ id: "note_1", text: "CSE 29 exam is done.", spaceName: "CSE 29", createdAt: "2026-10-30T02:00:00Z" }],
		});
		const el = await mount(<RememberedNotes />);
		const list = q("remembered-notes")!;
		assert.ok(list.textContent!.includes("CSE 29 exam is done."));
		assert.ok(list.textContent!.includes("CSE 29, saved"));
		assert.ok(el.querySelector('[aria-label="Delete note: CSE 29 exam is done."]'));
	});

	it("Remembered Delete asks first: Cancel keeps the note, the question's Delete sends one request that waits", async () => {
		const notes = [
			{ id: "note_1", text: "Likes proofs.", spaceName: null, createdAt: "2026-10-30T02:00:00Z" },
			{ id: "note_2", text: "Prefers mornings.", spaceName: null, createdAt: "2026-10-30T02:00:00Z" },
		];
		const read = settingsFetch({ notes });
		let deletes = 0;
		let finish: () => void = () => {};
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (init?.method !== "DELETE") return read(url, init);
			deletes++;
			await new Promise<void>((resolve) => (finish = resolve));
			return Response.json({ notes: [notes[1]] });
		}) as unknown as typeof fetch;
		const el = await mount(<RememberedNotes />);
		const button = (text: string) => el.querySelector<HTMLButtonElement>(`[aria-label="Delete note: ${text}"]`);
		await act(async () => button("Likes proofs.")!.click());
		assert.equal(deletes, 0, "the first click only asks");
		assert.equal(q("note-delete-confirm")!.textContent, "Delete this note?CancelDelete");
		assert.equal(button("Likes proofs."), null);
		assert.ok(button("Prefers mornings."));
		await act(async () => button("Prefers mornings.")!.click());
		assert.equal(el.querySelectorAll('[data-testid="note-delete-confirm"]').length, 1, "one row asks at a time");
		await act(async () => q("note-delete-confirm-keep")!.click());
		assert.ok(button("Likes proofs."), "the key is back at once");
		await act(() => new Promise((r) => setTimeout(r, 200)));
		assert.ok(q("note-delete-confirm") === null, "the question is gone once its exit has played");
		await act(async () => button("Likes proofs.")!.click());
		await act(async () => q("note-delete-confirm-go")!.click());
		assert.equal(deletes, 1);
		assert.equal(button("Prefers mornings.")!.disabled, true);
		await act(async () => finish());
		await act(() => new Promise((r) => setTimeout(r, 200)));
		assert.ok(!q("remembered-notes")!.textContent!.includes("Likes proofs."), "the deleted note is gone once it has faded out");
	});

	it("Remembered says there are no notes yet", async () => {
		globalThis.fetch = settingsFetch();
		await mount(<RememberedNotes />);
		assert.ok(q("remembered-notes")!.textContent!.includes("Nothing yet."));
	});
});
