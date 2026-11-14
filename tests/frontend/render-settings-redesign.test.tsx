/**
 * The settings dialog in a DOM: requested sections land where they live
 * (unknown ids open Connection), General holds the graph rows, and the
 * Connection section reads as the design's rows (Access: Connection,
 * Access token; Setup: Claude Code, Codex, Other MCP apps; Remembered) with
 * its helpers.
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
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { SettingsPage, sectionFor } = await import("../../src/frontend/components/settings/settings-page.tsx");
const { ConnectionSection } = await import("../../src/frontend/components/settings/connection-section.tsx");
const { WebSearch } = await import("../../src/frontend/components/settings/web-search.tsx");
const { RememberedNotes } = await import("../../src/frontend/components/settings/remembered-notes.tsx");
const { maskToken } = await import("../../src/frontend/components/mcp-access.ts");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AgentStatusProvider } = await import("../../src/frontend/components/agent-status.tsx");
const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
/** The section with the live agent status it reads. */
const Connection = () => (
	<AgentStatusProvider>
		<ConnectionSection />
	</AgentStatusProvider>
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
	commands: { claude: 'cd ~/godspeed && claude --settings .godspeed/claude-settings.json "Start teaching"', codex: "cd ~/godspeed && codex" },
	startCommands: {},
	oldSetup: { plugin: false, codex: false },
};

const NO_KEY = { keyEnd: null, used: null, limit: null, error: null };

/** The Connection section's reads: the access view, the saved notes, the godspeed folder and the search key. */
function connectionFetch(access: object, { notes = [], search = NO_KEY }: { notes?: object[]; search?: object } = {}) {
	return (async (url: string) => {
		const path = String(url);
		if (path.startsWith("/api/web-search")) return Response.json(search);
		return Response.json(path.startsWith("/api/agent-notes") ? { notes } : path.startsWith("/api/agent-folder") ? FOLDER : access);
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
	it("sectionFor: known ids open their section; anything else lands on Connection", () => {
		assert.equal(sectionFor("general"), "general");
		assert.equal(sectionFor("teaching"), "teaching");
		assert.equal(sectionFor("agent"), "connection", "the old Agent section id");
		assert.equal(sectionFor(undefined), "connection");
		assert.equal(sectionFor("nope"), "connection");
	});

	it("General holds the update rows, and no Lessons and graph group (the graph switch is in Teaching)", async () => {
		globalThis.fetch = (async () => Response.json({ settings: { version: 1 } })) as typeof fetch;
		await mount(<SettingsPage section="general" />);
		assert.equal(q("settings-nav-general")!.getAttribute("aria-current"), "true");
		assert.ok(q("row-version"));
		assert.ok(q("group-lessons") === null);
		assert.ok(q("graph-row-enabled") === null);
	});

	it("Escape in the teacher name field drops the edit without saving it", async () => {
		const puts: string[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (init?.method === "PUT") puts.push(String(url));
			return Response.json({ settings: { version: 1 } });
		}) as typeof fetch;
		await mount(<SettingsPage section="general" />);
		const input = q("teacher-name") as HTMLInputElement;
		await act(async () => {
			Object.defineProperty(input, "value", { configurable: true, writable: true, value: "Ada" });
			input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		const escape = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(escape, "key", { value: "Escape" });
		await act(async () => input.dispatchEvent(escape));
		assert.equal(escape.defaultPrevented, true, "the field claims its Escape");
		assert.deepEqual(puts, [], "the dropped edit is not saved");
	});

	it("Connection: the two windows, the folder and the token masked (web search is in Teaching)", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_a91f", url: "http://127.0.0.1:47613/api/mcp", agentConnected: true, agentTeaching: true, pendingWork: 1 });
		const el = await mount(<Connection />);
		const text = el.textContent!;
		for (const label of ["Teacher", "Helper", "Access token", "Copy the command"]) {
			assert.ok(text.includes(label), label);
		}
		assert.ok(q("web-search") === null);
		assert.equal(q("agent-token")!.textContent, "••••••••••••a91f");
		assert.ok(!text.includes("tok_secret_a91f"), "the token is never shown whole");
		assert.equal(q("agent-status")!.textContent, "The teacher window is open");
		assert.equal(q("agent-window-teacher-chip")!.textContent, "Teaching");
		assert.ok(q("agent-window-teacher-open") === null);
		assert.equal(q("agent-window-helper-chip")!.textContent, "Closed");
		assert.equal(q("agent-window-helper-open")!.textContent, "Open helper");
		assert.equal(q("agent-folder-path")!.textContent, "~/godspeed");
		assert.ok(!text.includes("/plugin"), "no plugin to install");
		assert.ok(q("old-setup-warning") === null, "nothing old left: no warning");
	});

	it("both windows open: the helper covers while the teacher tidies its memory", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_h", agentConnected: true, agentTeaching: true, helperHere: true, helperCovering: true, pendingWork: 1 });
		await mount(<Connection />);
		assert.equal(q("agent-status")!.textContent, "Both windows are open");
		assert.equal(q("agent-window-helper")!.getAttribute("data-tone"), "busy");
		assert.equal(q("agent-window-helper-chip")!.textContent, "Covering");
		assert.equal(q("agent-window-helper-line")!.textContent, "Answering for Teacher for a minute");
		assert.equal(q("agent-window-teacher-line")!.textContent, "Tidying its memory");
		assert.ok(q("agent-window-helper-open") === null);
	});

	it("warns about the old plugin left on the computer, and Remove says to restart open chats", async () => {
		const posted: unknown[] = [];
		const left = { ...FOLDER, exists: true, oldSetup: { plugin: true, codex: false } };
		const access = { token: "tok_secret_c33d", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, pendingWork: 0 };
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.startsWith("/api/agent-folder")) {
				if (init?.method === "POST") {
					posted.push(JSON.parse(String(init.body)));
					return Response.json({ ...left, oldSetup: { plugin: false, codex: false } });
				}
				return Response.json(left);
			}
			return Response.json(path.startsWith("/api/agent-notes") ? { notes: [] } : access);
		}) as unknown as typeof fetch;
		await mount(<Connection />);
		const warning = q("old-setup-warning")!;
		assert.match(warning.textContent!, /Old godspeed plugin found\./);
		await act(async () => warning.querySelector("button")!.click());
		assert.deepEqual(posted, [{ action: "remove-old-setup" }]);
		assert.ok(q("old-setup-warning") === null);
		assert.ok(document.body.textContent!.includes("Removed. Restart any open Claude Code chats to finish."));
	});

	it("access is always on: no on/off switch, and closed windows carry their own buttons", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_b22c", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<Connection />);
		assert.ok(!el.textContent!.includes("Let outside agents connect"));
		assert.ok(el.querySelector('[role="switch"]') === null);
		assert.equal(q("agent-status")!.textContent, "No window is open");
		assert.equal(q("agent-window-teacher-open")!.textContent, "Open teacher");
		assert.equal(q("agent-window-helper-open")!.textContent, "Open helper");
	});

	it("a connected agent that isn't teaching says how to start it", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_d", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, agentTeaching: false, agentName: "Codex", pendingWork: 0 });
		const el = await mount(<Connection />);
		assert.equal(q("agent-window-teacher-chip")!.textContent, "Open");
		assert.equal(q("agent-window-teacher-line")!.textContent, "Tell Codex to start teaching.");
		assert.ok(el.textContent!.includes("Your agent is Codex"));
	});

	it("a lesson waiting with no agent says so on the teacher's tile", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_w", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, agentTeaching: false, pendingWork: 2, pendingTurns: 1 });
		await mount(<Connection />);
		assert.equal(q("agent-window-teacher-line")!.textContent, "Your lesson is waiting");
	});

	it("the menu switches the agent to Codex, and Other app shows the address and a masked token", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_e77e", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<Connection />);
		const pick = async (id: string) => {
			await act(async () => q("open-agent-menu")!.click());
			await act(async () => {
				q(id)!.click();
				await new Promise((r) => setTimeout(r, 10));
			});
		};
		await pick("open-agent-codex");
		assert.ok(el.textContent!.includes("Your agent is Codex"));
		await pick("open-agent-other");
		assert.ok(q("agent-window-teacher-open") === null, "godspeed can't open another app");
		assert.ok(el.textContent!.includes("Add a Streamable HTTP MCP server"));
		assert.ok(el.textContent!.includes('tell it "Start as the helper"'));
		assert.ok(el.textContent!.includes("http://127.0.0.1:1/api/mcp"));
		assert.ok(el.textContent!.includes("Bearer ••••••••••••e77e"));
		assert.ok(!el.textContent!.includes("Copy the command"), "no command for another app");
	});

	it("Web search: the agent's own search until a key is saved, then Tavily with its count", async () => {
		const calls: string[] = [];
		const access = { token: "tok_s", agentConnected: false, pendingWork: 0 };
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (!path.startsWith("/api/web-search")) return Response.json(path.startsWith("/api/agent-folder") ? FOLDER : access);
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
			if (!path.startsWith("/api/web-search")) return Response.json(path.startsWith("/api/agent-folder") ? FOLDER : { token: "tok_s" });
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

		globalThis.fetch = connectionFetch({ token: "tok_s" }, { search: { keyEnd: "4f2a", used: null, limit: null, error: "This key is out of searches for now." } });
		await mount(<WebSearch />);
		assert.equal(q("web-search-error")!.textContent, "This key is out of searches for now. Your agent's own search is used until it works again.");
		assert.ok(q("web-search-agent")!.hasAttribute("data-picked"), "the agent's own search is the one in use");
	});

	it("Change command opens a box for the picked agent's own start command, and Save keeps it", async () => {
		const posted: unknown[] = [];
		const access = { token: "tok_f", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 };
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (!path.startsWith("/api/agent-folder")) return Response.json(path.startsWith("/api/agent-notes") ? { notes: [] } : access);
			if (init?.method !== "POST") return Response.json(FOLDER);
			const body = JSON.parse(String(init.body)) as { command: string };
			posted.push(body);
			return Response.json({ ...FOLDER, startCommands: { claude: body.command } });
		}) as unknown as typeof fetch;
		const el = await mount(<Connection />);
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
		assert.ok(q("agent-start-command") === null, "saved: the box closes");
		await act(async () => q("agent-start-command-change")!.click());
		assert.equal(el.querySelector<HTMLInputElement>("#agent-start-command-input")!.value, "standardcompute launch claude --", "the saved command is there to edit");
	});

	it("New token asks first, then says to copy the new config", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (String(url).startsWith("/api/agent-notes")) return Response.json({ notes: [] });
			if (String(url).startsWith("/api/agent-folder")) return Response.json(FOLDER);
			calls.push(init?.method ?? "GET");
			return Response.json({ token: init?.method === "POST" ? "tok_new_2222" : "tok_old_1111", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		}) as unknown as typeof fetch;
		await mount(<Connection />);
		await act(async () => q("agent-new-token")!.click());
		assert.ok(q("agent-new-token-confirm")!.textContent!.includes("Other MCP apps will need the new token. Continue?"));
		assert.ok(!calls.includes("POST"), "nothing changes until Continue");
		await act(async () => {
			q("agent-new-token-continue")!.click();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.ok(calls.includes("POST"));
		assert.ok(q("agent-new-token-confirm") === null);
		assert.ok(q("agent-new-token-note")!.textContent!.includes("Claude Code and Codex pick it up by themselves"));
		assert.equal(q("agent-token")!.textContent, "••••••••••••2222");
	});

	it("Copy puts the whole token on the clipboard and says Copied", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_a91f", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<Connection />);
		const copied: string[] = [];
		Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (t: string) => void copied.push(t) } } });
		const button = el.querySelector<HTMLButtonElement>('[aria-label="Copy access token"]')!;
		await act(async () => button.click());
		assert.deepEqual(copied, ["tok_secret_a91f"]);
		assert.equal(button.textContent, "Copied");
	});

	it("Continue is off while the new token is being made, so a double click makes one token", async () => {
		let posts = 0;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (String(url).startsWith("/api/agent-notes")) return Response.json({ notes: [] });
			if (String(url).startsWith("/api/agent-folder")) return Response.json(FOLDER);
			if (init?.method === "POST") {
				posts += 1;
				return new Promise<Response>(() => {});
			}
			return Response.json({ token: "tok_old_1111", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		}) as unknown as typeof fetch;
		await mount(<Connection />);
		await act(async () => q("agent-new-token")!.click());
		await act(async () => q("agent-new-token-continue")!.click());
		assert.equal((q("agent-new-token-continue") as HTMLButtonElement).disabled, true);
		await act(async () => q("agent-new-token-continue")!.click());
		assert.equal(posts, 1);
	});

	it("Remembered lists the agent's notes with a Delete button", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_c", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, pendingWork: 0 }, {
			notes: [{ id: "note_1", text: "CSE 29 exam is done.", spaceName: "CSE 29", createdAt: "2026-10-30T02:00:00Z" }],
		});
		const el = await mount(<RememberedNotes />);
		const list = q("remembered-notes")!;
		assert.ok(list.textContent!.includes("CSE 29 exam is done."));
		assert.ok(list.textContent!.includes("CSE 29, saved"));
		assert.ok(el.querySelector('[aria-label="Delete note: CSE 29 exam is done."]'));
	});

	it("Remembered sends one Delete per click: the button waits for its request", async () => {
		const notes = [{ id: "note_1", text: "Likes proofs.", spaceName: null, createdAt: "2026-10-30T02:00:00Z" }];
		const read = connectionFetch({ token: "tok_c", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, pendingWork: 0 }, { notes });
		let deletes = 0;
		let finish: () => void = () => {};
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (init?.method !== "DELETE") return read(url, init);
			deletes++;
			await new Promise<void>((resolve) => (finish = resolve));
			return Response.json({ notes: [] });
		}) as unknown as typeof fetch;
		const el = await mount(<RememberedNotes />);
		const button = () => el.querySelector<HTMLButtonElement>('[aria-label="Delete note: Likes proofs."]');
		await act(async () => button()!.click());
		assert.equal(button()!.disabled, true);
		await act(async () => button()!.click());
		assert.equal(deletes, 1);
		await act(async () => finish());
		assert.ok(q("remembered-notes")!.textContent!.includes("Nothing yet."));
	});

	it("Remembered says there are no notes yet", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_c", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, pendingWork: 0 });
		await mount(<RememberedNotes />);
		assert.ok(q("remembered-notes")!.textContent!.includes("Nothing yet."));
	});

	it("masks the token", () => {
		assert.equal(maskToken("abcdef123456"), "••••••••••••3456");
		assert.equal(maskToken("abc"), "abc");
	});
});
