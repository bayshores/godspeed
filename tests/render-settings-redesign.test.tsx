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
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { SettingsDialogBody, sectionFor } = await import("../src/components/settings/settings-dialog.tsx");
const { ConnectionSection, CLAUDE_CODE_SETUP, codexConfig, maskToken } = await import("../src/components/settings/connection-section.tsx");

const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLElement | undefined;
async function mount(element: React.ReactElement) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(element));
	await act(async () => {
		await new Promise((r) => setTimeout(r, 10));
	});
	return host;
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** The Connection section's two reads: the access view and the saved notes. */
function connectionFetch(access: object, notes: object[] = []) {
	return (async (url: string) => Response.json(String(url).startsWith("/api/agent-notes") ? { notes } : access)) as unknown as typeof fetch;
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

	it("Connection: Access and Setup rows, the token masked, connection status", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_a91f", url: "http://127.0.0.1:47613/api/mcp", agentConnected: true, agentTeaching: true, pendingWork: 1 });
		const el = await mount(<ConnectionSection />);
		const text = el.textContent!;
		for (const label of ["Access", "Connection", "Access token", "Setup", "Claude Code", "Codex", "Other MCP apps"]) {
			assert.ok(text.includes(label), label);
		}
		assert.equal(q("agent-token")!.textContent, "••••••••••••a91f");
		assert.ok(!text.includes("tok_secret_a91f"), "the token is never shown whole");
		assert.equal(q("agent-status")!.textContent, "Your agent · 1 job");
		assert.ok(text.includes("127.0.0.1:47613/api/mcp"));
		assert.ok(el.querySelector('[aria-label="Copy Codex config"]'));
	});

	it("access is always on: no on/off switch, setup always shown", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_secret_b22c", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<ConnectionSection />);
		assert.ok(!el.textContent!.includes("Let outside agents connect"));
		assert.equal(el.querySelector('[role="switch"]'), null);
		assert.ok(el.textContent!.includes("Setup"));
		assert.equal(q("agent-status")!.textContent, "No agent connected");
	});

	it("a connected agent that isn't teaching says so, with how to start it", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_d", url: "http://127.0.0.1:1/api/mcp", agentConnected: true, agentTeaching: false, agentName: "Codex", pendingWork: 0 });
		await mount(<ConnectionSection />);
		assert.equal(q("agent-status")!.textContent, "Codex connected, not teaching");
		assert.equal(q("agent-teach-hint")!.textContent, "Ask Codex to teach you with the godspeed tools.");
	});

	it("the setup steps show as text, not only on hover", async () => {
		globalThis.fetch = connectionFetch({ token: "tok_e", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		const el = await mount(<ConnectionSection />);
		assert.ok(el.textContent!.includes("In Claude Code, run these one at a time"));
		assert.ok(el.textContent!.includes("Add this to ~/.codex/config.toml"));
		assert.ok(el.textContent!.includes("Use a Streamable HTTP server"));
	});

	it("New token asks first, then says to copy the new config", async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (String(url).startsWith("/api/agent-notes")) return Response.json({ notes: [] });
			calls.push(init?.method ?? "GET");
			return Response.json({ token: init?.method === "POST" ? "tok_new_2222" : "tok_old_1111", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 });
		}) as unknown as typeof fetch;
		await mount(<ConnectionSection />);
		await act(async () => q("agent-new-token")!.click());
		assert.ok(q("agent-new-token-confirm")!.textContent!.includes("Codex and other apps will need the new config. Continue?"));
		assert.ok(!calls.includes("POST"), "nothing changes until Continue");
		await act(async () => {
			q("agent-new-token-continue")!.click();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.ok(calls.includes("POST"));
		assert.equal(q("agent-new-token-confirm"), null);
		assert.ok(q("agent-new-token-note")!.textContent!.includes("Copy the Codex config"));
		assert.equal(q("agent-token")!.textContent, "••••••••••••2222");
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

	it("helpers: masked token, both Claude Code commands, the Codex block", () => {
		assert.equal(maskToken("abcdef123456"), "••••••••••••3456");
		assert.equal(maskToken("abc"), "abc");
		assert.equal(CLAUDE_CODE_SETUP.split("\n").length, 2);
		assert.match(codexConfig("http://x/api/mcp", "T"), /url = "http:\/\/x\/api\/mcp"\nhttp_headers = \{ "Authorization" = "Bearer T" \}/);
		assert.match(codexConfig("http://x/api/mcp", "T"), /\ntool_timeout_sec = 600$/, "long waits cost Codex fewer model turns");
	});
});
