/** The outside agent as the model: a lesson turn parks its model request in
 *  the bridge, the agent (here: the test) takes it and answers, and the app
 *  runs everything else as usual. Plus the /api/mcp door: access control
 *  and the tool surface. Closed network, scratch data dir. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-agent-bridge-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	LH_AUTH_FILE: path.join(scratch, "auth.json"),
	HOME: path.join(scratch, "home"),
};
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
globalThis.fetch = async () => { throw new Error("CLOSED: unexpected network request"); };
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const { handleChatInput } = await import("../src/server/chat-handler.ts");
const { isTurnRunning } = await import("../src/server/turn-liveness.ts");
const { abortTurn } = await import("../src/server/turn-runs.ts");
const { chatStore } = await import("../src/store/chats.ts");
const bridge = await import("../src/agent/agent-bridge.ts");
const mcp = await import("../src/server/mcp.ts");
const { subscribe } = await import("../src/core/events.ts");

function waitFor(cond: () => boolean, timeoutMs = 8000, what = "condition"): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (cond()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${what}`));
			setTimeout(tick, 20);
		};
		tick();
	});
}

function agentChat(title: string) {
	const chat = chatStore.createChat(title);
	chatStore.saveSettings(chat.id, { model: { provider: bridge.AGENT_PROVIDER, id: bridge.AGENT_MODEL_ID } });
	return chat;
}

function textOf(message: unknown): string {
	const content = (message as { content?: unknown }).content;
	return Array.isArray(content) ? content.filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("") : String(content);
}

describe("outside agent as the model", () => {
	mcp.ensureMcpAccess();

	it("a lesson turn waits for the agent, and the agent's reply is saved", async () => {
		const chat = agentChat("Photosynthesis");
		const ack = await handleChatInput(chat.id, { type: "text", text: "Teach me photosynthesis" });
		assert.equal(ack.status, 200, await ack.clone().text());

		const work = await bridge.waitForWork(5000);
		assert.ok(work, "the turn parked a request");
		assert.equal(work.conversation, chat.id);
		assert.equal(work.continued, false);
		assert.ok((work.instructions ?? "").length > 500, "the app's teaching instructions ride along");
		assert.ok(work.tools?.some((t) => t.name === "probe_done"), "a new lesson starts in the probing phase");
		const lastUser = work.messages.filter((m) => m.role === "user").at(-1);
		assert.equal(lastUser && "text" in lastUser ? lastUser.text : "", "Teach me photosynthesis");
		assert.ok(isTurnRunning(chat.id), "the turn stays open while the agent thinks");

		const answered = bridge.respondToWork(work.workId, { text: "What do you already know about how plants get energy?" });
		assert.ok(answered.ok);
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");

		const last = chatStore.getChat(chat.id)!.messages.at(-1)!;
		assert.equal((last as { role: string }).role, "assistant");
		assert.equal(textOf(last), "What do you already know about how plants get energy?");
	});

	it("tool calls run in the app and their results come back as continued work", async () => {
		const chat = agentChat("Tools");
		await handleChatInput(chat.id, { type: "text", text: "hello" });
		const first = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(first);
		assert.ok(bridge.respondToWork(first.workId, { toolCalls: [{ name: "ls", arguments: {} }] }).ok);

		const second = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(second, "the tool result asks the agent again");
		assert.equal(second.continued, true, "only the new messages are sent");
		assert.equal(second.instructions, undefined);
		assert.deepEqual(second.messages.map((m) => m.role), ["toolResult"]);

		assert.ok(bridge.respondToWork(second.workId, { text: "Done looking." }).ok);
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
	});

	it("refuses tool names the work item does not offer", async () => {
		const chat = agentChat("Unknown tool");
		await handleChatInput(chat.id, { type: "text", text: "hi" });
		const work = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(work);
		const refused = bridge.respondToWork(work.workId, { toolCalls: [{ name: "launch_rockets", arguments: {} }] });
		assert.equal(refused.ok, false);
		assert.ok(bridge.respondToWork(work.workId, { text: "ok" }).ok, "the item is still open after a refusal");
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
	});

	it("stopping the turn withdraws the parked request", async () => {
		const chat = agentChat("Abort");
		await handleChatInput(chat.id, { type: "text", text: "hi" });
		await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "request parked");
		abortTurn(chat.id);
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
		assert.equal(bridge.pendingWorkCount(), 0);
		assert.equal(await bridge.waitForWork(50), null);
	});
});

describe("the /api/mcp door", () => {
	function rpc(body: unknown, headers: Record<string, string> = {}) {
		return new Request("http://127.0.0.1:3000/api/mcp", {
			method: "POST",
			headers: {
				host: "127.0.0.1:3000",
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...headers,
			},
			body: JSON.stringify(body),
		});
	}
	const listTools = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

	it("access is always on: a missing token file is made again, and a wrong token is still refused", async () => {
		fs.rmSync(path.join(scratch, "data", "mcp-token"), { force: true });
		const res = await mcp.handleMcpRequest(rpc(listTools, { authorization: "Bearer x" }));
		assert.equal(res.status, 401);
		assert.ok(fs.existsSync(path.join(scratch, "data", "mcp-token")), "the token file is back");
	});

	it("needs the right token, and refuses browsers and other hosts", async () => {
		const token = mcp.ensureMcpAccess();
		assert.equal((await mcp.handleMcpRequest(rpc(listTools))).status, 401);
		assert.equal((await mcp.handleMcpRequest(rpc(listTools, { authorization: "Bearer wrong" }))).status, 401);
		assert.equal((await mcp.handleMcpRequest(rpc(listTools, { authorization: `Bearer ${token}`, origin: "https://evil.example" }))).status, 403);
		assert.equal((await mcp.handleMcpRequest(rpc(listTools, { authorization: `Bearer ${token}`, host: "evil.example" }))).status, 403);
	});

	it("lists its tools and answers calls", async () => {
		const token = mcp.ensureMcpAccess();
		const auth = { authorization: `Bearer ${token}` };
		const init = await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, auth));
		assert.equal(init.status, 200, await init.clone().text());

		const tools = await (await mcp.handleMcpRequest(rpc(listTools, auth))).json();
		const names = tools.result.tools.map((t: { name: string }) => t.name).sort();
		assert.deepEqual(names, [
			"add_class_exam",
			"add_class_file",
			"create_class",
			"import_notes",
			"link_class_folder",
			"list_classes",
			"list_lessons",
			"read_class",
			"read_lesson",
			"remove_class_exam",
			"respond",
			"search_graph",
			"set_class_file_kind",
			"start_lesson",
			"unlink_class_folder",
			"update_class",
			"update_class_exam",
			"wait_for_work",
		]);
		assert.ok(!names.some((n: string) => n.includes("delete")), "deleting a class is app-only (owner ruling)");

		const call = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_lessons", arguments: {} } }, auth))).json();
		const lessons = JSON.parse(call.result.content[0].text).lessons;
		assert.ok(lessons.some((l: { title: string }) => l.title === "Photosynthesis"));

		const idle = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wait_for_work", arguments: { timeout_seconds: 1 } } }, auth))).json();
		assert.equal(JSON.parse(idle.result.content[0].text).status, "idle");
	});

	it("sets up a class and reads it back (classes wave, 2026-10-26)", async () => {
		const token = mcp.ensureMcpAccess();
		const auth = { authorization: `Bearer ${token}` };
		const call = async (name: string, args: Record<string, unknown>) => {
			const res = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, auth))).json();
			return { error: res.result.isError === true, body: (() => { try { return JSON.parse(res.result.content[0].text); } catch { return res.result.content[0].text; } })() };
		};
		const created = await call("create_class", { name: "PHYS 2B", description: "Griffiths, chapters 1-4" });
		const id = created.body.class.id as string;
		assert.match(id, /^cls_/);
		const listed = await call("list_classes", {});
		assert.ok(listed.body.classes.some((c: { id: string }) => c.id === id));
		const updated = await call("update_class", { class_id: id, description: "Griffiths 1-5" });
		assert.equal(updated.body.class.description, "Griffiths 1-5");
		const read = await call("read_class", { class_id: id });
		assert.deepEqual(read.body.files, []);
		const bad = await call("search_graph", { class_id: "cls_missing" });
		assert.equal(bad.error, true);
		const missingFile = await call("add_class_file", { class_id: id, path: "/definitely/not/here.md", kind: "info" });
		assert.equal(missingFile.error, true);
		// A REAL class id is accepted (a class id is a string too — it once
		// read as a refusal and every class-scoped tool failed).
		const searched = await call("search_graph", { class_id: id, query: "anything" });
		assert.equal(searched.error, false, JSON.stringify(searched.body));

		// Exams (redesign plan, 2026-10-27): add from the syllabus, fix, remove.
		const exam = await call("add_class_exam", { class_id: id, name: "Midterm 1", date: "2026-11-05" });
		assert.equal(exam.error, false, JSON.stringify(exam.body));
		const examId = exam.body.exam.id as string;
		assert.equal((await call("add_class_exam", { class_id: id, name: "Final", date: "next week" })).error, true);
		assert.equal((await call("add_class_exam", { class_id: id, name: "Final", date: "2026-12-10", file_ids: ["f_nope"] })).error, true);
		assert.equal((await call("add_class_exam", { class_id: "cls_missing", name: "Final", date: "2026-12-10" })).error, true);
		const moved = await call("update_class_exam", { class_id: id, exam_id: examId, date: "2026-11-06" });
		assert.equal(moved.body.exam.date, "2026-11-06");
		const withExam = await call("read_class", { class_id: id });
		assert.deepEqual(withExam.body.exams, [{ id: examId, name: "Midterm 1", date: "2026-11-06", files: [] }]);
		assert.equal((await call("remove_class_exam", { class_id: id, exam_id: examId })).error, false);
		assert.equal((await call("remove_class_exam", { class_id: id, exam_id: examId })).error, true);
		assert.deepEqual((await call("read_class", { class_id: id })).body.exams, []);
	});
});

describe("agent check-ins and images (phase 2, owner 2026-10-27)", () => {
	function rpc(body: unknown, token: string) {
		return new Request("http://127.0.0.1:3000/api/mcp", {
			method: "POST",
			headers: { host: "127.0.0.1:3000", "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		});
	}

	it("names known clients readably and keeps unknown ones", () => {
		assert.equal(bridge.displayAgentName({ name: "claude-code" }), "Claude Code");
		assert.equal(bridge.displayAgentName({ name: "codex-mcp-client" }), "Codex");
		assert.equal(bridge.displayAgentName({ name: "zed", title: "Zed" }), "Zed");
		assert.equal(bridge.displayAgentName({ name: "my-agent" }), "my-agent");
		assert.equal(bridge.displayAgentName(undefined), undefined);
	});

	it("the initialize handshake names the agent; the status shows it and an event goes out", async () => {
		const token = mcp.ensureMcpAccess();
		let events = 0;
		const off = subscribe((e) => { if (e.type === "agent-changed") events++; });
		try {
			const init = await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2" } } }, token));
			assert.equal(init.status, 200);
		} finally {
			off();
		}
		const status = mcp.mcpAccessStatus();
		assert.equal(status.agentConnected, true);
		assert.equal(status.agentName, "Claude Code");
		assert.ok(events >= 1, "agent-changed fired for the new name");
	});

	it("a work item's images go to the agent as real MCP images, marked [image N] in the text", async () => {
		const token = mcp.ensureMcpAccess();
		let events = 0;
		const off = subscribe((e) => { if (e.type === "agent-changed") events++; });
		const stream = bridge.agentStream(bridge.agentModel(), {
			messages: [{ role: "user", content: [{ type: "text", text: "What is in this picture?" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }], timestamp: 1 }],
		} as never, { sessionId: "image-conversation" });
		try {
			await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "request parked");
			assert.ok(events >= 1, "parking work fires agent-changed");
			const res = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait_for_work", arguments: { timeout_seconds: 1 } } }, token))).json();
			const [text, image] = res.result.content;
			const item = JSON.parse(text.text);
			assert.equal(item.imageCount, 1);
			assert.match(item.messages[0].text, /What is in this picture\?\n\[image 1\]/);
			assert.deepEqual(image, { type: "image", data: "aGVsbG8=", mimeType: "image/png" });
			assert.equal(bridge.respondToWork(item.workId, { text: "A greeting." }).ok, true);
			const done = await stream.result();
			assert.ok(done.content.some((c) => c.type === "text"));
			assert.equal(bridge.pendingWorkCount(), 0);
		} finally {
			off();
		}
	});
});
