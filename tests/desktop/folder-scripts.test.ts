/**
 * The godspeed folder's scripts as Claude Code and the start scripts run
 * them: the waiter, a Stop hook that reads the hook's JSON on stdin and
 * wakes the agent (exit 2, the item on stderr), with a stub for godspeed's
 * MCP endpoint; and the start scripts' version check.
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
	for (const name of ["wait-for-work.mjs", "target.mjs", "new-enough.mjs", "typed.mjs"]) fs.copyFileSync(new URL(name, FILES), path.join(root, name));
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
