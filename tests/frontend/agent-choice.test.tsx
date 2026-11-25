/**
 * The agent that runs the lessons is kept on the server: the agent an older godspeed kept in the
 * window goes there once and leaves the window, and a pick in "Use another agent" goes there too.
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
const { useAgentChoice } = await import("../../src/frontend/components/agent-folder/use-agent-folder.ts");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");

const KEY = "lh-folder-agent";
const FOLDER = { folder: "/home/ada/godspeed", short: "~/godspeed", exists: true, commands: { claude: "claude", codex: "codex" }, startCommands: {}, oldSetup: { plugin: false, codex: false } };
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

/** The agent choice as "Use another agent" holds it, in the window's folder provider. */
async function withChoice(run: (choice: () => ReturnType<typeof useAgentChoice>) => Promise<void>) {
	let current: ReturnType<typeof useAgentChoice> | null = null;
	function Probe() {
		current = useAgentChoice();
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
		await run(() => current!);
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
			assert.equal(choice()[0], "codex", "the server's agent is the one picked");
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
			assert.equal(choice()[0], "claude", "the server's agent shows");
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

	it("a pick goes to the server, also of Claude Code before any pick; Other app stays in this window", async () => {
		await withChoice(async (choice) => {
			assert.equal(choice()[0], "claude", "Claude Code shows before a pick, as lessons run on it");
			await act(async () => choice()[1]("claude"));
			await settle();
			assert.deepEqual(picks, [{ agent: "claude" }], "picked now");
			picks.length = 0;
			await act(async () => choice()[1]("codex"));
			await settle();
			assert.deepEqual(picks, [{ agent: "codex" }]);
			assert.equal(choice()[0], "codex");
			await act(async () => choice()[1]("other"));
			assert.equal(choice()[0], "other");
			await act(async () => choice()[1]("codex"));
			await settle();
			assert.deepEqual(picks, [{ agent: "codex" }], "the agent it already keeps is not sent again");
			assert.equal(choice()[0], "codex");
		});
	});
});
