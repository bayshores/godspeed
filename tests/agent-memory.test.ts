/**
 * Agent memory end to end: remember / forget through the MCP server, the
 * "Where you left off" briefing in the initialize instructions, and the
 * /api/agent-notes route behind Settings → Connection.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-agent-memory-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	HOME: path.join(scratch, "home"),
};
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
globalThis.fetch = async () => {
	throw new Error("CLOSED: unexpected network request");
};
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const mcp = await import("../src/server/mcp.ts");
const { ensureMcpToken } = await import("../src/store/mcp-token.ts");
const { NOTE_MAX_CHARS, NOTES_MAX } = await import("../src/core/agent-notes.ts");
const { chatStore } = await import("../src/store/chats.ts");
const route = await import("../src/app/api/agent-notes/route.ts");

const NOTES_FILE = path.join(scratch, "data", "agent-notes.json");

function rpc(body: unknown) {
	return new Request("http://127.0.0.1:3000/api/mcp", {
		method: "POST",
		headers: { host: "127.0.0.1:3000", "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${ensureMcpToken()}` },
		body: JSON.stringify(body),
	});
}

async function call(name: string, args: Record<string, unknown>) {
	const res = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }))).json();
	const text = res.result.content[0].text as string;
	return { error: res.result.isError === true, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}

async function instructions(client = "claude-code"): Promise<string> {
	const res = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: client, version: "1" } } }))).json();
	return res.result.instructions as string;
}

describe("agent memory", () => {
	beforeEach(() => fs.rmSync(NOTES_FILE, { force: true }));

	it("a saved note shows up in the next agent's instructions, and forget removes it", async () => {
		const classId = (await call("create_class", { name: "CSE 29", icon: "cpu" })).body.class.id as string;
		const saved = await call("remember", { text: "CSE 29 exam is done.", class_id: classId });
		assert.equal(saved.error, false);
		const noteId = saved.body.note.id as string;
		assert.match(noteId, /^note_[0-9a-f]{8}$/);

		const text = await instructions();
		assert.match(text, /## Where you left off/);
		assert.match(text, /- CSE 29 \(class_id "cls_/);
		assert.ok(text.includes(`- CSE 29 exam is done. (CSE 29, saved `));
		assert.ok(text.includes(`note_id "${noteId}"`));

		assert.deepEqual((await call("forget", { note_id: noteId })).body, { removed: noteId });
		assert.ok(!(await instructions()).includes(noteId));
		assert.equal((await call("forget", { note_id: noteId })).error, true);
	});

	it("refuses an unknown class, and a full list names the notes to forget", async () => {
		assert.equal((await call("remember", { text: "x", class_id: "cls_missing" })).error, true);
		for (let i = 1; i <= NOTES_MAX; i++) assert.equal((await call("remember", { text: `note ${i}` })).error, false);
		const full = await call("remember", { text: "one too many" });
		assert.equal(full.error, true);
		assert.match(full.body, /Forget one that is out of date first/);
		assert.match(full.body, /: note 30$/);
	});

	it("GET /api/agent-notes lists notes with class names; DELETE removes one", async () => {
		const classId = (await call("create_class", { name: "CSE 21", icon: "sigma" })).body.class.id as string;
		const a = (await call("remember", { text: "Homework 4 next.", class_id: classId })).body.note.id as string;
		const b = (await call("remember", { text: "Wants hints." })).body.note.id as string;

		const listed = (await (await route.GET()).json()) as { notes: { id: string; text: string; className: string | null }[] };
		assert.deepEqual(
			listed.notes.map((n) => [n.id, n.text, n.className]),
			[
				[a, "Homework 4 next.", "CSE 21"],
				[b, "Wants hints.", null],
			],
		);

		const deleted = await route.DELETE(new Request(`http://127.0.0.1/api/agent-notes?id=${a}`, { method: "DELETE" }));
		assert.deepEqual(((await deleted.json()) as { notes: { id: string }[] }).notes.map((n) => n.id), [b]);
		assert.equal((await route.DELETE(new Request(`http://127.0.0.1/api/agent-notes?id=${a}`, { method: "DELETE" }))).status, 404);
	});

	it("a big briefing still ends within Claude Code's first 4096 characters, after the loop, before Memory and Classes", async () => {
		for (let c = 1; c <= 8; c++) {
			const classId = (await call("create_class", { name: `Course ${c}: Discrete Mathematics and Proof`, icon: "sigma" })).body.class.id as string;
			const deadlines = [1, 2, 3].map((n) => ({ kind: "homework", name: `Homework ${n} on counting and recursion`, date: `2027-0${n}-1${c}`, time: "23:59" }));
			assert.equal((await call("add_class_deadline", { class_id: classId, deadlines })).error, false);
			for (let l = 1; l <= 3; l++) chatStore.createChat(`Lesson ${l} of course ${c}: strong induction and recurrences`, undefined, classId);
		}
		const noteText = (i: number) => `Note ${i}: the learner wants worked examples before any proof, and short hints instead of answers. `.repeat(3).slice(0, NOTE_MAX_CHARS).trim();
		for (let i = 1; i <= NOTES_MAX; i++) assert.equal((await call("remember", { text: noteText(i) })).error, false);

		const positions = (text: string) => ({
			loop: text.indexOf("The work loop:"),
			briefing: text.indexOf("## Where you left off"),
			briefingEnd: text.indexOf("\n\nMemory:"),
			classes: text.indexOf("\n\nClasses: the learner"),
		});

		const claudeCode = positions(await instructions("claude-code"));
		assert.ok(claudeCode.loop < claudeCode.briefing && claudeCode.briefing < claudeCode.briefingEnd && claudeCode.briefingEnd < claudeCode.classes, JSON.stringify(claudeCode));
		assert.ok(claudeCode.briefingEnd <= 4096, `the briefing ends at ${claudeCode.briefingEnd}`);
		const trimmed = (await instructions("claude-code")).slice(claudeCode.briefing, claudeCode.briefingEnd);
		assert.match(trimmed, /\n\nLeft out to fit: .+\. Use list_lessons \/ read_class for lessons and deadlines\.$/);
		assert.match(trimmed, /Note 30:/, "the newest note stays");

		const codex = positions(await instructions("codex-mcp-client"));
		assert.ok(codex.loop < codex.briefing && codex.briefing < codex.briefingEnd && codex.briefingEnd < codex.classes, JSON.stringify(codex));
	});
});
