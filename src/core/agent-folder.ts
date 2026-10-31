/**
 * The godspeed folder (default ~/godspeed): the one folder an outside agent
 * is opened in. It holds the agent's instructions (CLAUDE.md, AGENTS.md),
 * the connection to the app (.mcp.json for Claude Code, command-line flags
 * for Codex) and, in .godspeed/, the scripts and the start scripts the
 * app's "Open Claude Code" button runs. Pure: the generated file contents
 * and commands. src/server/agent-folder.ts writes them.
 */

export type FolderAgent = "claude" | "codex";

/** The old ways godspeed loaded outside the folder that are still set up:
 *  the retired Claude Code plugin, and the block once pasted into Codex's config. */
export interface OldSetup {
	plugin: boolean;
	codex: boolean;
}

export type Platform = "darwin" | "win32" | "linux";

/** The prompt each agent starts with; CLAUDE.md and AGENTS.md say what it means. */
const START_PROMPT = "Start teaching";

/** Settings Claude Code loads at launch (--settings), so they apply before the folder is trusted. */
const CLAUDE_SETTINGS = ".godspeed/claude-settings.json";

/** The waiter, as CLAUDE.md tells Claude Code to run it (the allow rule matches this text). */
const WAITER = "node .godspeed/wait-for-work.mjs";

/** A folder the generated scripts and TOML can quote safely: absolute, no quotes, no line breaks. */
export function usableFolder(folder: string): boolean {
	return (folder.startsWith("/") || /^[A-Za-z]:\\/.test(folder)) && !/["'`$\r\n]/.test(folder);
}

function join(folder: string, platform: Platform, ...parts: string[]): string {
	const sep = platform === "win32" ? "\\" : "/";
	return [folder.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

/** "~/godspeed" for a folder inside the home folder; otherwise the full path. */
export function shortFolder(folder: string, home: string): string {
	if (folder === home) return "~";
	return folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder;
}

/** .mcp.json: Claude Code runs the folder's connector, which forwards to the app. */
export function mcpJson(folder: string, platform: Platform): string {
	const server = { command: "node", args: [join(folder, platform, ".godspeed", "connect.mjs")] };
	return `${JSON.stringify({ mcpServers: { godspeed: server } }, null, "\t")}\n`;
}

/** .godspeed/claude-settings.json: turns on the folder's server, lets the
 *  agent use godspeed's tools and the waiter without asking, and tells the
 *  app when the session loses its context. */
export function claudeSettings(folder: string, platform: Platform): string {
	const forget = [{ type: "command", command: "node", args: [join(folder, platform, ".godspeed", "forget.mjs")], timeout: 10 }];
	const settings = {
		enabledMcpjsonServers: ["godspeed"],
		permissions: { allow: ["mcp__godspeed__*", `Bash(${WAITER})`, `Bash(${WAITER} *)`] },
		hooks: {
			SessionStart: [{ matcher: "compact", hooks: forget }],
			SessionEnd: [{ matcher: "clear", hooks: forget }],
		},
	};
	return `${JSON.stringify(settings, null, "\t")}\n`;
}

/** Codex's arguments: godspeed's server through the folder's connector,
 *  its tools pre-approved, and a timeout longer than wait_for_work's 600 s.
 *  TOML literal strings ('…'), so no value needs escaping. */
function codexArgs(folder: string, platform: Platform): string[] {
	const server = "mcp_servers.godspeed";
	return [
		"-c", `${server}.command='node'`,
		"-c", `${server}.args=['${join(folder, platform, ".godspeed", "connect.mjs")}']`,
		"-c", `${server}.tool_timeout_sec=620`,
		"-c", `${server}.default_tools_approval_mode='approve'`,
		START_PROMPT,
	];
}

const CLAUDE_ARGS = ["--settings", CLAUDE_SETTINGS, START_PROMPT];

function posixQuote(arg: string): string {
	return /^[\w./=-]+$/.test(arg) ? arg : `"${arg.replace(/["\\$`]/g, "\\$&")}"`;
}

function cmdQuote(arg: string): string {
	return /^[\w./=-]+$/.test(arg) ? arg : `"${arg}"`;
}

function startScriptName(agent: FolderAgent, platform: Platform): string {
	return `start-${agent}.${platform === "win32" ? "cmd" : platform === "darwin" ? "command" : "sh"}`;
}

/** The start script's path, inside .godspeed/. */
export function startScriptPath(folder: string, agent: FolderAgent, platform: Platform): string {
	return join(folder, platform, ".godspeed", startScriptName(agent, platform));
}

/** The command the "Copy the command" link copies: go to the folder, start the agent. */
export function copyCommand(agent: FolderAgent, folder: string, home: string, platform: Platform): string {
	if (platform === "win32") {
		// cmd needs a quoting style of its own for Codex's flags, so it runs the start script.
		if (agent === "codex") return `"${startScriptPath(folder, agent, platform)}"`;
		return `cd /d "${folder}" && claude ${CLAUDE_ARGS.map(cmdQuote).join(" ")}`;
	}
	const short = shortFolder(folder, home);
	const cd = short.startsWith("~") && !/\s/.test(short) ? short : posixQuote(folder);
	const args = agent === "claude" ? CLAUDE_ARGS : codexArgs(folder, platform);
	return `cd ${cd} && ${agent} ${args.map(posixQuote).join(" ")}`;
}

const NOT_INSTALLED: Record<FolderAgent, string> = {
	claude: "Claude Code isn't installed. Get it at https://claude.com/claude-code, then click Open Claude Code in godspeed again.",
	codex: "Codex isn't installed. Get it at https://developers.openai.com/codex, then click Open Codex in godspeed again.",
};

/** The start script the button runs in a new terminal window. */
export function startScript(agent: FolderAgent, folder: string, platform: Platform): string {
	const args = agent === "claude" ? CLAUDE_ARGS : codexArgs(folder, platform);
	if (platform === "win32") {
		return [
			"@echo off",
			`cd /d "${folder}"`,
			`where ${agent} >nul 2>nul || (echo ${NOT_INSTALLED[agent]} & exit /b 1)`,
			`${agent} ${args.map(cmdQuote).join(" ")}`,
			"",
		].join("\r\n");
	}
	return [
		"#!/bin/sh",
		`cd ${posixQuote(folder)} || exit 1`,
		`command -v ${agent} >/dev/null 2>&1 || { echo ${posixQuote(NOT_INSTALLED[agent])}; exit 1; }`,
		`exec ${agent} ${args.map(posixQuote).join(" ")}`,
		"",
	].join("\n");
}

const TABLE = /^\s*\[/;
const GODSPEED_TABLE = /^\s*\[\s*mcp_servers\.("godspeed"|godspeed)\s*\]\s*$/;
const GODSPEED_SUBTABLE = /^\s*\[\[?\s*mcp_servers\.("godspeed"|godspeed)\./;

/** ~/.codex/config.toml without the [mcp_servers.godspeed] block godspeed
 *  used to have the learner paste (it pointed at the app's /api/mcp), or
 *  null when there is none. Codex now gets godspeed only in the folder.
 *  Its sub-tables (e.g. tool approvals) go too: left alone they'd still
 *  define a godspeed server, one with no url, and Codex refuses that. */
export function withoutOldCodexServer(toml: string): string | null {
	const lines = toml.split("\n");
	const start = lines.findIndex((l) => GODSPEED_TABLE.test(l));
	if (start < 0) return null;
	let end = start + 1;
	while (end < lines.length && !TABLE.test(lines[end]!)) end++;
	const block = lines.slice(start, end).join("\n");
	if (!/^\s*url\s*=\s*"[^"]*\/api\/mcp"/m.test(block)) return null;
	let dropping = false;
	const kept = lines.filter((l) => {
		if (TABLE.test(l)) dropping = GODSPEED_TABLE.test(l) || GODSPEED_SUBTABLE.test(l);
		return !dropping;
	});
	return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** A JSON file's text without the entry at `keys` (e.g. ["plugins",
 *  "godspeed@godspeed"]), or null when it has none or isn't JSON. */
export function withoutJsonEntry(text: string, keys: readonly [...string[], string]): string | null {
	let root: unknown;
	try {
		root = JSON.parse(text);
	} catch {
		return null;
	}
	let parent = root;
	for (const key of keys.slice(0, -1)) parent = isRecord(parent) ? parent[key] : undefined;
	const last = keys[keys.length - 1]!;
	if (!isRecord(parent) || !Object.hasOwn(parent, last)) return null;
	delete parent[last];
	return JSON.stringify(root, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
