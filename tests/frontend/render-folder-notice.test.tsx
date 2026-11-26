/**
 * The folder notice's "Set up my folder" picks the old setup's agent and
 * makes the folder: lessons run in it by themselves.
 */
import "../window-dom.ts";
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const { FolderNotice } = await import("../../src/frontend/components/agent-folder/folder-notice.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AgentFolderProvider } = await import("../../src/frontend/components/agent-folder/agent-folder-context.tsx");

const FOLDER = {
	folder: "/home/ada/godspeed",
	short: "~/godspeed",
	exists: true,
	startCommands: {},
	oldSetup: { plugin: false, codex: false },
	agent: "claude",
	model: {},
};

const stored = new Map<string, string>();
const realFetch = globalThis.fetch;
/** The agent the server keeps for the next test's folder; null before a pick. */
let serverAgent: string | null = "claude";
/** What the page asked the server to change. */
const changes: string[] = [];
beforeEach(() => {
	stored.clear();
	changes.length = 0;
	serverAgent = "claude";
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v), removeItem: (k: string) => void stored.delete(k) },
	});
	globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method) changes.push(`${init.method} ${String(init.body)}`);
		if (init?.method === "PATCH") serverAgent = (JSON.parse(String(init.body)) as { agent: string }).agent;
		return Response.json({ ...FOLDER, agent: serverAgent });
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

type Root = ReturnType<typeof createRoot>;
const noEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

/** Renders under the server's events and the folder's one read, as the app does. */
async function mounted(render: (root: Root) => Promise<void>, run: () => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const inEvents = { render: (node: React.ReactNode) => root.render(
				<ServerEventsProvider connect={noEvents as never}>
					<AgentFolderProvider>{node}</AgentFolderProvider>
				</ServerEventsProvider>,
			), unmount: () => root.unmount() } as Root;
	try {
		await render(inEvents);
		await settle();
		await run();
	} finally {
		await act(async () => root.unmount());
		await settle();
		host.remove();
	}
}

describe("the folder notice's Set up my folder", () => {
	it("makes the folder for the old setup's agent", async () => {
		serverAgent = null;
		await mounted(
			(r) => act(async () => r.render(<FolderNotice agent="codex" afterWelcome={false} />)),
			async () => {
				assert.match(q("folder-notice")!.textContent!, /Codex teaches you from ~\/godspeed now\./);
				await act(async () => q("folder-notice-setup")!.click());
				await settle();
				assert.deepEqual(changes, ['PATCH {"agent":"codex"}', 'POST {"action":"setup"}']);
			},
		);
	});
});
