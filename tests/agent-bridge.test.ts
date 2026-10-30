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
const { ensureMcpToken } = await import("../src/store/mcp-token.ts");
const { subscribe } = await import("../src/core/events.ts");
const { WORK_PAGE_CHARS } = await import("../src/core/work-pages.ts");

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
	ensureMcpToken();

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

		const answered = bridge.respondToWork(work.workId, { text: "What do you already know about how plants get energy?" }, 0);
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
		assert.ok(bridge.respondToWork(first.workId, { toolCalls: [{ name: "ls", arguments: {} }] }, 0).ok);

		const second = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(second, "the tool result asks the agent again");
		assert.equal(second.continued, true, "only the new messages are sent");
		assert.equal(second.instructions, undefined);
		assert.deepEqual(second.messages.map((m) => m.role), ["toolResult"]);

		assert.ok(bridge.respondToWork(second.workId, { text: "Done looking." }, 0).ok);
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
	});

	it("refuses tool names the work item does not offer", async () => {
		const chat = agentChat("Unknown tool");
		await handleChatInput(chat.id, { type: "text", text: "hi" });
		const work = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(work);
		const refused = bridge.respondToWork(work.workId, { toolCalls: [{ name: "launch_rockets", arguments: {} }] }, 0);
		assert.equal(refused.ok, false);
		assert.ok(bridge.respondToWork(work.workId, { text: "ok" }, 0).ok, "the item is still open after a refusal");
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
	});

	it("an agent staying on one lesson also takes background jobs, but not other lessons", async () => {
		const lesson = agentChat("Stay here");
		const other = agentChat("Other lesson");
		await handleChatInput(other.id, { type: "text", text: "hi" });
		await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "other lesson parked");

		// A background job (extraction, topic grouping...) uses a non-lesson session id.
		const stream = bridge.agentStream(
			bridge.agentModel(),
			{ messages: [{ role: "user", content: "Read this file", timestamp: Date.now() }] } as never,
			{ sessionId: "job_background_test" },
		);
		const finished = (async () => { for await (const _ of stream) { /* drain */ } })();
		await waitFor(() => bridge.pendingWorkCount() === 2, 5000, "background job parked");

		const work = await bridge.waitForWork(1000, { conversation: lesson.id, andBackground: true });
		assert.ok(work, "the background job comes to the lesson's agent");
		assert.equal(work.conversation, "job_background_test");
		assert.equal(await bridge.waitForWork(50, { conversation: lesson.id, andBackground: true }), null, "another lesson's turn does not");
		assert.equal(await bridge.waitForWork(50, { conversation: lesson.id }), null, "without andBackground, only the lesson's own work");

		assert.ok(bridge.respondToWork(work.workId, { text: "Done." }, 0).ok);
		await finished;
		abortTurn(other.id);
		await waitFor(() => !isTurnRunning(other.id), 8000, "other lesson settle");
		assert.equal(bridge.pendingWorkCount(), 0);
	});

	it("a forgotten background conversation is delivered in full again", async () => {
		const ask = async (conversation: string, messages: unknown[]) => {
			const stream = bridge.agentStream(bridge.agentModel(), { messages } as never, { sessionId: conversation });
			const work = await bridge.waitForWork(5000);
			assert.ok(work);
			assert.ok(bridge.respondToWork(work.workId, { text: "Done." }, 0).ok);
			return { work, reply: await stream.result() };
		};
		const first = { role: "user", content: "Read this file", timestamp: Date.now() };
		const next = { role: "user", content: "And this one", timestamp: Date.now() };
		for (const forget of [false, true]) {
			const conversation = `job_forget_${forget}`;
			const { reply } = await ask(conversation, [first]);
			if (forget) bridge.forgetConversation(conversation);
			const { work } = await ask(conversation, [first, reply, next]);
			assert.equal(work.continued, !forget);
		}
		assert.equal(bridge.pendingWorkCount(), 0);
	});

	it("each agent gets only what it hasn't seen, and that survives a restart", async () => {
		const chat = agentChat("Two agents");
		await handleChatInput(chat.id, { type: "text", text: "hello" });
		const ls = { toolCalls: [{ name: "ls", arguments: {} }] };
		const take = async (agent: string) => {
			const work = await bridge.waitForWork(5000, { conversation: chat.id, agent });
			assert.ok(work);
			return work;
		};

		const first = await take("agent-a");
		assert.equal(first.continued, false);
		assert.ok(bridge.respondToWork(first.workId, ls, 0).ok);
		const second = await take("agent-b");
		assert.equal(second.continued, false, "agent b never saw this lesson, so it gets all of it");
		assert.ok(bridge.respondToWork(second.workId, ls, 0).ok);
		const third = await take("agent-a");
		assert.equal(third.continued, true);
		assert.deepEqual(third.messages.map((m) => m.role), ["toolResult", "assistant", "toolResult"], "what agent b added since");
		assert.ok(bridge.respondToWork(third.workId, ls, 0).ok);

		await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "follow-up parked");
		bridge.forgetConversation(chat.id); // the app's memory is gone, as after a restart
		const fourth = await take("agent-a");
		assert.equal(fourth.continued, true, "agent a's mark comes back from data/agent-seen.json");
		assert.deepEqual(fourth.messages.map((m) => m.role), ["toolResult"]);
		const saved = JSON.parse(fs.readFileSync(path.join(scratch, "data", "agent-seen.json"), "utf8"));
		assert.ok(saved.agents["agent-a"].conversations[chat.id]);
		assert.ok(saved.agents["agent-b"].conversations[chat.id]);

		assert.ok(bridge.respondToWork(fourth.workId, { text: "Done." }, 0).ok);
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
	});

	it("an answered lesson's next item is held for the answering agent until release or expiry", async () => {
		const chat = agentChat("Held");
		await handleChatInput(chat.id, { type: "text", text: "hi" });
		const ls = { toolCalls: [{ name: "ls", arguments: {} }] };
		const first = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(first);

		assert.ok(bridge.respondToWork(first.workId, ls, 60_000).ok);
		await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "follow-up parked");
		assert.equal(await bridge.waitForWork(100), null, "another agent can't take a held lesson's item");
		const second = await bridge.waitForWork(1000, { conversation: chat.id });
		assert.ok(second, "the answering agent's own wait takes it");

		assert.ok(bridge.respondToWork(second.workId, ls, 60_000).ok);
		await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "follow-up parked");
		bridge.releaseConversation(chat.id);
		const third = await bridge.waitForWork(1000);
		assert.ok(third);
		assert.equal(third.conversation, chat.id, "after release anyone can take it");

		assert.ok(bridge.respondToWork(third.workId, ls, 100).ok);
		await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "follow-up parked");
		const fourth = await bridge.waitForWork(1000);
		assert.ok(fourth);
		assert.equal(fourth.conversation, chat.id, "after the hold expires anyone can take it");

		assert.ok(bridge.respondToWork(fourth.workId, { text: "Done." }, 0).ok);
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
		const token = ensureMcpToken();
		assert.equal((await mcp.handleMcpRequest(rpc(listTools))).status, 401);
		assert.equal((await mcp.handleMcpRequest(rpc(listTools, { authorization: "Bearer wrong" }))).status, 401);
		assert.equal((await mcp.handleMcpRequest(rpc(listTools, { authorization: `Bearer ${token}`, origin: "https://evil.example" }))).status, 403);
		assert.equal((await mcp.handleMcpRequest(rpc(listTools, { authorization: `Bearer ${token}`, host: "evil.example" }))).status, 403);
	});

	it("lists its tools and answers calls", async () => {
		const token = ensureMcpToken();
		const auth = { authorization: `Bearer ${token}` };
		const init = await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, auth));
		assert.equal(init.status, 200, await init.clone().text());

		const tools = await (await mcp.handleMcpRequest(rpc(listTools, auth))).json();
		const names = tools.result.tools.map((t: { name: string }) => t.name).sort();
		assert.deepEqual(names, [
			"add_class_deadline",
			"add_class_file",
			"create_class",
			"forget",
			"import_notes",
			"link_class_folder",
			"list_classes",
			"list_lessons",
			"read_class",
			"read_lesson",
			"read_passage",
			"read_work",
			"remember",
			"remove_class_deadline",
			"respond",
			"search_class_files",
			"search_graph",
			"set_class_file_kind",
			"start_lesson",
			"unlink_class_folder",
			"update_class",
			"update_class_deadline",
			"wait_for_work",
		]);
		assert.ok(!names.some((n: string) => n.includes("delete")), "deleting a class is app-only (owner ruling)");

		const call = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_lessons", arguments: {} } }, auth))).json();
		const lessons = JSON.parse(call.result.content[0].text).lessons;
		assert.ok(lessons.some((l: { title: string }) => l.title === "Photosynthesis"));

		const idle = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "wait_for_work", arguments: { timeout_seconds: 1 } } }, auth))).json();
		assert.equal(JSON.parse(idle.result.content[0].text).status, "idle");

		const unknown = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "wait_for_work", arguments: { timeout_seconds: 1, lesson_id: "nope" } } }, auth))).json();
		assert.equal(unknown.result.isError, true);
		assert.match(unknown.result.content[0].text, /No lesson "nope"/);
	});

	it("a long work item comes in pages, and respond waits until every page was read", async () => {
		const auth = { authorization: `Bearer ${ensureMcpToken()}` };
		const call = async (id: number, name: string, args: Record<string, unknown>) =>
			(await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, auth))).json()).result;
		const long = Array.from({ length: 3000 }, (_, i) => `line ${i} of a very long pasted transcript`).join("\n");
		const stream = bridge.agentStream(bridge.agentModel(), { messages: [{ role: "user", content: long, timestamp: 1 }] } as never, { sessionId: "long-conversation" });
		await waitFor(() => bridge.pendingWorkCount() === 1, 5000, "request parked");

		const first = await call(1, "wait_for_work", { timeout_seconds: 1 });
		const header = JSON.parse(first.content[0].text);
		assert.equal(header.page, 1);
		assert.ok(header.pages >= 3, `pages: ${header.pages}`);
		const pages = [first.content[1].text];
		for (const page of pages) assert.ok(page.length <= WORK_PAGE_CHARS);

		const early = await call(2, "respond", { work_id: header.workId, text: "Done.", wait_seconds: 0 });
		assert.equal(early.isError, true);
		assert.match(early.content[0].text, /page\(s\) 2, 3/);

		for (let page = 2; page <= header.pages; page++) {
			const read = await call(10 + page, "read_work", { work_id: header.workId, page });
			assert.equal(JSON.parse(read.content[0].text).page, page);
			pages.push(read.content[1].text);
		}
		const past = await call(3, "read_work", { work_id: header.workId, page: header.pages + 1 });
		assert.equal(past.isError, true);
		const item = JSON.parse(pages.join(""));
		assert.equal(item.workId, header.workId);
		assert.equal(item.messages[0].text, long, "the pages join back into the whole item");

		const answered = await call(4, "respond", { work_id: header.workId, text: "Done.", wait_seconds: 0 });
		assert.equal(JSON.parse(answered.content[0].text).status, "turn_complete");
		await stream.result();
	});

	it("the plugin's forget call makes that agent's next item come in full", async () => {
		const token = ensureMcpToken();
		const meta = { "godspeed/agent": "agent-forgets" };
		const call = async (id: number, name: string, args: Record<string, unknown>) =>
			(await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: meta } }, { authorization: `Bearer ${token}` }))).json()).result;
		const forget = (body: unknown, auth = token) =>
			mcp.handleAgentForget(new Request("http://127.0.0.1:3000/api/mcp/forget", {
				method: "POST",
				headers: { host: "127.0.0.1:3000", "content-type": "application/json", authorization: `Bearer ${auth}` },
				body: JSON.stringify(body),
			}));
		/** A work item's JSON, reading every page. */
		const whole = async (res: { content: { text: string }[] }) => {
			const header = JSON.parse(res.content[0]!.text);
			if (!header.pages) return header;
			const pages = [res.content[1]!.text];
			for (let page = 2; page <= header.pages; page++) pages.push((await call(20 + page, "read_work", { work_id: header.workId, page })).content[1].text);
			return JSON.parse(pages.join(""));
		};

		const chat = agentChat("Forgets");
		await handleChatInput(chat.id, { type: "text", text: "hi" });
		const first = await whole(await call(1, "wait_for_work", { timeout_seconds: 5, lesson_id: chat.id }));
		assert.equal(first.continued, false);
		const second = await whole(await call(2, "respond", { work_id: first.workId, tool_calls: [{ name: "ls", arguments: {} }], wait_seconds: 5 }));
		assert.equal(second.continued, true, "respond's next item knows the agent from its wait");

		assert.equal((await forget({ agent: "agent-forgets" }, "wrong")).status, 401);
		assert.equal((await forget({})).status, 400);
		assert.equal((await forget({ agent: "agent-forgets" })).status, 200);
		assert.ok(bridge.respondToWork(second.workId, { toolCalls: [{ name: "ls", arguments: {} }] }, 0).ok, "the item it held when it forgot");
		const third = await whole(await call(3, "wait_for_work", { timeout_seconds: 5, lesson_id: chat.id }));
		assert.equal(third.continued, false, "after forgetting, the whole lesson comes again");
		assert.ok(third.instructions);

		assert.ok(bridge.respondToWork(third.workId, { text: "Done." }, 0).ok);
		await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
	});

	it("knows a Codex session by the id in its turn metadata, as an object or as JSON text", async () => {
		const auth = { authorization: `Bearer ${ensureMcpToken()}` };
		for (const turn of [{ session_id: "codex-object" }, JSON.stringify({ session_id: "codex-text" })]) {
			const chat = agentChat("Codex");
			await handleChatInput(chat.id, { type: "text", text: "hi" });
			const wait = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait_for_work", arguments: { timeout_seconds: 5, lesson_id: chat.id }, _meta: { "x-codex-turn-metadata": turn } } }, auth))).json();
			const header = JSON.parse(wait.result.content[0].text);
			for (let page = 2; page <= (header.pages ?? 1); page++) assert.ok(bridge.readWorkPage(header.workId, page).ok);
			assert.ok(bridge.respondToWork(header.workId, { text: "Hello." }, 0).ok);
			await waitFor(() => !isTurnRunning(chat.id), 8000, "turn settle");
			const saved = JSON.parse(fs.readFileSync(path.join(scratch, "data", "agent-seen.json"), "utf8"));
			const id = typeof turn === "string" ? "codex-text" : "codex-object";
			assert.ok(saved.agents[id]?.conversations[chat.id], `${id} is remembered`);
		}
	});

	it("sets up a class and reads it back (classes wave, 2026-10-26)", async () => {
		const token = ensureMcpToken();
		const auth = { authorization: `Bearer ${token}` };
		const call = async (name: string, args: Record<string, unknown>) => {
			const res = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, auth))).json();
			return { error: res.result.isError === true, body: (() => { try { return JSON.parse(res.result.content[0].text); } catch { return res.result.content[0].text; } })() };
		};
		assert.equal((await call("create_class", { name: "PHYS 2B" })).error, true, "a new class needs an icon");
		assert.equal((await call("create_class", { name: "PHYS 2B", icon: "rocket" })).error, true, "only the listed icons");
		const created = await call("create_class", { name: "PHYS 2B", description: "Griffiths, chapters 1-4", icon: "atom" });
		const id = created.body.class.id as string;
		assert.match(id, /^cls_/);
		assert.equal(created.body.class.icon, "atom");
		const listed = await call("list_classes", {});
		assert.ok(listed.body.classes.some((c: { id: string; icon: string }) => c.id === id && c.icon === "atom"));
		const updated = await call("update_class", { class_id: id, description: "Griffiths 1-5", icon: "sigma" });
		assert.equal(updated.body.class.description, "Griffiths 1-5");
		assert.equal(updated.body.class.icon, "sigma");
		// An archived class takes no new lessons.
		await call("update_class", { class_id: id, archived: true });
		const refused = await call("start_lesson", { topic: "Gauss's law", class_id: id });
		assert.equal(refused.error, true);
		assert.match(String(refused.body), /archived/);
		await call("update_class", { class_id: id, archived: false });
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

		// Deadlines (2026-10-28; exams before): add from the syllabus, fix, tick done, remove.
		const added = await call("add_class_deadline", { class_id: id, kind: "homework", name: "HW 1", date: "2026-11-05", time: "17:00" });
		assert.equal(added.error, false, JSON.stringify(added.body));
		const deadlineId = added.body.deadline.id as string;
		assert.match(deadlineId, /^ddl_/);
		assert.equal((await call("add_class_deadline", { class_id: id, kind: "exam", name: "Final", date: "next week" })).error, true);
		assert.equal((await call("add_class_deadline", { class_id: id, kind: "exam", name: "Final", date: "2026-12-10", time: "8am" })).error, true);
		assert.equal((await call("add_class_deadline", { class_id: id, kind: "essay", name: "Final", date: "2026-12-10" })).error, true);
		assert.equal((await call("add_class_deadline", { class_id: id, kind: "exam", name: "Final", date: "2026-12-10", file_ids: ["f_nope"] })).error, true);
		assert.equal((await call("add_class_deadline", { class_id: "cls_missing", kind: "exam", name: "Final", date: "2026-12-10" })).error, true);
		const moved = await call("update_class_deadline", { class_id: id, deadline_id: deadlineId, date: "2026-11-06", kind: "quiz", done: true });
		assert.equal(moved.body.deadline.date, "2026-11-06");
		assert.equal(moved.body.deadline.done, true);
		const withDeadline = await call("read_class", { class_id: id });
		assert.match(withDeadline.body.today, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "read_class carries the local date and time");
		assert.deepEqual(withDeadline.body.deadlines, [{ id: deadlineId, kind: "quiz", name: "HW 1", date: "2026-11-06", time: "17:00", done: true, files: [] }]);
		const cleared = await call("update_class_deadline", { class_id: id, deadline_id: deadlineId, time: null, done: false });
		assert.equal(cleared.error, false, JSON.stringify(cleared.body));
		assert.deepEqual((await call("read_class", { class_id: id })).body.deadlines, [
			{ id: deadlineId, kind: "quiz", name: "HW 1", date: "2026-11-06", done: false, files: [] },
		]);
		assert.equal((await call("update_class_deadline", { class_id: id, deadline_id: "ddl_nope", name: "x" })).error, true);
		assert.equal((await call("remove_class_deadline", { class_id: id, deadline_id: deadlineId })).error, false);
		assert.equal((await call("remove_class_deadline", { class_id: id, deadline_id: deadlineId })).error, true);
		assert.deepEqual((await call("read_class", { class_id: id })).body.deadlines, []);
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
		const token = ensureMcpToken();
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
		const token = ensureMcpToken();
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
			assert.equal(bridge.respondToWork(item.workId, { text: "A greeting." }, 0).ok, true);
			const done = await stream.result();
			assert.ok(done.content.some((c) => c.type === "text"));
			assert.equal(bridge.pendingWorkCount(), 0);
		} finally {
			off();
		}
	});
});

describe("the [Today] note and the outside agent (plan 2026-10-28, Phase 2)", () => {
	ensureMcpToken();

	async function turn(chatId: string, text: string) {
		const ack = await handleChatInput(chatId, { type: "text", text });
		assert.equal(ack.status, 200, await ack.clone().text());
		const work = await bridge.waitForWork(5000, { conversation: chatId });
		assert.ok(work, "the turn parked a request");
		assert.ok(bridge.respondToWork(work.workId, { text: "Okay." }, 0).ok);
		await waitFor(() => !isTurnRunning(chatId), 8000, "turn settle");
		return work;
	}
	const userTexts = (work: { messages: { role: string }[] }) =>
		work.messages.filter((m) => m.role === "user").map((m) => ("text" in m ? (m as { text: string }).text : ""));

	it("goes before the learner's first message, is skipped when nothing changed, and a new one keeps continued: true", async () => {
		const { classStore } = await import("../src/store/classes.ts");
		const cls = classStore.createClass({ name: "CSE 21" });
		const chat = chatStore.createChat("Counting", undefined, cls.id);
		chatStore.saveSettings(chat.id, { model: { provider: bridge.AGENT_PROVIDER, id: bridge.AGENT_MODEL_ID } });

		const first = await turn(chat.id, "teach me counting");
		assert.equal(first.continued, false);
		const firstUsers = userTexts(first);
		assert.match(firstUsers.at(-2) ?? "", /^\[Today\] \w{3} \w{3} \d{1,2} \d{4}, \d{1,2}:\d{2} [AP]M \(.+\)$/, "only the date line: no deadlines yet");
		assert.equal(firstUsers.at(-1), "teach me counting");

		const second = await turn(chat.id, "go on");
		assert.equal(second.continued, true);
		assert.deepEqual(userTexts(second), ["go on"], "same day, same deadlines: no new note");

		classStore.addDeadline(cls.id, { kind: "homework", name: "HW 9", date: "2099-01-01", time: "23:59", fileIds: [] });
		const third = await turn(chat.id, "and now?");
		assert.equal(third.continued, true, "an appended note still sends only the new messages");
		const [note, learner] = userTexts(third);
		assert.match(note ?? "", /\n\nComing up in this class \(not marked done\):\n- HW 9 \(homework\), due Thu Jan 1 11:59 PM, in \d+ days\.$/);
		assert.equal(learner, "and now?");

		const record = chatStore.getChat(chat.id)!;
		const notes = record.messages.filter((m) => m.role === "custom" && m.customType === "today-context");
		assert.equal(notes.length, 2, "two notes in the record, the first never rewritten");
		assert.ok(notes.every((n) => n.role === "custom" && n.display === false));
	});

	it("a practice lesson gets the note too; a lesson with no class gets only the date", async () => {
		const practice = chatStore.createChat("Practice", "practice");
		chatStore.saveSettings(practice.id, { model: { provider: bridge.AGENT_PROVIDER, id: bridge.AGENT_MODEL_ID } });
		const work = await turn(practice.id, "practice counting");
		const users = userTexts(work);
		assert.match(users.at(-2) ?? "", /^\[Today\] [^\n]+$/);
		assert.equal(users.at(-1), "practice counting");
	});
});
