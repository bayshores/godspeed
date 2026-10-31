/** The godspeed folder: its generated files and commands (core), writing
 *  it and moving people off the old setup (server), the terminal launcher
 *  (Electron) and the setup log (component model). */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-agent-folder-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const home = path.join(scratch, "home");
process.env.HOME = home;
process.env.LH_DATA_DIR = path.join(scratch, "data");
process.env.CLAUDE_CONFIG_DIR = path.join(scratch, "claude");
process.env.CODEX_HOME = path.join(scratch, "codex");

const core = await import("../src/core/agent-folder.ts");
const server = await import("../src/server/agent-folder.ts");
const model = await import("../src/components/agent-folder/agent-folder-model.ts");
const terminal = createRequire(import.meta.url)("../electron/open-terminal.cjs") as {
	startScript: (folder: unknown, agent: unknown, platform: string) => string | null;
	terminalCandidates: (script: string, platform: string) => [string, string[]][];
};

const OLD_CODEX = `model = "gpt-5"

[mcp_servers.godspeed]
url = "http://127.0.0.1:47613/api/mcp"
http_headers = { "Authorization" = "Bearer abc" }
tool_timeout_sec = 600

[mcp_servers.other]
command = "x"
`;

describe("the folder's files and commands", () => {
	it("pre-approves only godspeed's tools and the waiter, and turns on the folder's server", () => {
		const settings = JSON.parse(core.claudeSettings("/Users/me/godspeed", "darwin"));
		assert.deepEqual(settings.enabledMcpjsonServers, ["godspeed"]);
		assert.deepEqual(settings.permissions.allow, ["mcp__godspeed__*", "Bash(node .godspeed/wait-for-work.mjs)", "Bash(node .godspeed/wait-for-work.mjs *)"]);
		assert.deepEqual(settings.hooks.SessionStart[0].hooks[0].args, ["/Users/me/godspeed/.godspeed/forget.mjs"]);
		assert.equal(settings.hooks.SessionEnd[0].matcher, "clear");
		assert.equal(settings.permissions.defaultMode, undefined, "no auto mode");
	});

	it("points .mcp.json at the folder's connector", () => {
		assert.deepEqual(JSON.parse(core.mcpJson("C:\\Users\\me\\godspeed", "win32")).mcpServers.godspeed, {
			command: "node",
			args: ["C:\\Users\\me\\godspeed\\.godspeed\\connect.mjs"],
		});
	});

	it("copies a short command for Claude Code and Codex", () => {
		assert.equal(core.copyCommand("claude", "/Users/me/godspeed", "/Users/me", "darwin"), 'cd ~/godspeed && claude --settings .godspeed/claude-settings.json "Start teaching"');
		assert.equal(
			core.copyCommand("codex", "/Users/me/godspeed", "/Users/me", "linux"),
			"cd ~/godspeed && codex -c \"mcp_servers.godspeed.command='node'\" -c \"mcp_servers.godspeed.args=['/Users/me/godspeed/.godspeed/connect.mjs']\" -c mcp_servers.godspeed.tool_timeout_sec=620 -c \"mcp_servers.godspeed.default_tools_approval_mode='approve'\" \"Start teaching\"",
		);
		assert.equal(core.copyCommand("claude", "/Volumes/My Drive/gs", "/Users/me", "darwin"), 'cd "/Volumes/My Drive/gs" && claude --settings .godspeed/claude-settings.json "Start teaching"');
		assert.equal(core.copyCommand("claude", "C:\\Users\\me\\godspeed", "C:\\Users\\me", "win32"), 'cd /d "C:\\Users\\me\\godspeed" && claude --settings .godspeed/claude-settings.json "Start teaching"');
		assert.equal(core.copyCommand("codex", "C:\\Users\\me\\godspeed", "C:\\Users\\me", "win32"), '"C:\\Users\\me\\godspeed\\.godspeed\\start-codex.cmd"');
	});

	it("writes start scripts that check the agent is installed, and remove the old plugin only when asked", () => {
		const plain = core.startScript("claude", "/Users/me/godspeed", "darwin", false);
		assert.match(plain, /^#!\/bin\/sh\ncd \/Users\/me\/godspeed \|\| exit 1\ncommand -v claude /);
		assert.match(plain, /\nexec claude --settings \.godspeed\/claude-settings\.json "Start teaching"\n$/);
		assert.doesNotMatch(plain, /plugin uninstall/);
		assert.match(core.startScript("claude", "/Users/me/godspeed", "darwin", true), /claude plugin uninstall godspeed@godspeed[^\n]*\nclaude plugin marketplace remove godspeed/);
		assert.doesNotMatch(core.startScript("codex", "/Users/me/godspeed", "darwin", true), /plugin/, "only Claude Code had the plugin");
		const win = core.startScript("codex", "C:\\gs", "win32", false);
		assert.match(win, /^@echo off\r\ncd \/d "C:\\gs"\r\nwhere codex /);
		assert.match(win, /codex -c "mcp_servers\.godspeed\.command='node'"/);
	});

	it("refuses folders it can't quote", () => {
		assert.equal(core.usableFolder("/Users/me/godspeed"), true);
		assert.equal(core.usableFolder("C:\\Users\\me\\godspeed"), true);
		assert.equal(core.usableFolder("godspeed"), false);
		assert.equal(core.usableFolder("/Users/me/it's"), false);
		assert.equal(core.usableFolder("/Users/me/$x"), false);
	});

	it("removes only the old godspeed block from Codex's config", () => {
		assert.equal(core.withoutOldCodexServer(OLD_CODEX), 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n');
		assert.equal(core.withoutOldCodexServer('[mcp_servers.godspeed]\ncommand = "node"\n'), null, "not one godspeed wrote");
		assert.equal(core.withoutOldCodexServer('model = "gpt-5"\n'), null);
	});

	it("shortens a folder in the home folder", () => {
		assert.equal(core.shortFolder("/Users/me/godspeed", "/Users/me"), "~/godspeed");
		assert.equal(core.shortFolder("/Volumes/x", "/Users/me"), "/Volumes/x");
	});
});

describe("writing the folder", () => {
	beforeEach(() => {
		for (const dir of ["home", "data", "claude", "codex"]) fs.rmSync(path.join(scratch, dir), { recursive: true, force: true });
		fs.mkdirSync(home, { recursive: true });
	});

	it("writes the instructions, connection and start scripts into ~/godspeed", () => {
		const view = server.setUpAgentFolder();
		assert.equal(view.folder, path.join(home, "godspeed"));
		assert.equal(view.short, "~/godspeed");
		assert.equal(view.exists, true);
		for (const file of ["CLAUDE.md", "AGENTS.md", ".mcp.json", ".claude/skills/setup-classes/SKILL.md", ".godspeed/connect.mjs", ".godspeed/target.mjs", ".godspeed/wait-for-work.mjs", ".godspeed/forget.mjs", ".godspeed/package.json", ".godspeed/claude-settings.json"]) {
			assert.ok(fs.existsSync(path.join(view.folder, file)), file);
		}
		if (process.platform !== "win32") {
			const script = core.startScriptPath(view.folder, "claude", process.platform === "darwin" ? "darwin" : "linux");
			assert.equal(fs.statSync(script).mode & 0o111, 0o111, "the start script can run");
		}
		assert.match(fs.readFileSync(path.join(view.folder, ".claude/skills/setup-classes/SKILL.md"), "utf8"), /^---\nname: setup-classes\n/);
	});

	it("moves people off the old setup: notice first, then the plugin and the Codex block go", () => {
		fs.mkdirSync(path.join(scratch, "claude", "plugins"), { recursive: true });
		fs.writeFileSync(path.join(scratch, "claude", "plugins", "installed_plugins.json"), '{"plugins":{"godspeed@godspeed":[]}}');
		fs.mkdirSync(path.join(scratch, "codex"), { recursive: true });
		fs.writeFileSync(path.join(scratch, "codex", "config.toml"), OLD_CODEX);
		assert.equal(server.folderNoticeAgent(), "claude");
		const view = server.setUpAgentFolder();
		const platform = process.platform === "darwin" ? "darwin" : "linux";
		assert.match(fs.readFileSync(core.startScriptPath(view.folder, "claude", platform), "utf8"), /plugin uninstall godspeed@godspeed/);
		assert.doesNotMatch(fs.readFileSync(path.join(scratch, "codex", "config.toml"), "utf8"), /godspeed/);
		assert.equal(server.folderNoticeAgent(), null, "set up: no notice");
	});

	it("asks Codex users too, and Later hides the notice", () => {
		fs.mkdirSync(path.join(scratch, "codex"), { recursive: true });
		fs.writeFileSync(path.join(scratch, "codex", "config.toml"), OLD_CODEX);
		assert.equal(server.folderNoticeAgent(), "codex");
		server.dismissFolderNotice();
		assert.equal(server.folderNoticeAgent(), null);
	});

	it("never asks someone who never set up the old way", () => {
		assert.equal(server.folderNoticeAgent(), null);
	});

	it("uses another folder and remembers it", () => {
		const other = path.join(scratch, "home", "School", "godspeed");
		server.setUpAgentFolder(other);
		assert.equal(server.agentFolderView().folder, other);
		assert.throws(() => server.setUpAgentFolder("relative/path"), server.AgentFolderError);
	});
});

describe("opening a terminal", () => {
	it("only runs the folder's own start scripts", () => {
		const folder = server.setUpAgentFolder(path.join(scratch, "home", "launch")).folder;
		const platform = process.platform === "darwin" ? "darwin" : "linux";
		assert.equal(terminal.startScript(folder, "claude", platform), core.startScriptPath(folder, "claude", platform));
		assert.equal(terminal.startScript(folder, "rm -rf", platform), null);
		assert.equal(terminal.startScript("relative", "claude", platform), null);
		assert.equal(terminal.startScript(path.join(scratch, "nowhere"), "claude", platform), null);
	});

	it("opens Terminal on a Mac and a new console on Windows", () => {
		assert.deepEqual(terminal.terminalCandidates("/a/b.command", "darwin"), [["open", ["-a", "Terminal", "/a/b.command"]]]);
		assert.deepEqual(terminal.terminalCandidates("C:\\a b\\s.cmd", "win32"), [["cmd.exe", ["/c", "start", '""', "cmd.exe", "/k", '"C:\\a b\\s.cmd"']]]);
		assert.equal(terminal.terminalCandidates("/a/b.sh", "linux")[0]![0], "x-terminal-emulator");
	});
});

describe("the setup log", () => {
	const off = { connected: false, teaching: false };
	const texts = (lines: { text: string; state: string }[]) => lines.map((l) => `${l.state}: ${l.text}`);

	it("ticks each step, then follows the agent", () => {
		assert.deepEqual(texts(model.logLines({ agent: "claude", made: "wait" }, off, "~/godspeed", true)), ["wait: Making ~/godspeed…"]);
		assert.deepEqual(texts(model.logLines({ agent: "claude", made: "done", opened: "wait" }, off, "~/godspeed", true)), ["done: Made ~/godspeed", "wait: Opening Terminal…"]);
		assert.deepEqual(texts(model.logLines({ agent: "claude", made: "done", opened: "done" }, off, "~/godspeed", true)), [
			"done: Made ~/godspeed",
			"done: Opened Terminal in it",
			"wait: Waiting for Claude Code to start…",
			"note: If Claude Code asks whether to trust the folder, choose Yes.",
		]);
		assert.deepEqual(texts(model.logLines({ agent: "codex", made: "done", opened: "done" }, { connected: true, teaching: true }, "~/godspeed", false)), [
			"done: Made ~/godspeed",
			"done: Opened a terminal in it",
			"done: Started Codex",
			"done: Codex is teaching",
		]);
	});

	it("shows a failure in place of the step, and the manual way outside the app", () => {
		assert.deepEqual(texts(model.logLines({ agent: "claude", made: { error: "Couldn't write" } }, off, "~/godspeed", true)), ["error: Couldn't write"]);
		assert.deepEqual(texts(model.logLines({ agent: "claude", made: "done", opened: { error: "No terminal" } }, off, "~/godspeed", true)), ["done: Made ~/godspeed", "error: No terminal"]);
		assert.equal(model.logLines({ agent: "claude", made: "done", opened: "manual" }, off, "~/godspeed", true)[1]!.text, "Copy the command and run it in your terminal");
	});

	it("remembers Codex, and falls back to Claude Code", () => {
		assert.equal(model.rememberedAgent("codex"), "codex");
		assert.equal(model.rememberedAgent(null), "claude");
		assert.equal(model.rememberedAgent("other"), "claude");
	});
});
