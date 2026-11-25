/**
 * godspeed's Claude helper (crates/runtime/src/claude/claude-helper.mjs) on a stand-in for the
 * Agent SDK's `query`: the JSON lines it speaks with the server, two sessions at once, a resume,
 * godspeed's tools through its in-process MCP server, a question that ends the turn, a permission
 * question, web search without one, and the learner's own launch command. One test runs the real
 * SDK on a stand-in Claude Code, to see what a job working in a folder with a CLAUDE.md is started
 * with and sent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serve } from "../../crates/runtime/src/claude/claude-helper.mjs";

type Json = Record<string, unknown>;
type Hook = (input: Json, toolUseId: string, options: { signal: AbortSignal }) => Promise<Json>;
interface Options {
	sessionId?: string;
	resume?: string;
	mcpServers: { godspeed: { instance: McpServer } };
	hooks: { PostToolUse: { hooks: Hook[] }[] };
	canUseTool: (tool: string, input: Json, options: { signal: AbortSignal; toolUseID: string; mcpServer?: { name: string; source: string } }) => Promise<Json>;
	spawnClaudeCodeProcess?: (options: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal }) => { stdout: NodeJS.ReadableStream; once: (event: "exit", listener: () => void) => void };
	[key: string]: unknown;
}
interface UserMessage {
	message: { content: { type: string; text: string }[] };
}

const signal = () => new AbortController().signal;

/** A stand-in for the SDK's `query`: each user message plays a short turn named by its text. */
function stubQuery(seen: { options: Options[]; calls: string[] }) {
	return ({ prompt, options }: { prompt: AsyncIterable<UserMessage>; options: Options }) => {
		seen.options.push(options);
		let client: Client | undefined;
		async function tools() {
			if (!client) {
				const [server, ours] = InMemoryTransport.createLinkedPair();
				await options.mcpServers.godspeed.instance.connect(server);
				client = new Client({ name: "stub", version: "1.0.0" });
				await client.connect(ours);
			}
			return client;
		}
		const turns = (async function* () {
			for await (const user of prompt) {
				const text = user.message.content[0]?.text;
				yield { type: "system", subtype: "init", session_id: options.sessionId ?? options.resume };
				if (text === "quiz") {
					const mcp = await tools();
					const listed = await mcp.listTools();
					const result = await mcp.callTool({ name: "quiz", arguments: { question: "2 + 2?" }, _meta: { "claudecode/toolUseId": "toolu_q" } });
					const hook = options.hooks.PostToolUse[0]!.hooks[0]!;
					const after = await hook({ hook_event_name: "PostToolUse", tool_use_id: "toolu_q" }, "toolu_q", { signal: signal() });
					const other = await hook({ hook_event_name: "PostToolUse", tool_use_id: "toolu_other" }, "toolu_other", { signal: signal() });
					yield { type: "result", subtype: "success", listed, result, after, other };
				} else if (text === "bash") {
					const own = await options.canUseTool("mcp__godspeed__quiz", { question: "?" }, { signal: signal(), toolUseID: "toolu_g", mcpServer: { name: "godspeed", source: "sdk" } });
					const search = await options.canUseTool("WebSearch", { query: "limits" }, { signal: signal(), toolUseID: "toolu_w" });
					const decision = await options.canUseTool("Bash", { command: "ls" }, { signal: signal(), toolUseID: "toolu_b" });
					yield { type: "result", subtype: "success", own, search, decision };
				} else {
					yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: `echo ${text}` } } };
					yield { type: "result", subtype: "success" };
				}
			}
		})();
		return Object.assign(turns, {
			interrupt: async () => void seen.calls.push("interrupt"),
			setModel: async (model: string) => void seen.calls.push(`model ${model}`),
			close: () => void seen.calls.push("close"),
		});
	};
}

/** The helper on in-memory pipes: `send` writes a line to it, `next` reads its next line. */
function helper() {
	const seen = { options: [] as Options[], calls: [] as string[] };
	const input = new PassThrough();
	const output = new PassThrough();
	// The stand-in plays only what the helper uses of the SDK's query.
	serve({ input, output, query: stubQuery(seen) as unknown as NonNullable<Parameters<typeof serve>[0]["query"]> });
	const lines: Json[] = [];
	const waiters: ((line: Json) => void)[] = [];
	createInterface({ input: output }).on("line", (line) => {
		const message = JSON.parse(line) as Json;
		const waiter = waiters.shift();
		if (waiter) waiter(message);
		else lines.push(message);
	});
	return {
		seen,
		send: (message: Json) => input.write(`${JSON.stringify(message)}\n`),
		next: () => new Promise<Json>((resolve) => (lines.length ? resolve(lines.shift()!) : waiters.push(resolve))),
	};
}

const QUIZ = { name: "quiz", description: "Show the learner one quiz question.", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } };
const open = (session: string, extra: Json) => ({ type: "open", session, cwd: "/work", model: "claude-sonnet-5-5", resume: null, persist: true, systemPrompt: "You are a tutor.", tools: [QUIZ], ...extra });

test("two sessions open at once, one new and one resumed, each with its own options", async () => {
	const { seen, send, next } = helper();
	send(open("s1", { claudePath: "/bin/claude" }));
	send(open("s2", { resume: "sess-old", launcher: "my-launcher --" }));
	const first = await next();
	const second = await next();
	assert.equal(first.type, "opened");
	assert.match(String(first.nativeId), /^[0-9a-f-]{36}$/);
	assert.deepEqual(second, { type: "opened", session: "s2", nativeId: "sess-old" });
	const [fresh, resumed] = seen.options;
	assert.equal(fresh!.sessionId, first.nativeId, "a new session's id is chosen up front");
	assert.equal(fresh!.resume, undefined);
	assert.equal(resumed!.resume, "sess-old");
	assert.equal(resumed!.sessionId, undefined);
	for (const options of [fresh!, resumed!]) {
		assert.deepEqual(options.settingSources, []);
		assert.equal(options.strictMcpConfig, true);
		assert.deepEqual(options.disallowedTools, ["Agent", "Skill"]);
		assert.equal(options.allowedTools, undefined, "an allowed tool would never reach canUseTool");
		assert.equal(options.permissionMode, "default");
		assert.equal(options.includePartialMessages, true);
		assert.deepEqual(options.systemPrompt, { type: "preset", preset: "claude_code", append: "You are a tutor." });
	}
	assert.equal(fresh!.pathToClaudeCodeExecutable, "/bin/claude");
	assert.equal(resumed!.pathToClaudeCodeExecutable, undefined);
	assert.equal(typeof resumed!.spawnClaudeCodeProcess, "function");

	// Each session's turns come back under its own name.
	send({ type: "send", session: "s1", content: [{ type: "text", text: "one" }] });
	send({ type: "send", session: "s2", content: [{ type: "text", text: "two" }] });
	const replies = await Promise.all(Array.from({ length: 6 }, next));
	const texts = replies.map((line) => [line.session, (line.message as Json).type]);
	assert.deepEqual(texts.filter(([session]) => session === "s1"), [["s1", "system"], ["s1", "stream_event"], ["s1", "result"]]);
	assert.deepEqual(texts.filter(([session]) => session === "s2"), [["s2", "system"], ["s2", "stream_event"], ["s2", "result"]]);

	send({ type: "interrupt", session: "s1" });
	send({ type: "model", session: "s2", model: "claude-opus-5-5" });
	send({ type: "close", session: "s1" });
	assert.deepEqual(await next(), { type: "closed", session: "s1" });
	assert.deepEqual(seen.calls, ["interrupt", "model claude-opus-5-5", "close"]);
	send({ type: "send", session: "s1", content: [] });
	assert.deepEqual(await next(), { type: "error", session: "s1", message: "no open session s1" });
});

test("a godspeed tool call goes to the server, and its answer can end the turn", async () => {
	const { send, next } = helper();
	send(open("s1", { claudePath: "/bin/claude" }));
	await next();
	send({ type: "send", session: "s1", content: [{ type: "text", text: "quiz" }] });
	assert.equal(((await next()).message as Json).subtype, "init");
	const call = await next();
	assert.deepEqual(call, { type: "tool_call", session: "s1", toolUseId: "toolu_q", name: "quiz", args: { question: "2 + 2?" }, id: call.id });
	send({ type: "tool_result", id: call.id, content: [{ type: "text", text: "Shown to the learner." }], isError: false, endTurn: true });
	const result = (await next()).message as { listed: { tools: Json[] }; result: Json; after: Json; other: Json };
	assert.deepEqual(result.listed.tools, [{ ...QUIZ, _meta: { "anthropic/alwaysLoad": true } }], "the schema as godspeed wrote it, always loaded");
	assert.deepEqual(result.result.content, [{ type: "text", text: "Shown to the learner." }]);
	assert.equal(result.after.continue, false, "the question's PostToolUse hook stops the turn");
	assert.deepEqual(result.other, {}, "other tools go on");
});

test("a permission question waits for the learner's answer, and godspeed's own tools and web search never ask", async () => {
	const { send, next } = helper();
	send(open("s1", { claudePath: "/bin/claude" }));
	await next();
	send({ type: "send", session: "s1", content: [{ type: "text", text: "bash" }] });
	await next();
	const asked = await next();
	assert.deepEqual(asked, { type: "approval", session: "s1", tool: "Bash", input: { command: "ls" }, toolUseId: "toolu_b", id: asked.id });
	send({ type: "approval", id: asked.id, allow: false, message: "The learner did not allow this." });
	const result = (await next()).message as Json;
	assert.deepEqual(result.own, { behavior: "allow", updatedInput: { question: "?" } });
	assert.deepEqual(result.search, { behavior: "allow", updatedInput: { query: "limits" } }, "asked before Bash, it never reached the learner");
	assert.deepEqual(result.decision, { behavior: "deny", message: "The learner did not allow this." });
});

test("the learner's own command starts Claude Code with the SDK's arguments after it", { skip: process.platform === "win32" }, async () => {
	const { seen, send, next } = helper();
	send(open("s1", { launcher: "echo launched" }));
	await next();
	const child = seen.options[0]!.spawnClaudeCodeProcess!({ command: "claude", args: ["--model", "a b"], cwd: "/", env: process.env, signal: signal() });
	let out = "";
	child.stdout.on("data", (data: Buffer) => (out += data));
	await new Promise<void>((resolve) => child.once("exit", resolve));
	assert.equal(out, "launched --model a b\n");
});

test("a job in a folder that holds a CLAUDE.md and an AGENTS.md starts Claude Code with no setting sources, and sends neither", { skip: process.platform === "win32" }, async () => {
	// A cheat sheet works in a folder inside the godspeed folder, which has a CLAUDE.md of its own.
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-helper-job-"));
	const folder = path.join(dir, "cheat-sheets", "sheet");
	fs.mkdirSync(folder, { recursive: true });
	const RULE = "Folder rule: answer in French.";
	for (const file of [path.join(dir, "CLAUDE.md"), path.join(folder, "CLAUDE.md"), path.join(folder, "AGENTS.md")]) fs.writeFileSync(file, RULE);
	// The stand-in Claude Code keeps its arguments and what it was sent for half a second, then quits.
	const seenFile = path.join(dir, "seen.json");
	const standIn = path.join(dir, "claude.mjs");
	fs.writeFileSync(standIn, `import * as fs from "node:fs";\nlet sent = "";\nprocess.stdin.on("data", (data) => (sent += data));\nsetTimeout(() => { fs.writeFileSync(${JSON.stringify(seenFile)}, JSON.stringify({ args: process.argv.slice(2), sent })); process.exit(0); }, 500);\n`);
	const input = new PassThrough();
	const output = new PassThrough();
	serve({ input, output });
	const say = (message: Json) => input.write(`${JSON.stringify(message)}\n`);
	try {
		say(open("j1", { cwd: folder, persist: false, launcher: `"${process.execPath}" "${standIn}"` }));
		say({ type: "send", session: "j1", content: [{ type: "text", text: "Make the sheet." }] });
		for (let tries = 0; !fs.existsSync(seenFile); tries++) {
			assert.ok(tries < 200, "the stand-in Claude Code never started");
			await new Promise((done) => setTimeout(done, 50));
		}
		const seen = JSON.parse(fs.readFileSync(seenFile, "utf8")) as { args: string[]; sent: string };
		assert.ok(seen.args.includes("--setting-sources="), `no setting sources, so no CLAUDE.md is read: ${seen.args.join(" ")}`);
		assert.ok(seen.sent.includes("Make the sheet."), "the job's request was sent");
		assert.ok(!JSON.stringify(seen).includes(RULE), "nothing of the folder's files is sent");
	} finally {
		say({ type: "close", session: "j1" });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
