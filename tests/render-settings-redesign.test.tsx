/**
 * The settings restyle (redesign plan, Phase 6 — design/exports/
 * settings.html): requested sections land where they live now (the old
 * Graph rows are in General), the Outside agents section reads as the
 * design's rows (Access: switch, Connection, Access token; Setup: Claude
 * Code, Codex, Other MCP apps), and its helpers.
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
const { SettingsDialogBody, sectionFor } = await import("../components/settings/settings-dialog.tsx");
const { AgentsSection, CLAUDE_CODE_SETUP, codexConfig, maskToken } = await import("../components/settings/agents-section.tsx");

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

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	globalThis.fetch = originalFetch;
});

describe("settings restyle", () => {
	it("sectionFor: graph opens General; unknown ids land on Outside agents", () => {
		assert.equal(sectionFor("graph"), "general");
		assert.equal(sectionFor("general"), "general");
		assert.equal(sectionFor("providers"), "agents", "the removed Providers section lands on Outside agents");
		assert.equal(sectionFor(undefined), "agents");
		assert.equal(sectionFor("nope"), "agents");
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

	it("Outside agents: Access and Setup rows, the token masked, connection status", async () => {
		globalThis.fetch = (async () =>
			Response.json({ token: "tok_secret_a91f", url: "http://127.0.0.1:47613/api/mcp", agentConnected: true, pendingWork: 1 })) as typeof fetch;
		const el = await mount(<AgentsSection />);
		const text = el.textContent!;
		for (const label of ["Access", "Connection", "Access token", "Setup", "Claude Code", "Codex", "Other MCP apps"]) {
			assert.ok(text.includes(label), label);
		}
		assert.equal(q("agent-token")!.textContent, "••••••••••••a91f");
		assert.ok(!text.includes("tok_secret_a91f"), "the token is never shown whole");
		assert.equal(q("agent-status")!.textContent, "Outside agent · 1 job");
		assert.ok(text.includes("127.0.0.1:47613/api/mcp"));
		assert.ok(el.querySelector('[aria-label="Copy Codex config"]'));
	});

	it("access is always on: no on/off switch, setup always shown", async () => {
		globalThis.fetch = (async () => Response.json({ token: "tok_secret_b22c", url: "http://127.0.0.1:1/api/mcp", agentConnected: false, pendingWork: 0 })) as typeof fetch;
		const el = await mount(<AgentsSection />);
		assert.ok(!el.textContent!.includes("Let outside agents connect"));
		assert.equal(el.querySelector('[role="switch"]'), null);
		assert.ok(el.textContent!.includes("Setup"));
		assert.equal(q("agent-status")!.textContent, "No agent connected");
	});

	it("helpers: masked token, both Claude Code commands, the Codex block", () => {
		assert.equal(maskToken("abcdef123456"), "••••••••••••3456");
		assert.equal(maskToken("abc"), "abc");
		assert.equal(CLAUDE_CODE_SETUP.split("\n").length, 2);
		assert.match(codexConfig("http://x/api/mcp", "T"), /url = "http:\/\/x\/api\/mcp"\nhttp_headers = \{ "Authorization" = "Bearer T" \}/);
	});
});
