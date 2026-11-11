//! Ported from src/shared/core/agent-folder.ts.
//!
//! The godspeed folder (default ~/godspeed): the one folder an outside agent is opened in. It
//! holds the agent's instructions (CLAUDE.md, AGENTS.md), the connection to the app (.mcp.json
//! for Claude Code, command-line flags for Codex) and, in .godspeed/, the scripts and the start
//! scripts the app's "Open Claude Code" button runs. Pure: the generated file contents and
//! commands.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_json::{json, stringify_pretty};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FolderAgent {
	Claude,
	Codex,
}

impl FolderAgent {
	fn name(self) -> &'static str {
		match self {
			FolderAgent::Claude => "claude",
			FolderAgent::Codex => "codex",
		}
	}
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Platform {
	Darwin,
	Win32,
	Linux,
}

/// The prompt each agent starts with; CLAUDE.md and AGENTS.md say what it means.
const START_PROMPT: &str = "Start teaching";

/// Settings Claude Code loads at launch (--settings), so they apply before the folder is trusted.
const CLAUDE_SETTINGS: &str = ".godspeed/claude-settings.json";

/// The waiter, as CLAUDE.md tells Claude Code to run it (the allow rule matches this text).
const WAITER: &str = "node .godspeed/wait-for-work.mjs";

const CLAUDE_ARGS: [&str; 3] = ["--settings", CLAUDE_SETTINGS, START_PROMPT];

/// A folder the generated scripts and TOML can quote safely: absolute, no quotes, no line breaks.
pub fn usable_folder(folder: &str) -> bool {
	static WINDOWS: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z]:\\", ""));
	static UNSAFE: LazyLock<Re> = LazyLock::new(|| Re::new(r#"["'`$\r\n]"#, ""));
	(folder.starts_with('/') || WINDOWS.test(folder)) && !UNSAFE.test(folder)
}

fn join(folder: &str, platform: Platform, parts: &[&str]) -> String {
	static TRAIL: LazyLock<Re> = LazyLock::new(|| Re::new(r"[\\/]+$", ""));
	let sep = if platform == Platform::Win32 { "\\" } else { "/" };
	let mut all = vec![TRAIL.replace(folder, "")];
	all.extend(parts.iter().map(|p| (*p).to_owned()));
	all.join(sep)
}

/// "~/godspeed" for a folder inside the home folder; otherwise the full path.
pub fn short_folder(folder: &str, home: &str) -> String {
	if folder == home {
		return "~".to_owned();
	}
	match folder.strip_prefix(home).filter(|rest| rest.starts_with('/')) {
		Some(rest) => format!("~{rest}"),
		None => folder.to_owned(),
	}
}

/// .mcp.json: Claude Code runs the folder's connector, which forwards to the app.
pub fn mcp_json(folder: &str, platform: Platform) -> String {
	let server = json!({ "command": "node", "args": [join(folder, platform, &[".godspeed", "connect.mjs"])] });
	format!("{}\n", stringify_pretty(&json!({ "mcpServers": { "godspeed": server } }), "\t"))
}

/// .godspeed/claude-settings.json: turns on the folder's server, lets the agent use godspeed's
/// tools and the waiter without asking, and tells the app when the session loses its context.
pub fn claude_settings(folder: &str, platform: Platform) -> String {
	let forget = json!([{ "type": "command", "command": "node", "args": [join(folder, platform, &[".godspeed", "forget.mjs"])], "timeout": 10 }]);
	let settings = json!({
		"enabledMcpjsonServers": ["godspeed"],
		"permissions": { "allow": ["mcp__godspeed__*", format!("Bash({WAITER})"), format!("Bash({WAITER} *)")] },
		"hooks": {
			"SessionStart": [{ "matcher": "compact", "hooks": forget.clone() }],
			"SessionEnd": [{ "matcher": "clear", "hooks": forget }],
		},
	});
	format!("{}\n", stringify_pretty(&settings, "\t"))
}

/// Codex's arguments: godspeed's server through the folder's connector, its tools pre-approved,
/// and a timeout longer than wait_for_work's 600 s. TOML literal strings ('...'), so no value
/// needs escaping.
fn codex_args(folder: &str, platform: Platform) -> Vec<String> {
	let server = "mcp_servers.godspeed";
	let connector = join(folder, platform, &[".godspeed", "connect.mjs"]);
	vec![
		"-c".to_owned(),
		format!("{server}.command='node'"),
		"-c".to_owned(),
		format!("{server}.args=['{connector}']"),
		"-c".to_owned(),
		format!("{server}.tool_timeout_sec=620"),
		"-c".to_owned(),
		format!("{server}.default_tools_approval_mode='approve'"),
		START_PROMPT.to_owned(),
	]
}

fn plain_arg(arg: &str) -> bool {
	static PLAIN: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[\w./=-]+$", ""));
	PLAIN.test(arg)
}

fn posix_quote(arg: &str) -> String {
	static SPECIAL: LazyLock<Re> = LazyLock::new(|| Re::new(r#"["\\$`]"#, "g"));
	if plain_arg(arg) { arg.to_owned() } else { format!("\"{}\"", SPECIAL.replace(arg, "\\$&")) }
}

fn cmd_quote(arg: &str) -> String {
	if plain_arg(arg) { arg.to_owned() } else { format!("\"{arg}\"") }
}

fn claude_args() -> Vec<String> {
	CLAUDE_ARGS.iter().map(|a| (*a).to_owned()).collect()
}

fn start_script_name(agent: FolderAgent, platform: Platform) -> String {
	let ext = match platform {
		Platform::Win32 => "cmd",
		Platform::Darwin => "command",
		Platform::Linux => "sh",
	};
	format!("start-{}.{ext}", agent.name())
}

/// The start script's path, inside .godspeed/.
pub fn start_script_path(folder: &str, agent: FolderAgent, platform: Platform) -> String {
	join(folder, platform, &[".godspeed", &start_script_name(agent, platform)])
}

/// The command the "Copy the command" link copies: go to the folder, start the agent.
pub fn copy_command(agent: FolderAgent, folder: &str, home: &str, platform: Platform) -> String {
	if platform == Platform::Win32 {
		// cmd needs a quoting style of its own for Codex's flags, so it runs the start script.
		if agent == FolderAgent::Codex {
			return format!("\"{}\"", start_script_path(folder, agent, platform));
		}
		let args: Vec<String> = claude_args().iter().map(|a| cmd_quote(a)).collect();
		return format!("cd /d \"{folder}\" && claude {}", args.join(" "));
	}
	static HOME_RELATIVE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^~[\w./-]*$", ""));
	let short = short_folder(folder, home);
	let cd = if HOME_RELATIVE.test(&short) { short } else { posix_quote(folder) };
	let args = if agent == FolderAgent::Claude { claude_args() } else { codex_args(folder, platform) };
	let args: Vec<String> = args.iter().map(|a| posix_quote(a)).collect();
	format!("cd {cd} && {} {}", agent.name(), args.join(" "))
}

fn not_installed(agent: FolderAgent) -> &'static str {
	match agent {
		FolderAgent::Claude => "Claude Code isn't installed. Get it at https://claude.com/claude-code, then click Open Claude Code in godspeed again.",
		FolderAgent::Codex => "Codex isn't installed. Get it at https://developers.openai.com/codex, then click Open Codex in godspeed again.",
	}
}

// The folder's connector and hooks run with plain `node`.
fn needs_node(agent: FolderAgent) -> &'static str {
	match agent {
		FolderAgent::Claude => "godspeed needs Node.js. Install it from https://nodejs.org, then click Open Claude Code in godspeed again.",
		FolderAgent::Codex => "godspeed needs Node.js. Install it from https://nodejs.org, then click Open Codex in godspeed again.",
	}
}

/// The start script the button runs in a new terminal window.
pub fn start_script(agent: FolderAgent, folder: &str, platform: Platform) -> String {
	let args = if agent == FolderAgent::Claude { claude_args() } else { codex_args(folder, platform) };
	let name = agent.name();
	if platform == Platform::Win32 {
		let args: Vec<String> = args.iter().map(|a| cmd_quote(a)).collect();
		return [
			"@echo off".to_owned(),
			format!("cd /d \"{folder}\""),
			format!("where {name} >nul 2>nul || (echo {} & exit /b 1)", not_installed(agent)),
			format!("where node >nul 2>nul || (echo {} & exit /b 1)", needs_node(agent)),
			format!("{name} {}", args.join(" ")),
			String::new(),
		]
		.join("\r\n");
	}
	let args: Vec<String> = args.iter().map(|a| posix_quote(a)).collect();
	[
		"#!/bin/sh".to_owned(),
		format!("cd {} || exit 1", posix_quote(folder)),
		format!("command -v {name} >/dev/null 2>&1 || {{ echo {}; exit 1; }}", posix_quote(not_installed(agent))),
		format!("command -v node >/dev/null 2>&1 || {{ echo {}; exit 1; }}", posix_quote(needs_node(agent))),
		format!("exec {name} {}", args.join(" ")),
		String::new(),
	]
	.join("\n")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn folders_must_be_safe_to_quote() {
		assert!(usable_folder("/Users/a/godspeed") && usable_folder("C:\\Users\\a"));
		assert!(!usable_folder("relative") && !usable_folder("/a/b'c") && !usable_folder("/a\nb"));
	}

	#[test]
	fn short_folders() {
		assert_eq!(short_folder("/h/godspeed", "/h"), "~/godspeed");
		assert_eq!(short_folder("/h", "/h"), "~");
		assert_eq!(short_folder("/hh/x", "/h"), "/hh/x");
	}

	#[test]
	fn files_and_commands() {
		assert_eq!(mcp_json("/h/godspeed/", Platform::Darwin), "{\n\t\"mcpServers\": {\n\t\t\"godspeed\": {\n\t\t\t\"command\": \"node\",\n\t\t\t\"args\": [\n\t\t\t\t\"/h/godspeed/.godspeed/connect.mjs\"\n\t\t\t]\n\t\t}\n\t}\n}\n");
		assert_eq!(copy_command(FolderAgent::Claude, "/h/godspeed", "/h", Platform::Darwin), "cd ~/godspeed && claude --settings .godspeed/claude-settings.json \"Start teaching\"");
		assert!(start_script(FolderAgent::Codex, "/h/my godspeed", Platform::Linux).contains("cd \"/h/my godspeed\" || exit 1\n"));
		assert_eq!(start_script_path("C:\\g", FolderAgent::Codex, Platform::Win32), "C:\\g\\.godspeed\\start-codex.cmd");
	}
}
