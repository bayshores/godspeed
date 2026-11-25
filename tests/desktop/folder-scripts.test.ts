/**
 * The godspeed folder's scripts as Claude Code and the start scripts run
 * them, with a stub for godspeed's endpoint: the prompt hook, the agent
 * event hook, and the start scripts' version check.
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

/** A folder like the godspeed folder's `.godspeed/`. */
function folder() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "gs-folder-scripts-"));
	for (const name of ["target.mjs", "new-enough.mjs", "typed.mjs", "agent-event.mjs"]) fs.copyFileSync(new URL(name, FILES), path.join(root, name));
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true, type: "module", version: "0.0.0" }));
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
		for (const key of ["GODSPEED_MCP_URL", "GODSPEED_MCP_TOKEN", "GODSPEED_TERMINAL"]) delete base[key];
		const child = spawn(process.execPath, [path.join(root, script), ...args], { env: { ...base, GODSPEED_DATA_DIR: path.join(root, "data"), ...env } });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(stdin);
	});
}

test("a typed line is offered to the page on screen, and a background notice is not", async () => {
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
		const notice = "<task-notification>\n<summary>Background command finished</summary>\n</task-notification>";
		assert.deepEqual(await run(root, "typed.mjs", prompt(notice), env), { code: 0, stdout: "", stderr: "" });
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
