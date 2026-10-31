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
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	// The agent menu (MenuShell) places itself on the next frame.
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { SettingsDialogBody, sectionFor } = await import("../src/components/settings/settings-dialog.tsx");
const { ConnectionSection } = await import("../src/components/settings/connection-section.tsx");
const { maskToken } = await import("../src/components/mcp-access.ts");
const { ServerEventsProvider } = await import("../src/components/server-events.tsx");
const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

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
};

/** The Connection section's reads: the access view, the saved notes and the godspeed folder. */
function connectionFetch(access: object, notes: object[] = []) {
	return (async (url: string) => {
		const path = String(url);
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

	it("General holds the update rows and the Graph group (extraction, chunk budget)", async () => {
		globalThis.fetch = (async () => Response.json({ settings: { version: 1 } })) as typeof fetch;
		await mount(<SettingsDialogBody initialSection="general" onClose={() => {}} />);
		assert.equal(q("settings-section-title")!.textContent, "General");
		assert.ok(q("row-version"));
		const graph = q("section-graph")!;
		assert.ok(graph, "the Graph group");
		for (const id of ["graph-row-enabled", "graph-row-chunk-tokens"]) {
			assert.ok(graph.querySelector(`[data-testid="${id}"]`), id);
		}
		assert.equal(graph.querySelector('[data-testid="graph-row-rendering"]'), null, "the dead rendering switch is gone");
	});

	it("Connection: Access, the token masked, connection status, and the button that opens your agent", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_a91f", url: "http://127.0.0.1:47613/api/mcp", agentConnected: true, agentTeaching: true, pendingWork: 1 });
		const el = await mount(<ConnectionSection />);
		const text = el.textContent!;
		for (const label of ["Access", "Connection", "Access token", "Your agent", "Open Claude Code", "Copy the command"]) {
			assert.ok(text.includes(label), label);
		}
		assert.equal(q("agent-token")!.textContent, "••••••••••••a91f");
		assert.ok(!text.includes("tok_secret_a91f"), "the token is never shown whole");
		assert.equal(q("agent-status")!.textContent, "Your agent · 1 job");
		assert.equal(q("agent-folder-path")!.textContent, "Folder: ~/godspeed");
		assert.ok(!text.includes("/plugin"), "no plugin to install");
	});

	it("access is always on: no on/off switch, setup always shown", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_b22c", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<ConnectionSection />);
		assert.ok(!el.textContent!.includes("Let outside agents connect"));
		assert.equal(el.querySelector('[role="switch"]'), null);
		assert.ok(el.textContent!.includes("Your agent"));
		assert.equal(q("agent-status")!.textContent, "No agent connected");
	});

	it("a connected agent that isn't teaching says so, with how to start it", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_d", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, agentTeaching: false, agentName: "Codex", pendingWork: 0 });
		await mount(<ConnectionSection />);
		assert.equal(q("agent-status")!.textContent, "Codex connected, not teaching");
		assert.equal(q("agent-teach-hint")!.textContent, "Tell Codex to start teaching.");
	});

	it("the menu switches the button to Codex, and Other app shows the address and a masked token", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_e77e", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<ConnectionSection />);
		const pick = async (id: string) => {
			await act(async () => q("open-agent-menu")!.click());
			await act(async () => {
				q(id)!.click();
				await new Promise((r) => setTimeout(r, 10));
			});
		};
		await pick("open-agent-codex");
		assert.equal(q("open-agent")!.textContent, "Open Codex");
		await pick("open-agent-other");
		assert.equal(q("open-agent")!.textContent, "Show the setup");
		assert.ok(el.textContent!.includes("Add a Streamable HTTP MCP server"));
		assert.ok(el.textContent!.includes("http://127.0.0.1:1/api/mcp"));
		assert.ok(el.textContent!.includes("Bearer ••••••••••••e77e"));
		assert.ok(!el.textContent!.includes("Copy the command"), "no command for another app");
	});

	it("New token asks first, then says to copy the new config", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (String(url).startsWith("/api/agent-notes")) return Response.json({ notes: [] });
			if (String(url).startsWith("/api/agent-folder")) return Response.json(FOLDER);
			calls.push(init?.method ?? "GET");
			return Response.json({ token: init?.method === "POST" ? "tok_new_2222" : "tok_old_1111", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		}) as unknown as typeof fetch;
		await mount(<ConnectionSection />);
		await act(async () => q("agent-new-token")!.click());
		assert.ok(q("agent-new-token-confirm")!.textContent!.includes("Other MCP apps will need the new token. Continue?"));
		assert.ok(!calls.includes("POST"), "nothing changes until Continue");
		await act(async () => {
			q("agent-new-token-continue")!.click();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.ok(calls.includes("POST"));
		assert.equal(q("agent-new-token-confirm"), null);
		assert.ok(q("agent-new-token-note")!.textContent!.includes("Claude Code and Codex pick it up by themselves"));
		assert.equal(q("agent-token")!.textContent, "••••••••••••2222");
	});

	it("Copy puts the whole token on the clipboard and says Copied", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_a91f", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<ConnectionSection />);
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
		await mount(<ConnectionSection />);
		await act(async () => q("agent-new-token")!.click());
		await act(async () => q("agent-new-token-continue")!.click());
		assert.equal((q("agent-new-token-continue") as HTMLButtonElement).disabled, true);
		await act(async () => q("agent-new-token-continue")!.click());
		assert.equal(posts, 1);
	});

	it("Remembered lists the agent's notes with a Delete button", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_c", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, pendingWork: 0 }, [
			{ id: "note_1", text: "CSE 29 exam is done.", className: "CSE 29", createdAt: "2026-10-30T02:00:00Z" },
		]);
		const el = await mount(<ConnectionSection />);
		const list = q("remembered-notes")!;
		assert.ok(list.textContent!.includes("CSE 29 exam is done."));
		assert.ok(list.textContent!.includes("CSE 29, saved"));
		assert.ok(el.querySelector('[aria-label="Delete note: CSE 29 exam is done."]'));
	});

	it("Remembered says there are no notes yet", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_c", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, pendingWork: 0 });
		await mount(<ConnectionSection />);
		assert.ok(q("remembered-notes")!.textContent!.includes("Nothing yet."));
	});

	it("masks the token", () => {
		assert.equal(maskToken("abcdef123456"), "••••••••••••3456");
		assert.equal(maskToken("abc"), "abc");
	});
});
