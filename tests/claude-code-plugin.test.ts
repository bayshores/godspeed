/** The Claude Code plugin's scripts, run the way Claude Code runs them,
 *  against a stand-in godspeed (a local HTTP server) or a closed app. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scripts = path.join(import.meta.dirname, "..", "integrations", "claude-code", "godspeed", "scripts");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-plugin-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

interface Seen {
	body: Record<string, unknown>;
	headers: http.IncomingHttpHeaders;
	closedEarly: Promise<boolean>;
}

/** An HTTP 400 with a JSON-RPC error, the way the MCP SDK refuses a request. */
class Refusal {
	constructor(readonly error: { code: number; message: string }) {}
}

/** A stand-in app: `answer` returns a JSON-RPC result, a Refusal, or undefined to keep the request open. */
async function fakeApp(answer: (body: Record<string, unknown>) => unknown) {
	const seen: Seen[] = [];
	const server = http.createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = JSON.parse(raw) as Record<string, unknown>;
			seen.push({ body, headers: req.headers, closedEarly: new Promise((resolve) => res.on("close", () => resolve(!res.writableEnded))) });
			const result = answer(body);
			if (result === undefined) return;
			res.writeHead(result instanceof Refusal ? 400 : 200, { "content-type": "application/json" });
			res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...(result instanceof Refusal ? { error: result.error } : { result }) }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
	return { url, seen, close: () => { server.closeAllConnections(); server.close(); } };
}

function run(script: string, args: string[], url: string) {
	const child = spawn(process.execPath, [path.join(scripts, script), ...args], {
		env: { NODE_ENV: "test", PATH: process.env.PATH, GODSPEED_DATA_DIR: scratch, GODSPEED_MCP_URL: url, GODSPEED_MCP_TOKEN: "token", CLAUDE_CODE_SESSION_ID: "session-1" },
	});
	let stdout = "";
	child.stdout.on("data", (chunk) => (stdout += chunk));
	const exited = new Promise<{ code: number | null; stdout: string }>((resolve) => child.on("close", (code) => resolve({ code, stdout })));
	return { child, exited };
}

async function until(cond: () => boolean): Promise<void> {
	for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
	assert.ok(cond());
}

describe("the forget hook", () => {
	const seenFile = path.join(scratch, "agent-seen.json");
	const mark = { at: "2026-10-30T00:00:00.000Z", conversations: { chat_a: { count: 3, hash: "abc" } } };

	it("removes the session from the saved file itself when the app is closed", async () => {
		fs.writeFileSync(seenFile, JSON.stringify({ version: 1, agents: { "session-1": mark, other: mark } }));
		const closed = await fakeApp(() => ({}));
		closed.close();
		const { child, exited } = run("forget.mjs", [], closed.url);
		child.stdin.end(JSON.stringify({ session_id: "session-1", hook_event_name: "SessionStart" }));
		assert.equal((await exited).code, 0);
		assert.deepEqual(JSON.parse(fs.readFileSync(seenFile, "utf8")), { version: 1, agents: { other: mark } });
	});

	it("tells a running app, and says when /clear ended the session", async () => {
		const app = await fakeApp(() => ({}));
		try {
			const { child, exited } = run("forget.mjs", [], app.url);
			child.stdin.end(JSON.stringify({ session_id: "session-1", hook_event_name: "SessionEnd", reason: "clear" }));
			assert.equal((await exited).code, 0);
			assert.deepEqual(app.seen.map((s) => s.body), [{ agent: "session-1", cleared: true }]);
		} finally {
			app.close();
		}
	});
});

describe("the MCP connector", () => {
	it("sends the session id with tool calls, and closes a cancelled call's request", async () => {
		const app = await fakeApp((body) => (body.method === "tools/call" ? undefined : {}));
		const { child } = run("connect.mjs", [], app.url);
		try {
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "respond", arguments: {} } })}\n`);
			await until(() => app.seen.length === 1);
			const call = app.seen[0]!;
			assert.equal((call.body.params as { _meta: Record<string, string> })._meta["godspeed/agent"], "session-1");
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } })}\n`);
			assert.equal(await call.closedEarly, true, "godspeed sees the caller leave");
		} finally {
			child.kill();
			app.close();
		}
	});

	it("adds the version, method and tool name headers to modern messages only", async () => {
		const app = await fakeApp(() => ({}));
		const { child } = run("connect.mjs", [], app.url);
		try {
			const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_classes", arguments: {}, _meta: meta } })}\n`);
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "server/discover", params: { _meta: meta } })}\n`);
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_classes", arguments: {} } })}\n`);
			await until(() => app.seen.length === 3);
			const headers = (id: number) => {
				const h = app.seen.find((s) => s.body.id === id)!.headers;
				return { version: h["mcp-protocol-version"], method: h["mcp-method"], name: h["mcp-name"] };
			};
			assert.deepEqual(headers(1), { version: "2026-07-28", method: "tools/call", name: "list_classes" });
			assert.deepEqual(headers(2), { version: "2026-07-28", method: "server/discover", name: undefined });
			assert.deepEqual(headers(3), { version: undefined, method: undefined, name: undefined });
		} finally {
			child.kill();
			app.close();
		}
	});

	it("passes an MCP error's message on, not [object Object]", async () => {
		const app = await fakeApp(() => new Refusal({ code: -32020, message: "Mcp-Method header is absent" }));
		const { child } = run("connect.mjs", [], app.url);
		let stdout = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		try {
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
			await until(() => stdout.includes("\n"));
			assert.equal(JSON.parse(stdout).error.message, "godspeed refused the request (400): Mcp-Method header is absent");
		} finally {
			child.kill();
			app.close();
		}
	});
});

describe("the background waiter", () => {
	it("speaks the 2026-07-28 MCP version, as Claude Code, with its session id", async () => {
		const item = { status: "work", workId: "work_3_1", messages: [] };
		const app = await fakeApp(() => ({ content: [{ type: "text", text: JSON.stringify(item) }] }));
		try {
			assert.equal((await run("wait-for-work.mjs", [], app.url).exited).code, 0);
			const [{ body, headers }] = app.seen as [Seen];
			const meta = (body.params as { _meta: Record<string, unknown> })._meta;
			assert.equal(meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
			assert.deepEqual(meta["io.modelcontextprotocol/clientCapabilities"], {});
			assert.equal((meta["io.modelcontextprotocol/clientInfo"] as { name: string }).name, "claude-code");
			assert.equal(meta["godspeed/agent"], "session-1");
			assert.deepEqual([headers["mcp-protocol-version"], headers["mcp-method"], headers["mcp-name"]], ["2026-07-28", "tools/call", "wait_for_work"]);
		} finally {
			app.close();
		}
	});

	it("falls back to the older shape when the app refuses the newer one", async () => {
		const item = { status: "work", workId: "work_4_1", messages: [] };
		const app = await fakeApp((body) => {
			const meta = (body.params as { _meta: Record<string, unknown> })._meta;
			return meta["io.modelcontextprotocol/protocolVersion"]
				? new Refusal({ code: -32000, message: "Bad Request: Unsupported protocol version: 2026-07-28" })
				: { content: [{ type: "text", text: JSON.stringify(item) }] };
		});
		try {
			const { code, stdout } = await run("wait-for-work.mjs", [], app.url).exited;
			assert.equal(code, 0);
			assert.deepEqual(JSON.parse(stdout), item);
			assert.equal(app.seen.length, 2);
			assert.deepEqual((app.seen[1]!.body.params as { _meta: unknown })._meta, { "godspeed/agent": "session-1" });
			assert.equal(app.seen[1]!.headers["mcp-protocol-version"], undefined);
		} finally {
			app.close();
		}
	});

	it("waits for any work when the lesson it stayed on was deleted", async () => {
		const item = { status: "work", workId: "work_1_1", messages: [] };
		const app = await fakeApp((body) => {
			const args = (body.params as { arguments: { lesson_id?: string } }).arguments;
			return args.lesson_id
				? { content: [{ type: "text", text: `No lesson "${args.lesson_id}". Use list_lessons.` }], isError: true }
				: { content: [{ type: "text", text: JSON.stringify(item) }] };
		});
		try {
			const { code, stdout } = await run("wait-for-work.mjs", ["--lesson", "chat_gone"], app.url).exited;
			assert.equal(code, 0);
			assert.deepEqual(JSON.parse(stdout), item);
			assert.equal(app.seen.length, 2);
		} finally {
			app.close();
		}
	});

	it("prints the item's JSON, then its plain-text blocks", async () => {
		const item = { status: "work", workId: "work_2_1", messages: [{ role: "user", text: "[text 1]" }] };
		const instructions = 'Instructions (your system prompt for this conversation; follow them exactly):\n\nUse "\\frac".';
		const long = "[text 1]\nline one\nline two";
		const app = await fakeApp(() => ({ content: [{ type: "text", text: JSON.stringify(item) }, { type: "text", text: instructions }, { type: "text", text: long }] }));
		try {
			const { code, stdout } = await run("wait-for-work.mjs", [], app.url).exited;
			assert.equal(code, 0);
			const [first, ...rest] = stdout.split("\n\n");
			assert.deepEqual(JSON.parse(first!), item);
			assert.equal(rest.join("\n\n"), `${instructions}\n\n${long}\n`);
		} finally {
			app.close();
		}
	});
});
