import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginFrame } from "../../src/frontend/components/plugins/plugin-frame.tsx";
import { createBridge, PROTOCOL_VERSION, type HostCalls, type PluginContext } from "../../src/frontend/components/plugins/plugin-frame-model.ts";
import type { PluginManifest } from "../../src/frontend/lib/plugins-api.ts";

/** The plugin frame and the MCP Apps host behind it: what a page can reach and what it can't. */

const PROBE = JSON.parse(readFileSync(new URL("../fixtures/plugins/probe/manifest.json", import.meta.url), "utf8")) as PluginManifest;

const CONTEXT: PluginContext = {
	space: { id: "cse21", name: "CSE 21" },
	topic: "Induction",
	question: { id: "q2", text: "Which step comes first?", options: ["Base case", "Inductive step"] },
	lastAnswered: { id: "q1", text: "What is n at the start?", options: ["0", "1"], answer: "1", correct: true },
	teacherMessage: "Start from n = 1.",
};

const ok = (value: unknown) => Promise.resolve({ error: null, value });

function harness(manifest: PluginManifest = PROBE, overrides: Partial<HostCalls> = {}, startContext: PluginContext = CONTEXT) {
	// What the screen holds now; a test changes it as the lesson would.
	const now = { context: startContext };
	const frame = { name: "the plugin's window" };
	const posted: Record<string, unknown>[] = [];
	const asked: unknown[][] = [];
	let ready = 0;
	const calls: HostCalls = {
		readStored: (key) => ok({ stored: key }),
		writeStored: (...args) => {
			asked.push(["writeStored", ...args]);
			return ok(true);
		},
		askAgent: (...args) => {
			asked.push(["askAgent", ...args]);
			return ok({ caption: "hi" });
		},
		readSpace: (id) => {
			asked.push(["readSpace", id]);
			return ok({ facts: [], lessons: [] });
		},
		openLink: () => true,
		...overrides,
	};
	const bridge = createBridge({
		manifest,
		values: { loud: true },
		frame: () => frame,
		post: (message) => posted.push(message as Record<string, unknown>),
		context: () => now.context,
		look: () => ({ theme: "light", variables: { "--color-text-primary": "#24231f" } }),
		calls,
		onReady: () => ready++,
	});
	let id = 0;
	const settle = () => new Promise((done) => setImmediate(done));
	/** Sends a request from the frame and waits for the host's answer. */
	const request = async (method: string, params?: object) => {
		const sent = ++id;
		bridge.receive(frame, { jsonrpc: "2.0", id: sent, method, ...(params ? { params } : {}) });
		await settle();
		return posted.find((m) => m.id === sent) as { result?: Record<string, unknown>; error?: { code: number; message: string } } | undefined;
	};
	const start = async () => {
		const init = await request("ui/initialize", { appInfo: { name: "probe", version: "1.0.0" }, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION });
		bridge.receive(frame, { jsonrpc: "2.0", method: "ui/notifications/initialized" });
		return init;
	};
	const tool = (name: string, args: object = {}) => request("tools/call", { name, arguments: args });
	return { frame, bridge, posted, asked, request, start, tool, settle, now, ready: () => ready };
}

describe("PluginFrame", () => {
	it("is a frame sandboxed to scripts alone, on the plugin's entry at localhost, hidden while it loads", () => {
		// The window is on 127.0.0.1: the frame's host is one no Tauri capability names.
		Object.defineProperty(globalThis, "location", { value: { port: "4100" }, configurable: true });
		const html = renderToStaticMarkup(createElement(PluginFrame, { manifest: { ...PROBE, entry: "app/start page.html" }, values: {}, context: CONTEXT }));
		assert.match(html, /<iframe[^>]* sandbox="allow-scripts"/);
		assert.doesNotMatch(html, /allow-same-origin/);
		assert.match(html, /src="http:\/\/localhost:4100\/plugin-files\/probe\/app\/start%20page\.html"/);
		assert.match(html, /title="Probe"/);
		assert.match(html, /data-state="loading"[^>]*class="[^"]*invisible/);
	});
});

describe("the MCP Apps handshake", () => {
	it("answers ui/initialize with the protocol, the look and the plugin's setting values, and is ready once initialized", async () => {
		const h = harness();
		const init = await h.start();
		assert.equal(init?.result?.protocolVersion, "2026-01-26");
		assert.deepEqual(init?.result?.hostCapabilities, { openLinks: {}, serverTools: {} });
		const context = init?.result?.hostContext as Record<string, unknown>;
		assert.equal(context.theme, "light");
		assert.deepEqual(context.styles, { variables: { "--color-text-primary": "#24231f" } });
		assert.deepEqual(context.settings, { loud: true });
		assert.equal(h.ready(), 1);
	});

	it("holds every tool call until ui/initialize, and answers ping before it", async () => {
		const h = harness();
		assert.deepEqual((await h.request("ping"))?.result, {});
		assert.equal((await h.tool("get_context"))?.error?.code, -32600);
		h.bridge.receive(h.frame, { jsonrpc: "2.0", method: "ui/notifications/initialized" });
		assert.equal(h.ready(), 0);
	});
});

describe("what the host hears", () => {
	it("ignores every message that isn't from this frame's window", async () => {
		const h = harness();
		for (const source of [{ name: "another window" }, null, undefined]) {
			h.bridge.receive(source, { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} });
			h.bridge.receive(source, { jsonrpc: "2.0", method: "ui/notifications/initialized" });
		}
		await h.settle();
		assert.equal(h.posted.length, 0);
		assert.equal(h.ready(), 0);
	});

	it("drops what isn't well-formed JSON-RPC, and answers from the frame", async () => {
		const h = harness();
		for (const data of [null, "ui/initialize", [], { method: "ui/initialize", id: 1 }, { jsonrpc: "1.0", method: "ping", id: 1 }, { jsonrpc: "2.0", id: 1 }, { jsonrpc: "2.0", id: 1, result: {} }, { jsonrpc: "2.0", method: "ping", id: { x: 1 } }, { jsonrpc: "2.0", method: "ping", id: 1, params: [1] }, { jsonrpc: "2.0", method: 5, id: 1 }]) {
			h.bridge.receive(h.frame, data);
		}
		await h.settle();
		assert.equal(h.posted.length, 0);
	});

	it("does nothing for a method it doesn't know: a request hears 'method not found', a notification nothing", async () => {
		const h = harness();
		await h.start();
		const before = h.posted.length;
		h.bridge.receive(h.frame, { jsonrpc: "2.0", method: "ui/notifications/whatever" });
		h.bridge.receive(h.frame, { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { width: 300, height: 9000 } });
		await h.settle();
		assert.equal(h.posted.length, before);
		for (const method of ["ui/message", "ui/update-model-context", "sampling/createMessage", "resources/read"]) {
			assert.equal((await h.request(method, {}))?.error?.code, -32601, method);
		}
	});
});

describe("a frame that navigates", () => {
	it("stops at its second page: nothing more is heard or answered, not even a request already running", async () => {
		let finish: (value: { error: null; value: unknown }) => void = () => {};
		const h = harness({ ...PROBE, uses: ["agent"] }, { askAgent: () => new Promise((done) => (finish = done)) });
		assert.equal(h.bridge.loaded(), true);
		await h.start();
		h.bridge.receive(h.frame, { jsonrpc: "2.0", id: "ask", method: "tools/call", params: { name: "ask_agent", arguments: { prompt: "A caption", schema: {} } } });
		await h.settle();
		const before = h.posted.length;
		assert.equal(h.bridge.loaded(), false);
		finish({ error: null, value: { caption: "for the plugin" } });
		assert.equal(await h.tool("get_context"), undefined);
		h.bridge.receive(h.frame, { jsonrpc: "2.0", id: 99, method: "ui/initialize", params: {} });
		h.bridge.receive(h.frame, { jsonrpc: "2.0", method: "ui/notifications/initialized" });
		await h.settle();
		assert.equal(h.posted.length, before);
		assert.equal(h.ready(), 1);
		assert.equal(h.bridge.loaded(), false);
	});
});

describe("telling the page of changes", () => {
	const notices = (h: ReturnType<typeof harness>) => h.posted.filter((m) => m.method === "ui/notifications/host-context-changed").map((m) => m.params);

	it("says nothing before the page is initialized, nor when nothing changed by value", async () => {
		const h = harness();
		h.now.context = { ...CONTEXT, topic: "Recursion" };
		h.bridge.changed();
		await h.request("ui/initialize", { appInfo: { name: "p", version: "1" }, appCapabilities: {}, protocolVersion: PROTOCOL_VERSION });
		h.bridge.changed();
		h.bridge.receive(h.frame, { jsonrpc: "2.0", method: "ui/notifications/initialized" });
		h.now.context = structuredClone(h.now.context);
		h.bridge.changed();
		assert.deepEqual(notices(h), []);
	});

	it("a lesson change is an empty notice, so the page calls get_context again; once per change", async () => {
		const h = harness();
		await h.start();
		h.now.context = { ...CONTEXT, question: null };
		h.bridge.changed();
		h.bridge.changed();
		assert.deepEqual(notices(h), [{}]);
		assert.deepEqual((await h.tool("get_context"))?.result?.structuredContent, { ...CONTEXT, question: null });
	});

	it("a stopped frame hears no notices", async () => {
		const h = harness();
		await h.start();
		h.bridge.loaded();
		h.bridge.loaded();
		h.now.context = { ...CONTEXT, topic: "Recursion" };
		h.bridge.changed();
		assert.deepEqual(notices(h), []);
	});
});

describe("host tools", () => {
	it("get_context gives what's on screen", async () => {
		const h = harness();
		await h.start();
		const got = await h.tool("get_context");
		assert.deepEqual(got?.result?.structuredContent, CONTEXT);
		assert.deepEqual(got?.result?.content, [{ type: "text", text: JSON.stringify(CONTEXT) }]);
	});

	it("refuses ask_agent and read_space to a plugin whose manifest doesn't use the agent or the space", async () => {
		const h = harness();
		await h.start();
		const ask = await h.tool("ask_agent", { prompt: "A caption", schema: {} });
		assert.deepEqual(ask?.error, { code: -32602, message: 'ask_agent needs "agent" in the manifest\'s uses.' });
		const space = await h.tool("read_space");
		assert.deepEqual(space?.error, { code: -32602, message: 'read_space needs "space" in the manifest\'s uses.' });
		assert.equal((await h.tool("toString"))?.error?.code, -32602);
		assert.deepEqual(h.asked, []);
	});

	it("ask_agent asks the agent for a plugin that uses it, and keeps a long request open with progress", async () => {
		mock.timers.enable({ apis: ["setInterval"] });
		try {
			let finish: (value: { error: null; value: unknown }) => void = () => {};
			const h = harness({ ...PROBE, uses: ["agent"] }, { askAgent: () => new Promise((done) => (finish = done)) });
			await h.start();
			h.bridge.receive(h.frame, { jsonrpc: "2.0", id: "ask", method: "tools/call", params: { name: "ask_agent", arguments: { prompt: "A caption", schema: { type: "object" } }, _meta: { progressToken: 7 } } });
			await h.settle();
			mock.timers.tick(45_000);
			assert.deepEqual(
				h.posted.filter((m) => m.method === "notifications/progress").map((m) => m.params),
				[
					{ progressToken: 7, progress: 1 },
					{ progressToken: 7, progress: 2 },
				],
			);
			finish({ error: null, value: { caption: "hi" } });
			await h.settle();
			assert.deepEqual((h.posted.find((m) => m.id === "ask") as { result: { structuredContent: unknown } }).result.structuredContent, { answer: { caption: "hi" } });
			mock.timers.tick(60_000);
			assert.equal(h.posted.filter((m) => m.method === "notifications/progress").length, 2);
		} finally {
			mock.timers.reset();
		}
	});

	it("a failed ask comes back as a tool error, not a broken request", async () => {
		const h = harness({ ...PROBE, uses: ["agent"] }, { askAgent: () => Promise.resolve({ error: "Your agent is still on this plugin's last request." }) });
		await h.start();
		const got = await h.tool("ask_agent", { prompt: "A caption", schema: {} });
		assert.deepEqual(got?.result, { content: [{ type: "text", text: "Your agent is still on this plugin's last request." }], isError: true });
	});

	it("read_space reads the open space, and says when none is open", async () => {
		const h = harness({ ...PROBE, uses: ["space"] });
		await h.start();
		assert.deepEqual((await h.tool("read_space"))?.result?.structuredContent, { facts: [], lessons: [] });
		assert.deepEqual(h.asked, [["readSpace", "cse21"]]);
		const none = harness({ ...PROBE, uses: ["space"] }, {}, { ...CONTEXT, space: null });
		await none.start();
		assert.equal((await none.tool("read_space"))?.result?.isError, true);
		assert.deepEqual(none.asked, []);
	});

	it("storage_get and storage_set reach the plugin's own storage by key", async () => {
		const h = harness();
		await h.start();
		assert.deepEqual((await h.tool("storage_get", { key: "best" }))?.result?.structuredContent, { value: { stored: "best" } });
		assert.deepEqual((await h.tool("storage_set", { key: "best", value: [1, 2] }))?.result?.structuredContent, {});
		assert.deepEqual(h.asked, [["writeStored", "best", [1, 2]]]);
		assert.equal((await h.tool("storage_set", { key: "best" }))?.error?.code, -32602);
		assert.equal((await h.tool("storage_get", { key: 5 }))?.error?.code, -32602);
	});
});

describe("ui/open-link", () => {
	it("opens web links only, and only when the host lets it", async () => {
		const opened: string[] = [];
		const h = harness(PROBE, {
			openLink: (url) => {
				opened.push(url);
				return true;
			},
		});
		await h.start();
		assert.deepEqual((await h.request("ui/open-link", { url: "https://api.memegen.link/" }))?.result, {});
		for (const url of ["javascript:alert(1)", "file:///etc/passwd", "http://", 5]) {
			assert.equal((await h.request("ui/open-link", { url }))?.error?.code, -32602, String(url));
		}
		assert.deepEqual(opened, ["https://api.memegen.link/"]);
		const refused = harness(PROBE, { openLink: () => false });
		await refused.start();
		assert.equal((await refused.request("ui/open-link", { url: "https://example.com/" }))?.error?.code, -32000);
	});
});
