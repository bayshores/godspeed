/**
 * The godspeed folder's scripts as Claude Code and the start scripts run
 * them: the waiter, a Stop hook that reads the hook's JSON on stdin and
 * wakes the agent (exit 2, the item on stderr), with a stub for godspeed's
 * MCP endpoint; the agent event hook; and the start scripts' version check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

const FILES = new URL("../../crates/services/folder-files/", import.meta.url);
const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** A folder like the godspeed folder's `.godspeed/`, and a temp folder for the locks. */
function folder() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gs-waiter-"));
	for (const name of ["wait-for-work.mjs", "target.mjs", "new-enough.mjs", "typed.mjs", "agent-event.mjs"]) fs.copyFileSync(new URL(name, FILES), path.join(root, name));
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true, type: "module", version: "0.0.0" }));
	fs.mkdirSync(path.join(root, "tmp"));
	fs.mkdirSync(path.join(root, "data"));
	return root;
}

interface Run {
	code: number | null;
	stdout: string;
	stderr: string;
}

function run(root: string, script: string, stdin: string, env: Record<string, string> = {}, args: string[] = []): Promise<Run> {
	return new Promise((resolve) => {
		const base = { ...process.env };
		for (const key of ["GODSPEED_MCP_URL", "GODSPEED_MCP_TOKEN", "GODSPEED_TERMINAL", "GODSPEED_HELPER"]) delete base[key];
		const child = spawn(process.execPath, [path.join(root, script), ...args], { env: { ...base, TMPDIR: path.join(root, "tmp"), GODSPEED_DATA_DIR: path.join(root, "data"), ...env } });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(stdin);
	});
}

const hook = JSON.stringify({ session_id: SESSION, hook_event_name: "Stop", stop_hook_active: false });

/** godspeed's endpoint, answering each wait_for_work with the next of `answers`. */
async function godspeed(answers: { status?: number; body: unknown }[]) {
	const asked: unknown[] = [];
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			asked.push(JSON.parse(body));
			const answer = answers.shift() ?? { body: idle() };
			res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
			res.end(JSON.stringify(answer.body));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`;
	return { asked, env: { GODSPEED_MCP_URL: url, GODSPEED_MCP_TOKEN: "t" }, close: () => server.close() };
}

const result = (...texts: string[]) => ({ jsonrpc: "2.0", id: 1, result: { content: texts.map((text) => ({ type: "text", text })) } });
const idle = () => result(JSON.stringify({ status: "idle", note: "Nothing to do right now." }));

test("a work item wakes the agent whole, after any number of idle answers", async () => {
	const root = folder();
	const long = "x".repeat(200_000);
	const app = await godspeed([{ body: idle() }, { body: result(JSON.stringify({ status: "work", workId: "w_1" }), `[text 1]\n${long}`) }]);
	try {
		const woke = await run(root, "wait-for-work.mjs", hook, { ...app.env, GODSPEED_HELPER: "1" });
		assert.equal(woke.code, 2);
		assert.equal(woke.stderr, `{"status":"work","workId":"w_1"}\n\n[text 1]\n${long}\n`);
		assert.equal(woke.stdout, "");
		const call = app.asked[0] as { params: { arguments: unknown; _meta: Record<string, unknown> } };
		assert.deepEqual(call.params.arguments, { timeout_seconds: 55, helper: true });
		assert.equal(call.params._meta["godspeed/agent"], SESSION);
		assert.deepEqual(fs.readdirSync(path.join(root, "tmp", "godspeed-waiters")), [], "its lock is gone");
	} finally {
		app.close();
	}
});

test("a second waiter for the same session ends at once while the first one waits", async () => {
	const root = folder();
	const locks = path.join(root, "tmp", "godspeed-waiters");
	const lock = path.join(locks, `${SESSION}.pid`);
	fs.mkdirSync(locks, { recursive: true });
	fs.writeFileSync(lock, String(process.pid));
	const app = await godspeed([]);
	try {
		assert.deepEqual(await run(root, "wait-for-work.mjs", hook, app.env), { code: 0, stdout: "", stderr: "" });
		assert.equal(app.asked.length, 0);
	} finally {
		app.close();
	}
	const work = () => godspeed([{ body: result(JSON.stringify({ status: "work", workId: "w_2" })) }]);
	// A lock older than the hook's timeout is stale, whoever has its pid now.
	const hours = new Date(Date.now() - 3 * 3_600_000);
	fs.utimesSync(lock, hours, hours);
	const late = await work();
	try {
		assert.equal((await run(root, "wait-for-work.mjs", hook, late.env)).code, 2);
	} finally {
		late.close();
	}
	// A waiter that was killed left its lock behind: the next one takes over.
	fs.writeFileSync(lock, "999999999");
	const killed = await work();
	try {
		assert.equal((await run(root, "wait-for-work.mjs", hook, killed.env)).code, 2);
	} finally {
		killed.close();
	}
});

test("a failure wakes the agent once, and a closed terminal ends the wait quietly", async () => {
	const root = folder();
	const first = await run(root, "wait-for-work.mjs", hook);
	assert.equal(first.code, 2);
	assert.match(first.stderr, /access token was not found/);
	assert.deepEqual(await run(root, "wait-for-work.mjs", hook), { code: 0, stdout: "", stderr: "" }, "the turn that told the user ends in a quiet waiter");

	const closed = await godspeed([{ status: 403, body: { error: "This terminal was closed in godspeed." } }]);
	try {
		assert.deepEqual(await run(root, "wait-for-work.mjs", hook, closed.env), { code: 0, stdout: "", stderr: "" });
	} finally {
		closed.close();
	}
	const refused = await godspeed([{ status: 401, body: { error: "Wrong token." } }]);
	try {
		const again = await run(root, "wait-for-work.mjs", hook, refused.env);
		assert.deepEqual([again.code, again.stderr], [2, "godspeed refused the request (401): Wrong token.\n"], "another failure is told");
	} finally {
		refused.close();
	}
});

test("a typed line is offered to the page on screen, and the waiter's wake is not", async () => {
	const root = folder();
	const lines: unknown[] = [];
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			lines.push([req.url, JSON.parse(body)]);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ sent: "lesson" }));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const env = { GODSPEED_MCP_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`, GODSPEED_MCP_TOKEN: "t", GODSPEED_TERMINAL: "a".repeat(32) };
	const prompt = (text: string) => JSON.stringify({ session_id: SESSION, hook_event_name: "UserPromptSubmit", prompt: text });
	try {
		const typed = await run(root, "typed.mjs", prompt("why is that?"), env);
		assert.equal(JSON.parse(typed.stdout).reason, "Sent to your lesson.");
		const wake = '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\nStop hook blocking error from command "Stop": {"status":"work"}\n</system-reminder>';
		assert.deepEqual(await run(root, "typed.mjs", prompt(wake), env), { code: 0, stdout: "", stderr: "" });
		assert.deepEqual(lines, [["/api/mcp/line", { line: "why is that?" }]]);
	} finally {
		server.close();
	}
});

test("the agent's own tools are told with a subject cut before it leaves, never as needing the learner", async () => {
	const root = folder();
	const told: unknown[] = [];
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			told.push([req.url, JSON.parse(body)]);
			res.writeHead(200, { "content-type": "application/json" });
			res.end('{"ok":true}');
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const env = { GODSPEED_MCP_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/mcp`, GODSPEED_MCP_TOKEN: "t", GODSPEED_TERMINAL: "a".repeat(32) };
	const pre = (tool_name: string, tool_input: unknown) => JSON.stringify({ session_id: SESSION, hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "toolu_1" });
	const long = "how to find the inverse of a matrix ".repeat(4);
	const cases: [string, unknown, string | undefined][] = [
		["Read", { file_path: "/Users/me/Secret Plans/syllabus.pdf" }, "syllabus.pdf"],
		["Read", { file_path: "C:\\Users\\me\\Documents\\taxes 2026.pdf" }, "taxes 2026.pdf"],
		["Read", { file_path: "/Users/me/notes/" }, undefined],
		["WebFetch", { url: "https://cse29.site/hw7?token=abc123&user=me#part", prompt: "due dates" }, "cse29.site"],
		["WebFetch", { url: "https://me:pw@cse29.site:8443/private" }, "cse29.site"],
		["WebFetch", { url: "not a page address" }, undefined],
		["WebSearch", { query: " cse 21\n hw7 " }, "cse 21 hw7"],
		["WebSearch", { query: long }, [...long.trim()].slice(0, 80).join("")],
		["Grep", { pattern: "due", path: "/Users/me/godspeed/spaces" }, "due"],
		["Grep", { pattern: "Fällig 7" }, "Fällig 7"],
		["Grep", { pattern: "due\\s+\\d+" }, undefined],
		["Grep", { pattern: "password=.*" }, undefined],
		["Glob", { pattern: "**/secret/*.pdf" }, undefined],
		["Bash", { command: "curl -H 'Authorization: Bearer sk-live-123' https://cse29.site", description: "Fetch the page" }, undefined],
		["Edit", { file_path: "/Users/me/godspeed/made/notes.md", old_string: "a", new_string: "b" }, undefined],
		["apply_patch", { command: "*** Begin Patch\n*** Update File: /Users/me/x.md" }, undefined],
	];
	try {
		for (const [tool, input, subject] of cases) {
			told.length = 0;
			assert.deepEqual(await run(root, "agent-event.mjs", pre(tool, input), env), { code: 0, stdout: "", stderr: "" }, tool);
			assert.deepEqual(told, [["/api/mcp/agent-event", subject === undefined ? { event: "tool", tool } : { event: "tool", tool, subject }]], `${tool} ${JSON.stringify(input)}`);
		}
		told.length = 0;
		const { GODSPEED_TERMINAL: _, ...outside } = env;
		assert.deepEqual(await run(root, "agent-event.mjs", pre("WebSearch", { query: "hw7" }), outside), { code: 0, stdout: "", stderr: "" });
		assert.deepEqual(told, [], "an agent outside godspeed's terminals tells nothing");
	} finally {
		server.close();
	}
});

test("run by hand, not as a hook, it says godspeed was updated", async () => {
	const root = folder();
	const ran = await run(root, "wait-for-work.mjs", "");
	assert.equal(ran.code, 1);
	assert.equal(ran.stdout, "godspeed was updated. Close this window and open your agent from godspeed again.\n");
});

test("the start script's version check stops only a Claude Code it can read as older", async () => {
	const root = folder();
	const cases: [string, number][] = [
		["2.1.330 (Claude Code)\n", 0],
		["2.1.331 (Claude Code)\n", 0],
		["2.2.0 (Claude Code)\n", 0],
		["10.0.0\n", 0],
		["2.1.329 (Claude Code)\n", 1],
		["1.9.999\n", 1],
		["something else\n", 0],
		["", 0],
	];
	for (const [said, code] of cases) assert.equal((await run(root, "new-enough.mjs", said, {}, ["2.1.330"])).code, code, JSON.stringify(said));
});
