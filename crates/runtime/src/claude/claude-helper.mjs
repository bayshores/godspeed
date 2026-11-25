// godspeed's Claude helper. The godspeed server runs it with the learner's own Node and speaks
// to it in JSON lines over stdin and stdout (crates/runtime/src/claude/protocol.rs). Each
// session is one Agent SDK query on the learner's own Claude Code, with godspeed's tools served
// in-process; every tool call and permission question goes to the server and waits for its answer.
// It also answers which models Claude Code offers.
// scripts/build-claude-helper.mjs bundles this file with the SDK into the app.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** The MCP server godspeed's tools live on; Claude Code names them `mcp__godspeed__<tool>`. */
const TOOL_SERVER = "godspeed";

/**
 * One session's input: the SDK reads the learner's messages from it as they come. Each session
 * has its own, made before its query starts; one shared between queries hung a resumed session.
 */
function inputQueue() {
	const items = [];
	let wake = null;
	let ended = false;
	const ring = () => {
		wake?.();
		wake = null;
	};
	return {
		push(item) {
			items.push(item);
			ring();
		},
		end() {
			ended = true;
			ring();
		},
		async *[Symbol.asyncIterator]() {
			for (;;) {
				while (!items.length && !ended) await new Promise((resolve) => (wake = resolve));
				if (!items.length) return;
				yield items.shift();
			}
		},
	};
}

/** Quotes one argument for cmd.exe running a `.cmd` file, which reads it twice (as cross-spawn does). */
function cmdArgument(arg) {
	const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
	return quoted.replace(/[()\][%!^"`<>&|;, *?]/g, "^^^$&");
}

/** Starts Claude Code through the learner's own command, with the SDK's arguments after it. */
function launcher(command) {
	return ({ args, cwd, env, signal }) => {
		const child =
			process.platform === "win32"
				? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${command} ${args.map(cmdArgument).join(" ")}"`], { cwd, env, signal, windowsVerbatimArguments: true, windowsHide: true })
				: spawn("/bin/sh", ["-c", `${command} "$@"`, "sh", ...args], { cwd, env, signal });
		child.stderr.on("data", (data) => process.stderr.write(`[claude launcher] ${data}`));
		return child;
	};
}

/**
 * Serves sessions on `input` and `output`. `query` is the Agent SDK's; a test passes a stand-in.
 */
export function serve({ input, output, query = sdkQuery }) {
	const sessions = new Map();
	const waiting = new Map();
	let nextId = 1;
	const write = (message) => output.write(`${JSON.stringify(message)}\n`);

	/** Sends the server a question and waits for its answer. An abort answers with `aborted`. */
	function ask(message, signal, aborted) {
		const id = String(nextId++);
		write({ ...message, id });
		return new Promise((resolve) => {
			waiting.set(id, resolve);
			signal?.addEventListener("abort", () => {
				waiting.delete(id);
				resolve(aborted);
			});
		});
	}

	function toolServer(session, tools) {
		const server = new McpServer({ name: TOOL_SERVER, version: "1.0.0" }, { capabilities: { tools: {} } });
		// Raw handlers take the server's JSON Schemas as they are; alwaysLoad keeps the tools out of
		// Claude Code's tool search, so each is there from the first call.
		server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, _meta: { "anthropic/alwaysLoad": true } })),
		}));
		server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
			const toolUseId = request.params._meta?.["claudecode/toolUseId"] ?? null;
			// A call the SDK gives up on is answered by no one.
			const reply = await ask({ type: "tool_call", session: session.key, toolUseId, name: request.params.name, args: request.params.arguments ?? {} }, extra?.signal, { content: [], isError: true });
			if (reply.endTurn && toolUseId) session.endAfter.add(toolUseId);
			return { content: reply.content, isError: reply.isError };
		});
		return { type: "sdk", name: TOOL_SERVER, instance: server };
	}

	function open(message) {
		const { session: key, cwd, model, resume, persist, systemPrompt, tools, claudePath, launcher: command } = message;
		const session = { key, queue: inputQueue(), endAfter: new Set(), query: null, closing: false };
		const nativeId = resume ?? randomUUID();
		try {
			session.query = query({
				prompt: session.queue,
				options: {
					cwd,
					model: model ?? undefined,
					...(resume ? { resume } : { sessionId: nativeId }),
					persistSession: persist,
					systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt },
					// None of the learner's own settings, hooks, skills, subagents or MCP servers.
					settingSources: [],
					strictMcpConfig: true,
					disallowedTools: ["Agent", "Skill"],
					mcpServers: { [TOOL_SERVER]: toolServer(session, tools) },
					includePartialMessages: true,
					permissionMode: "default",
					canUseTool: async (tool, toolInput, { signal, toolUseID, mcpServer }) => {
						// godspeed's own tools and the agent's own web search run without asking. The SDK
						// says which server a tool is from; a configured server could reuse the name, never
						// the source.
						if ((mcpServer?.source === "sdk" && mcpServer.name === TOOL_SERVER) || (!mcpServer && tool === "WebSearch")) return { behavior: "allow", updatedInput: toolInput };
						const reply = await ask({ type: "approval", session: key, tool, input: toolInput, toolUseId: toolUseID ?? null }, signal, { allow: false, message: "Stopped." });
						return reply.allow ? { behavior: "allow", updatedInput: toolInput } : { behavior: "deny", message: reply.message };
					},
					hooks: {
						// A question for the learner ends the turn right after its result.
						PostToolUse: [{ hooks: [async (hook) => (session.endAfter.delete(hook.tool_use_id) ? { continue: false, stopReason: "godspeed is waiting for the learner." } : {})] }],
					},
					stderr: (data) => process.stderr.write(`[claude ${key}] ${data}`),
					...(command ? { spawnClaudeCodeProcess: launcher(command) } : { pathToClaudeCodeExecutable: claudePath }),
				},
			});
		} catch (err) {
			return write({ type: "error", session: key, message: err instanceof Error ? err.message : String(err) });
		}
		sessions.set(key, session);
		write({ type: "opened", session: key, nativeId });
		void pump(session);
	}

	/**
	 * Answers with the models Claude Code offers. It starts Claude Code with no input, so no model
	 * is called, and none of the learner's own settings.
	 */
	async function models(message) {
		const { id, claudePath, launcher: command } = message;
		const queue = inputQueue();
		try {
			const listing = query({
				prompt: queue,
				options: {
					cwd: tmpdir(),
					persistSession: false,
					settingSources: [],
					strictMcpConfig: true,
					stderr: (data) => process.stderr.write(`[claude models] ${data}`),
					...(command ? { spawnClaudeCodeProcess: launcher(command) } : { pathToClaudeCodeExecutable: claudePath }),
				},
			});
			try {
				write({ type: "models", id, models: await listing.supportedModels() });
			} finally {
				queue.end();
				listing.close();
			}
		} catch (err) {
			write({ type: "models", id, error: err instanceof Error ? err.message : String(err) });
		}
	}

	async function pump(session) {
		try {
			for await (const message of session.query) write({ type: "sdk", session: session.key, message });
		} catch (err) {
			if (!session.closing) write({ type: "error", session: session.key, message: err instanceof Error ? err.message : String(err) });
		}
		sessions.delete(session.key);
		write({ type: "closed", session: session.key });
	}

	/** Runs a query control call, reporting a failure as the session's error. */
	function control(session, call) {
		call(session.query).catch((err) => write({ type: "error", session: session.key, message: err instanceof Error ? err.message : String(err) }));
	}

	function take(message) {
		const session = sessions.get(message.session);
		switch (message.type) {
			case "open":
				return open(message);
			case "models":
				return void models(message);
			case "tool_result":
			case "approval": {
				const resolve = waiting.get(message.id);
				waiting.delete(message.id);
				return resolve?.(message);
			}
		}
		if (!session) return write({ type: "error", session: message.session ?? null, message: `no open session ${message.session}` });
		switch (message.type) {
			case "send":
				return session.queue.push({ type: "user", message: { role: "user", content: message.content }, parent_tool_use_id: null, session_id: "" });
			case "interrupt":
				return control(session, (query) => query.interrupt());
			case "model":
				return control(session, (query) => query.setModel(message.model));
			case "close":
				session.closing = true;
				session.queue.end();
				return session.query.close();
			default:
				return write({ type: "error", session: session.key, message: `unknown message type ${message.type}` });
		}
	}

	const lines = createInterface({ input });
	lines.on("line", (line) => {
		if (!line.trim()) return;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return write({ type: "error", session: null, message: `a line that is not JSON: ${line.slice(0, 200)}` });
		}
		take(message);
	});
	return lines;
}

// Run as a program, not imported by a test. Node names its main module by its real path.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	const lines = serve({ input: process.stdin, output: process.stdout });
	// The server closing stdin ends every session's Claude Code with the helper.
	lines.on("close", () => process.exit(0));
}
