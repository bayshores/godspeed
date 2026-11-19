/** The window's one settings record: read once, boot's values until then,
 *  saves that send only what changed and keep what the server stored. */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true });

const { createRoot } = await import("react-dom/client");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SettingsProvider, useSettings } = await import("../../src/frontend/components/settings-context.tsx");

type Settings = ReturnType<typeof useSettings>;
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let seen: Settings | undefined;
const events = new Map<string, (raw: string) => void>();
let reopen: (() => void) | undefined;
const calls: string[] = [];

function Probe() {
	seen = useSettings();
	return <span data-testid="name">{seen.teacherName}</span>;
}

/** The server: answers reads with `stored`, and a PATCH merges into it. */
function serve(stored: { version: number; general?: Record<string, unknown> }, { readFails = false } = {}) {
	const server = { readFails, record: stored };
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		calls.push(`${method} ${url}${typeof init?.body === "string" ? ` ${init.body}` : ""}`);
		if (method === "GET") return server.readFails ? Response.json({}, { status: 500 }) : Response.json({ settings: server.record });
		const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
		if (body.teacherName === "bad") return Response.json({ error: "bad name" }, { status: 400 });
		server.record = { ...server.record, general: { ...server.record.general, ...body } };
		return Response.json({ settings: server.record });
	}) as typeof fetch;
	return server;
}

async function mount() {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({
		onEvent: (name: string, cb: (raw: string) => void) => events.set(name, cb),
		onOpen: (cb: () => void) => {
			reopen = cb;
		},
		close() {},
	});
	await act(async () =>
		root!.render(
			<ServerEventsProvider connect={connect as never}>
				<SettingsProvider boot={{ teacherName: "Boot", sounds: false, startupSound: true }}>
					<Probe />
				</SettingsProvider>
			</ServerEventsProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 10));
	});
	return host;
}

afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	seen = undefined;
	events.clear();
	reopen = undefined;
	calls.length = 0;
	document.body.textContent = "";
	globalThis.fetch = originalFetch;
});

describe("SettingsProvider", () => {
	it("reads the record once, and takes its values over boot's", async () => {
		serve({ version: 3, general: { teacherName: "Ada" } });
		const host = await mount();
		assert.equal(host.textContent, "Ada");
		assert.equal(seen!.sounds, true);
		assert.deepEqual(calls, ["GET /api/settings"]);
	});

	it("keeps boot's values when the read fails", async () => {
		serve({ version: 3 }, { readFails: true });
		const host = await mount();
		assert.equal(seen!.record, null);
		assert.equal(host.textContent, "Boot");
		assert.equal(seen!.sounds, false);
	});

	it("a save sends only its fields and every reader gets what the server stored", async () => {
		serve({ version: 3, general: { teacherName: "Ada", activeSpace: "c29" } });
		const host = await mount();
		let failed: string | null = "unset";
		await act(async () => {
			failed = await seen!.patchGeneral({ teacherName: "Zed" });
		});
		assert.equal(failed, null);
		assert.equal(calls.at(-1), 'PATCH /api/settings/general {"teacherName":"Zed"}');
		assert.equal(host.textContent, "Zed");
		assert.equal(seen!.record?.general?.activeSpace, "c29");
	});

	it("a refused save gives the line to show and keeps the record", async () => {
		serve({ version: 3, general: { teacherName: "Ada" } });
		const host = await mount();
		let failed: string | null = null;
		await act(async () => {
			failed = await seen!.patchGeneral({ teacherName: "bad" });
		});
		assert.equal(failed, "general: bad name");
		assert.equal(host.textContent, "Ada");
	});

	it("a rule change reads the whole record again; a failed read keeps it", async () => {
		const server = serve({ version: 3, general: { teacherName: "Ada" } });
		await mount();
		const ruleChanged = () =>
			act(async () => {
				events.get("rules-changed")!(JSON.stringify({}));
				await new Promise((r) => setTimeout(r, 10));
			});
		server.record = { version: 3, general: { teacherName: "Zed" }, agent: { rules: { voice: ["No jokes"] } } } as typeof server.record;
		await ruleChanged();
		assert.equal(seen!.teacherName, "Zed");
		assert.deepEqual(seen!.record?.agent, { rules: { voice: ["No jokes"] } });
		server.readFails = true;
		await ruleChanged();
		assert.equal(seen!.teacherName, "Zed");
		assert.equal(calls.filter((c) => c.startsWith("GET")).length, 3);
	});

	it("a reconnect and refresh read the record again; a failed read keeps it", async () => {
		const server = serve({ version: 3, general: { teacherName: "Ada" } });
		await mount();
		const reads = () => calls.filter((c) => c.startsWith("GET")).length;
		const before = reads();
		server.record = { version: 3, general: { teacherName: "Zed" } };
		await act(async () => {
			reopen!();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.equal(seen!.teacherName, "Zed");
		server.record = { version: 3, general: { teacherName: "Kay" } };
		await act(async () => seen!.refresh());
		assert.equal(seen!.teacherName, "Kay");
		server.readFails = true;
		await act(async () => seen!.refresh());
		assert.equal(seen!.record?.general?.teacherName, "Kay");
		assert.equal(reads(), before + 3);
	});
});
