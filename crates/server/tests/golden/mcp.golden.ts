// The real /api/mcp handler (src/backend/server/mcp.ts with the MCP SDK and zod) answering
// synthetic requests that stop before any tool runs: the refusals, the SDK's era ladder in both
// protocol versions, the older transport's checks, protocol-level tools/call errors and zod's
// argument texts. tests/mcp_golden.rs sends the same requests to the Rust endpoint. The data
// folder is a fresh temporary one holding only the token.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOKEN = "ab".repeat(32);
const MODERN = "2026-07-28";

type Case = { method?: string; headers?: Record<string, string>; body?: unknown; raw?: string };

let handler: ((req: Request) => Promise<Response>) | undefined;

async function handle(): Promise<(req: Request) => Promise<Response>> {
	if (handler) return handler;
	const data = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-golden-"));
	fs.writeFileSync(path.join(data, "mcp-token"), TOKEN, { mode: 0o600 });
	process.env.LH_DATA_DIR = data;
	handler = (await import("../../../../src/backend/server/mcp.ts")).handleMcpRequest;
	return handler;
}

const meta = (version: unknown = MODERN, extra: Record<string, unknown> = {}) => ({
	"io.modelcontextprotocol/protocolVersion": version,
	"io.modelcontextprotocol/clientCapabilities": {},
	...extra,
});
const modernHeaders = (method: string, name?: string) => ({ "mcp-protocol-version": MODERN, "mcp-method": method, ...(name ? { "mcp-name": name } : {}) });
const call = (name: string, args: unknown) => ({
	headers: modernHeaders("tools/call", name),
	body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: meta() } },
});
const legacy = (body: unknown, headers: Record<string, string> = {}) => ({ headers: { "mcp-protocol-version": "2025-06-18", ...headers }, body });

async function send(c: Case) {
	const headers: Record<string, string> = {
		host: "127.0.0.1:1",
		authorization: `Bearer ${TOKEN}`,
		accept: "application/json, text/event-stream",
		"content-type": "application/json",
		...c.headers,
	};
	for (const [k, v] of Object.entries(headers)) if (v === "") delete headers[k];
	const method = c.method ?? "POST";
	const body = method === "POST" ? (c.raw ?? JSON.stringify(c.body)) : undefined;
	const res = await (await handle())(new Request("http://127.0.0.1:1/api/mcp", { method, headers, body }));
	const text = res.headers.get("content-type")?.startsWith("text/event-stream") ? "" : await res.text();
	return { request: { method, headers, body }, status: res.status, type: res.headers.get("content-type"), allow: res.headers.get("allow"), body: text };
}

const cases: Record<string, Case> = {
	"origin refused": { headers: { origin: "http://x.example" }, body: {} },
	"foreign host": { headers: { host: "x.example:80" }, body: {} },
	"no token": { headers: { authorization: "" }, body: {} },
	"lower-case bearer": legacy({ jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `bearer  ${TOKEN}` }),

	"legacy ping": legacy({ jsonrpc: "2.0", id: 1, method: "ping" }),
	"legacy unknown method": legacy({ jsonrpc: "2.0", id: "x", method: "nope" }),
	"legacy notification": legacy({ jsonrpc: "2.0", method: "notifications/initialized" }),
	"legacy posted response": legacy({ jsonrpc: "2.0", id: 4, result: {} }),
	"legacy batch of two": legacy([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "nope" }]),
	"legacy batch of one": legacy([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
	"legacy batch with initialize": legacy([{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } }, { jsonrpc: "2.0", id: 2, method: "ping" }]),
	"legacy batch over 100": legacy(Array.from({ length: 101 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }))),
	"legacy unknown version header": legacy({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "1999-01-01" }),
	"legacy wrong content type": legacy({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "text/plain" }),
	"legacy json content type with charset": legacy({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "application/json; charset=utf-8" }),
	"legacy accept without event-stream": legacy({ jsonrpc: "2.0", id: 1, method: "ping" }, { accept: "application/json" }),
	"empty body": { raw: "" },
	"body not json": { raw: "{nope" },
	"not a JSON-RPC message": { body: { hello: 1 } },
	"invalid JSON-RPC message, legacy": { body: { jsonrpc: "1.0", id: 1, method: "ping" } },
	"GET without event-stream": { method: "GET", headers: { accept: "application/json" } },
	"GET with an unknown version": { method: "GET", headers: { "mcp-protocol-version": "1999-01-01" } },
	"GET": { method: "GET" },
	"DELETE": { method: "DELETE" },

	"empty batch": { body: [] },
	"batch with a modern element": { body: [{ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta() } }] },
	"batch with an invalid element": { body: [{ jsonrpc: "2.0", id: 1, method: "ping" }, { nope: true }] },
	"modern ping": { headers: modernHeaders("ping"), body: { jsonrpc: "2.0", id: 9, method: "ping", params: { _meta: meta() } } },
	"modern initialize": { headers: modernHeaders("initialize"), body: { jsonrpc: "2.0", id: 9, method: "initialize", params: { _meta: meta() } } },
	"modern unknown version": { headers: { ...modernHeaders("tools/list"), "mcp-protocol-version": "2099-01-01" }, body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta("2099-01-01") } } },
	"modern pre-2026 claim": { headers: { "mcp-method": "tools/list" }, body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta("2025-06-18") } } },
	"envelope missing capabilities": { headers: modernHeaders("tools/list"), body: { jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } } } },
	"envelope version not a string": { headers: modernHeaders("tools/list"), body: { jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: meta(7) } } },
	"envelope capabilities not an object": { headers: modernHeaders("tools/list"), body: { jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { ...meta(), "io.modelcontextprotocol/clientCapabilities": [] } } } },
	"version header mismatch": { headers: { ...modernHeaders("tools/list"), "mcp-protocol-version": "2025-06-18" }, body: { jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: meta() } } },
	"method header mismatch": { headers: modernHeaders("ping"), body: { jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: meta() } } },
	"modern header without a claim": { headers: modernHeaders("tools/list"), body: { jsonrpc: "2.0", id: 5, method: "tools/list" } },
	"modern header with a partial envelope": { headers: modernHeaders("tools/list"), body: { jsonrpc: "2.0", id: 5, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {} } } } },
	"initialize with a modern header": { headers: modernHeaders("initialize"), body: { jsonrpc: "2.0", id: 6, method: "initialize", params: {} } },
	"modern without the version header": { headers: { "mcp-method": "tools/list" }, body: { jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: meta() } } },
	"modern without the method header": { headers: { "mcp-protocol-version": MODERN }, body: { jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: meta() } } },
	"modern call without the name header": { headers: modernHeaders("tools/call"), body: { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "forget", arguments: {}, _meta: meta() } } },
	"modern call with another name header": { headers: modernHeaders("tools/call", "remember"), body: { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "forget", arguments: {}, _meta: meta() } } },
	"modern wrong content type": { headers: { ...modernHeaders("tools/list"), "content-type": "text/plain" }, body: { jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: meta() } } },
	"modern notification": { headers: modernHeaders("notifications/initialized"), body: { jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: meta() } } },
	"modern notification, version not a string": { body: { jsonrpc: "2.0", method: "notifications/initialized", params: { _meta: meta(5) } } },
	"notification with a modern header only": { headers: modernHeaders("notifications/initialized"), body: { jsonrpc: "2.0", method: "notifications/initialized" } },

	"call without a name": { headers: modernHeaders("tools/call"), body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: {}, _meta: meta() } } },
	"call with list arguments": call("forget", []),
	"call with a number name and null arguments": { headers: modernHeaders("tools/call"), body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 5, arguments: null, _meta: meta() } } },
	"remember text as an empty list": call("remember", { text: [] }),
	"remember text as an object with a length": call("remember", { text: { length: 500 } }),
	"remember text as an object with a text length": call("remember", { text: { length: "x" } }),
	"set_class_file_kind ids as an empty string": call("set_class_file_kind", { class_id: "c", file_ids: "", kind: "info" }),
	"add_class_deadline list of bad items": call("add_class_deadline", { class_id: "c", deadlines: [1, null] }),
	"call of an unknown tool": call("nope", {}),
	"legacy call of an unknown tool": legacy({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope", arguments: {} } }),

	"create_class with nothing": call("create_class", {}),
	"create_class with a bad signature": call("create_class", { name: "x", icon: "cpu", signature: { kind: "poem", value: "" } }),
	"create_class with a signature string": call("create_class", { name: "x", icon: "cpu", signature: "x" }),
	"create_class with a null signature": call("create_class", { name: "x", icon: "cpu", signature: null }),
	"update_class wrong types": call("update_class", { class_id: 1, name: "", archived: "yes", icon: 3 }),
	"add_class_deadline items": call("add_class_deadline", { class_id: "c", deadlines: [{ kind: "quiz" }, { kind: "x", name: "", date: 1, file_ids: [1, "a"] }] }),
	"add_class_deadline not a list": call("add_class_deadline", { class_id: "c", deadlines: { kind: "quiz" } }),
	"update_class_deadline nulls": call("update_class_deadline", { class_id: "c", deadline_id: "d", time: 5, source: false, assignment_file_id: [], done: null }),
	"set_class_file_kind with a bad id": call("set_class_file_kind", { class_id: "c", file_ids: [3], kind: "info" }),
	"respond calls": call("respond", { work_id: "w", tool_calls: [{ name: 1 }, "x", { name: "a", arguments: null }], wait_seconds: 56 }),
	"respond tool calls not a list": call("respond", { work_id: "w", tool_calls: {} }),
	"list_lessons huge limit": call("list_lessons", { limit: 1e300 }),
	"list_lessons negative fraction": call("list_lessons", { limit: -0.5 }),
	"read_lesson page null": call("read_lesson", { lesson_id: "x", page: null }),
	"read_work booleans": call("read_work", { work_id: true, page: true, full: 1 }),
	"remember long multi-byte": call("remember", { text: "😀".repeat(101) }),
	"save_rule bad area and class": call("save_rule", { rule: "", class_id: 5, area: "x" }),
	"search_class_files limit": call("search_class_files", { class_id: "c", query: "q", limit: 0.5 }),
	"read_passage numbers": call("read_passage", { class_id: "c", passage_id: 1, file_id: 2, range: 3 }),
	"start_lesson object topic": call("start_lesson", { topic: {}, class_id: null }),
	"link_class_folder nothing": call("link_class_folder", {}),
	"unlink_class_folder number": call("unlink_class_folder", { class_id: 9 }),
	"import_notes empty": call("import_notes", { name: 1, text: "" }),
	"wait_for_work everything wrong": call("wait_for_work", { timeout_seconds: "1", lesson_id: 2, full_context: "no" }),
};

export default Object.fromEntries(Object.entries(cases).map(([name, c]) => [name, () => send(c)]));
