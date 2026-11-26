/**
 * The agent that runs the lessons is kept on the server: the agent an older godspeed kept in the
 * window goes there once and leaves the window. (The setup card's pick: render-agent-card.test.tsx.)
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const { AgentFolderProvider } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");
const { useAgentFolderView } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");

const KEY = "lh-folder-agent";
const FOLDER = { folder: "/home/ada/godspeed", short: "~/godspeed", exists: true, startCommands: {}, oldSetup: { plugin: false, codex: false }, model: {} };
const noEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

const stored = new Map<string, string>();
/** The PATCH bodies the server got. */
const picks: unknown[] = [];
/** The agent the server keeps (null before a pick), and whether a pick fails. */
let agent: string | null = null;
let failPicks = false;
const realFetch = globalThis.fetch;
const realError = console.error;
const logged: unknown[][] = [];
beforeEach(() => {
	stored.clear();
	picks.length = 0;
	logged.length = 0;
	agent = null;
	failPicks = false;
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) },
	});
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method === "PATCH") {
			const body = JSON.parse(String(init.body)) as { agent: string };
			picks.push(body);
			if (failPicks) return Response.json({ error: "Couldn't save it" }, { status: 500 });
			agent = body.agent;
		}
		return Response.json({ ...FOLDER, agent });
	}) as typeof fetch;
	console.error = (...args: unknown[]) => void logged.push(args);
});
afterEach(() => {
	globalThis.fetch = realFetch;
	console.error = realError;
});

const settle = () => act(() => new Promise((done) => setTimeout(done, 20)));

/** The agent the window shows as picked (Claude Code before a pick), in the window's folder provider. */
async function withChoice(run: (picked: () => string) => Promise<void>) {
	let current = "claude";
	function Probe() {
		current = useAgentFolderView().view?.agent ?? "claude";
		return null;
	}
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () =>
			root.render(
				<ServerEventsProvider connect={noEvents as never}>
					<AgentFolderProvider>
						<Probe />
					</AgentFolderProvider>
				</ServerEventsProvider>,
			),
		);
		await settle();
		await run(() => current);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

describe("the agent that runs the lessons", () => {
	it("an agent an older godspeed kept in the window goes to the server once, then leaves the window", async () => {
		stored.set(KEY, "codex");
		await withChoice(async (choice) => {
			assert.deepEqual(picks, [{ agent: "codex" }]);
			assert.equal(stored.has(KEY), false, "the window no longer keeps it");
			assert.equal(choice(), "codex", "the server's agent is the one picked");
		});
		await withChoice(async () => {
			assert.deepEqual(picks, [{ agent: "codex" }], "a later start sends nothing");
		});
	});

	it("one the server could not take stays in the window for the next start, and the failure is logged", async () => {
		stored.set(KEY, "codex");
		failPicks = true;
		await withChoice(async (choice) => {
			assert.deepEqual(picks, [{ agent: "codex" }]);
			assert.equal(stored.get(KEY), "codex");
			assert.equal(choice(), "claude", "the server's agent shows");
			assert.match(String(logged[0]?.[0]), /\[agent folder\]/);
		});
	});

	it("a kept value that names no agent is dropped with nothing sent", async () => {
		stored.set(KEY, "other");
		await withChoice(async () => {
			assert.deepEqual(picks, []);
			assert.equal(stored.has(KEY), false);
		});
	});
});
