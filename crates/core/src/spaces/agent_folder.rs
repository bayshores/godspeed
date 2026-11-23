//! The godspeed folder (default ~/godspeed): the one folder an outside agent is opened in. It
//! holds the agent's instructions (CLAUDE.md, AGENTS.md), the connection to the app (.mcp.json
//! for Claude Code, command-line flags for Codex) and, in .godspeed/, the scripts and the start
//! scripts the app runs in its terminal. Pure: the generated file contents and commands.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text::len16;
use gs_json::{Json, Obj, json, stringify_pretty};

use crate::session::teacher_steps::{CLAUDE_OWN_TOOLS, CODEX_OWN_TOOLS};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FolderAgent {
	Claude,
	Codex,
}

impl FolderAgent {
	pub fn name(self) -> &'static str {
		match self {
			FolderAgent::Claude => "claude",
			FolderAgent::Codex => "codex",
		}
	}
}

/// What a start script starts: an agent as the teacher, or as the helper, which does the
/// background jobs beside it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum StartTarget {
	Claude,
	ClaudeHelper,
	Codex,
	CodexHelper,
}

impl StartTarget {
	fn name(self) -> &'static str {
		match self {
			StartTarget::Claude => "claude",
			StartTarget::ClaudeHelper => "claude-helper",
			StartTarget::Codex => "codex",
			StartTarget::CodexHelper => "codex-helper",
		}
	}

	fn agent(self) -> FolderAgent {
		if matches!(self, StartTarget::Codex | StartTarget::CodexHelper) { FolderAgent::Codex } else { FolderAgent::Claude }
	}
}

/// The learner's own command for an agent, run in place of `claude` or `codex`: a launcher such
/// as "standardcompute launch claude --".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StartCommands {
	pub claude: Option<String>,
	pub codex: Option<String>,
}

impl StartCommands {
	pub fn get(&self, agent: FolderAgent) -> Option<&str> {
		match agent {
			FolderAgent::Claude => self.claude.as_deref(),
			FolderAgent::Codex => self.codex.as_deref(),
		}
	}

	pub fn is_empty(&self) -> bool {
		self.claude.is_none() && self.codex.is_none()
	}

	/// As `savedStartCommands` returns it: claude first.
	pub fn to_json(&self) -> Json {
		let mut out = Obj::new();
		for agent in [FolderAgent::Claude, FolderAgent::Codex] {
			if let Some(command) = self.get(agent) {
				out.insert(agent.name(), command);
			}
		}
		Json::Obj(out)
	}
}

const START_COMMAND_MAX_CHARS: usize = 300;

/// A start command the scripts can hold: one line, not too long.
pub fn usable_start_command(command: &str) -> bool {
	len16(command) <= START_COMMAND_MAX_CHARS && !command.contains(['\r', '\n'])
}

/// The start commands in a saved value: the usable ones that aren't empty.
pub fn saved_start_commands(raw: &Json) -> StartCommands {
	let saved = |agent: FolderAgent| raw.as_obj().and_then(|o| o.get(agent.name())).and_then(Json::as_str).filter(|c| !c.is_empty() && usable_start_command(c)).map(str::to_owned);
	StartCommands { claude: saved(FolderAgent::Claude), codex: saved(FolderAgent::Codex) }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Platform {
	Darwin,
	Win32,
	Linux,
}

/// The prompt each agent starts with; CLAUDE.md and AGENTS.md say what it means. The teacher in
/// godspeed's terminal starts with none: godspeed asks it when work waits for it.
const START_PROMPT: &str = "Start teaching";
const HELPER_PROMPT: &str = "Start as the helper";

/// Settings Claude Code loads at launch (--settings), so they apply before the folder is trusted.
const CLAUDE_SETTINGS: &str = ".godspeed/claude-settings.json";

/// Claude Code's arguments for every start, teacher and helper: the folder's settings and server
/// and none of the learner's own servers, skills or subagents, which every request would carry;
/// the chat compacts at 150,000 tokens. The Skill tool is refused, not every slash command, so
/// /compact, /clear, /model and /resume still work in the terminal. The flags that take several
/// values (--mcp-config, --disallowedTools) come before a one-value flag, so a prompt after them
/// stays the prompt.
const CLAUDE_ARGS: [&str; 10] = ["--settings", CLAUDE_SETTINGS, "--strict-mcp-config", "--mcp-config", ".mcp.json", "--disallowedTools", "Agent", "Skill", "--autocompact", "150000"];

/// Set by the helper's Claude Code start script: its waiter waits as the helper's.
const HELPER_ENV: &str = "GODSPEED_HELPER";

/// The oldest Claude Code with every flag above and the Stop hook's asyncRewake.
const CLAUDE_MIN_VERSION: &str = "2.1.330";

fn claude_args(prompt: Option<&str>) -> Vec<String> {
	CLAUDE_ARGS.iter().copied().chain(prompt).map(str::to_owned).collect()
}

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

/// .mcp.json: Claude Code runs the folder's connector, which forwards to the app. `env` hands it
/// the terminal's id and the app's data folder; `:-` makes both empty for an agent started
/// outside godspeed, where Claude Code would otherwise pass the `${…}` text itself.
pub fn mcp_json(folder: &str, platform: Platform) -> String {
	let env = json!({ "GODSPEED_TERMINAL": "${GODSPEED_TERMINAL:-}", "GODSPEED_DATA_DIR": "${GODSPEED_DATA_DIR:-}" });
	let server = json!({ "command": "node", "args": [join(folder, platform, &[".godspeed", "connect.mjs"])], "env": env });
	format!("{}\n", stringify_pretty(&json!({ "mcpServers": { "godspeed": server } }), "\t"))
}

/// The waiter's hook timeout in seconds: two hours of waiting (the waiter's own limit) and a
/// minute to spare.
const WAITER_TIMEOUT_S: u32 = 7260;

/// .godspeed/claude-settings.json: turns on the folder's server, lets the agent use godspeed's
/// tools and web search (what an interview is like is looked up online) without asking, tells
/// the app when the session starts compacting and when it lost its context, hands each line the
/// learner types to the app first (typed.mjs), and says which chat runs, when the agent stopped,
/// when it asks the learner something and which of its own tools it uses (agent-event.mjs: the
/// chats to go back to, the window's sound, Follow's slip; the tool hook runs in the background,
/// so it never slows a tool). After each turn the waiter waits for work in the background and
/// wakes the agent with it (asyncRewake). The Artifact tool, claude.ai connectors and the skills and plugins synced from
/// claude.ai stay off, and `GODSPEED_WAKES` tells the connector this session is woken that way.
/// Fetching a page still asks: text hidden in a space file could send the learner's data out.
pub fn claude_settings(folder: &str, platform: Platform) -> String {
	let script = |name: &str| join(folder, platform, &[".godspeed", name]);
	let hook = |name: &str| json!([{ "type": "command", "command": "node", "args": [script(name)], "timeout": 10 }]);
	let forget = hook("forget.mjs");
	let event = hook("agent-event.mjs");
	let waiter = json!({ "type": "command", "command": "node", "args": [script("wait-for-work.mjs")], "asyncRewake": true, "timeout": WAITER_TIMEOUT_S });
	let own_tool = json!({ "type": "command", "command": "node", "args": [script("agent-event.mjs")], "async": true });
	let settings = json!({
		"enabledMcpjsonServers": ["godspeed"],
		"enableArtifact": false,
		"disableClaudeAiConnectors": true,
		"syncClaudeAiSkills": false,
		"syncClaudeAiPlugins": false,
		"env": { "GODSPEED_WAKES": "1" },
		"permissions": { "allow": ["mcp__godspeed__*", "WebSearch"] },
		"hooks": {
			"PreCompact": [{ "hooks": hook("compacting.mjs") }],
			"UserPromptSubmit": [{ "hooks": hook("typed.mjs") }],
			"SessionStart": [{ "matcher": "compact", "hooks": forget.clone() }, { "hooks": event.clone() }],
			"SessionEnd": [{ "matcher": "clear", "hooks": forget }],
			"Stop": [{ "hooks": [event[0].clone(), waiter] }],
			"Notification": [{ "matcher": "permission_prompt|elicitation_dialog", "hooks": event }],
			"PreToolUse": [{ "matcher": CLAUDE_OWN_TOOLS.join("|"), "hooks": [own_tool] }],
		},
	});
	format!("{}\n", stringify_pretty(&settings, "\t"))
}

/// Codex's arguments: godspeed's server through the folder's connector, its tools pre-approved,
/// a timeout longer than wait_for_work's 600 s, the app terminal's id and data folder passed
/// on to the connector (Codex gives a server only the variables it names), the prompt hook
/// that hands each line the learner types to the app first, and the hooks that say when the agent
/// stopped, asks for a permission or runs a command or a patch, the last in the background (a hook
/// given here needs no review).
/// TOML literal strings ('...'), so no value needs escaping: the folder has no quotes in it.
fn codex_args(folder: &str, platform: Platform, prompt: Option<&str>) -> Vec<String> {
	let server = "mcp_servers.godspeed";
	let connector = join(folder, platform, &[".godspeed", "connect.mjs"]);
	let command = |script: &str| format!("command='node \"{}\"'", join(folder, platform, &[".godspeed", script]));
	let hook = |event: &str, script: &str| format!("hooks.{event}=[{{hooks=[{{type='command',{},timeout=10}}]}}]", command(script));
	vec![
		"-c".to_owned(),
		format!("{server}.command='node'"),
		"-c".to_owned(),
		format!("{server}.args=['{connector}']"),
		"-c".to_owned(),
		format!("{server}.tool_timeout_sec=620"),
		"-c".to_owned(),
		format!("{server}.default_tools_approval_mode='approve'"),
		"-c".to_owned(),
		format!("{server}.env_vars=['GODSPEED_TERMINAL','GODSPEED_DATA_DIR']"),
		"-c".to_owned(),
		hook("UserPromptSubmit", "typed.mjs"),
		"-c".to_owned(),
		hook("SessionStart", "agent-event.mjs"),
		"-c".to_owned(),
		hook("Stop", "agent-event.mjs"),
		"-c".to_owned(),
		hook("PermissionRequest", "agent-event.mjs"),
		"-c".to_owned(),
		format!("hooks.PreToolUse=[{{matcher='{}',hooks=[{{type='command',{},async=true}}]}}]", CODEX_OWN_TOOLS.join("|"), command("agent-event.mjs")),
	]
	.into_iter()
	.chain(prompt.map(str::to_owned))
	.collect()
}

fn plain_arg(arg: &str) -> bool {
	static PLAIN: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[\w./=-]+$", ""));
	PLAIN.test(arg)
}

fn posix_quote(arg: &str) -> String {
	static SPECIAL: LazyLock<Re> = LazyLock::new(|| Re::new(r#"["\\$`]"#, "g"));
	if plain_arg(arg) { arg.to_owned() } else { format!("\"{}\"", SPECIAL.replace(arg, "\\$&")) }
}

/// A quote inside reaches the program as `\"`, as Windows programs split their arguments.
fn cmd_quote(arg: &str) -> String {
	if plain_arg(arg) { arg.to_owned() } else { format!("\"{}\"", arg.replace('"', "\\\"")) }
}

fn helper_args(agent: FolderAgent, folder: &str, platform: Platform) -> Vec<String> {
	match agent {
		FolderAgent::Codex => codex_args(folder, platform, Some(HELPER_PROMPT)),
		FolderAgent::Claude => claude_args(Some(HELPER_PROMPT)),
	}
}

/// The teacher's three starts, quoted for the script: back to the chat in `resume` (a variable
/// the shell checked is a session id), a new chat in godspeed's terminal (no prompt), and outside
/// it (the copied command on Windows runs the script), where "Start teaching" starts it.
struct TeacherStarts {
	resume: Vec<String>,
	fresh: Vec<String>,
	outside: Vec<String>,
}

fn teacher_starts(agent: FolderAgent, folder: &str, platform: Platform, quote: fn(&str) -> String, resume: &str) -> TeacherStarts {
	let quoted = |args: Vec<String>| args.iter().map(|a| quote(a)).collect::<Vec<_>>();
	let base = match agent {
		FolderAgent::Codex => codex_args(folder, platform, None),
		FolderAgent::Claude => claude_args(None),
	};
	let fresh = quoted(base.clone());
	let mut outside = fresh.clone();
	outside.push(quote(START_PROMPT));
	let resume = match agent {
		FolderAgent::Codex => ["resume".to_owned()].into_iter().chain(fresh.iter().cloned()).chain([resume.to_owned()]).collect(),
		FolderAgent::Claude => fresh.iter().cloned().chain(["--resume".to_owned(), resume.to_owned()]).collect(),
	};
	TeacherStarts { resume, fresh, outside }
}

fn start_script_name(target: StartTarget, platform: Platform) -> String {
	let ext = match platform {
		Platform::Win32 => "cmd",
		Platform::Darwin => "command",
		Platform::Linux => "sh",
	};
	format!("start-{}.{ext}", target.name())
}

/// The start script's path, inside .godspeed/.
pub fn start_script_path(folder: &str, target: StartTarget, platform: Platform) -> String {
	join(folder, platform, &[".godspeed", &start_script_name(target, platform)])
}

/// The command the "Copy the command" link copies: go to the folder, start the agent.
pub fn copy_command(agent: FolderAgent, folder: &str, home: &str, platform: Platform, commands: &StartCommands) -> String {
	let start = commands.get(agent).unwrap_or(agent.name());
	if platform == Platform::Win32 {
		// cmd needs a quoting style of its own for Codex's flags, so it runs the start script.
		if agent == FolderAgent::Codex {
			return format!("\"{}\"", start_script_path(folder, StartTarget::Codex, platform));
		}
		let args: Vec<String> = claude_args(Some(START_PROMPT)).iter().map(|a| cmd_quote(a)).collect();
		return format!("cd /d \"{folder}\" && {start} {}", args.join(" "));
	}
	static HOME_RELATIVE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^~[\w./-]*$", ""));
	let short = short_folder(folder, home);
	let cd = if HOME_RELATIVE.test(&short) { short } else { posix_quote(folder) };
	let args = if agent == FolderAgent::Claude { claude_args(Some(START_PROMPT)) } else { codex_args(folder, platform, Some(START_PROMPT)) };
	let args: Vec<String> = args.iter().map(|a| posix_quote(a)).collect();
	format!("cd {cd} && {start} {}", args.join(" "))
}

fn not_installed(agent: FolderAgent) -> &'static str {
	match agent {
		FolderAgent::Claude => "Claude Code isn't installed. Get it at https://claude.com/claude-code, then click Start again in godspeed.",
		FolderAgent::Codex => "Codex isn't installed. Get it at https://developers.openai.com/codex, then click Start again in godspeed.",
	}
}

// The folder's connector and hooks run with plain `node`.
const NEEDS_NODE: &str = "godspeed needs Node.js. Install it from https://nodejs.org, then click Start again in godspeed.";

/// How a start script ends when what it starts isn't there or is too old; the app's terminal
/// reads these.
const EXIT_NOT_INSTALLED: u8 = 3;
const EXIT_NO_NODE: u8 = 4;
const EXIT_OLD_AGENT: u8 = 6;

fn too_old() -> String {
	format!("godspeed needs Claude Code {CLAUDE_MIN_VERSION} or newer. Update it (run: claude update), then click Start again in godspeed.")
}

/// The version check: Claude Code's own `--version`, read by the folder's script. The learner's own
/// command isn't asked, since a launcher may not pass the flag on.
fn version_check(agent: FolderAgent, own: Option<&str>) -> bool {
	agent == FolderAgent::Claude && own.is_none()
}

/// What a start script checks is installed (the program, and what it says when it isn't). The
/// learner's own command is checked by its first word when that is a plain program name; anything
/// else (a quoted path, a variable) isn't checked.
fn install_check(agent: FolderAgent, own: Option<&str>) -> Option<(String, String)> {
	static SPACE: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s", ""));
	static PROGRAM: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[\w./-]+$", ""));
	let Some(own) = own else { return Some((agent.name().to_owned(), not_installed(agent).to_owned())) };
	let program = SPACE.split(own).into_iter().next().flatten().unwrap_or_default();
	if !PROGRAM.test(&program) {
		return None;
	}
	let missing = format!("godspeed couldn't find {program}. Check the command under Change command in godspeed.");
	Some((program, missing))
}

/// The start script the app runs in its terminal. The teacher's goes back to the chat in
/// `GODSPEED_RESUME` when the window picked one.
pub fn start_script(target: StartTarget, folder: &str, platform: Platform, commands: &StartCommands) -> String {
	let agent = target.agent();
	let own = commands.get(agent);
	let check = install_check(agent, own);
	let helper = matches!(target, StartTarget::ClaudeHelper | StartTarget::CodexHelper);
	let name = agent.name();
	if platform == Platform::Win32 {
		let mut lines = vec!["@echo off".to_owned(), format!("cd /d \"{folder}\"")];
		lines.extend(check.map(|(program, missing)| format!("where {program} >nul 2>nul || (echo {missing} & exit /b {EXIT_NOT_INSTALLED})")));
		lines.push(format!("where node >nul 2>nul || (echo {NEEDS_NODE} & exit /b {EXIT_NO_NODE})"));
		if version_check(agent, own) {
			// A bracket would end cmd's block early.
			let echo = too_old().replace('(', "^(").replace(')', "^)");
			lines.push(format!("claude --version 2>nul | node .godspeed\\new-enough.mjs {CLAUDE_MIN_VERSION} || (echo {echo} & exit /b {EXIT_OLD_AGENT})"));
		}
		let start = own.unwrap_or(name);
		if target == StartTarget::ClaudeHelper {
			lines.push(format!("set {HELPER_ENV}=1"));
		}
		if helper {
			let args: Vec<String> = helper_args(agent, folder, platform).iter().map(|a| cmd_quote(a)).collect();
			lines.push(format!("{start} {}", args.join(" ")));
		} else {
			let starts = teacher_starts(agent, folder, platform, cmd_quote, "%GODSPEED_RESUME%");
			lines.push(format!("if defined GODSPEED_RESUME ({start} {} & exit /b)", starts.resume.join(" ")));
			lines.push(format!("if defined GODSPEED_TERMINAL ({start} {} & exit /b)", starts.fresh.join(" ")));
			lines.push(format!("{start} {}", starts.outside.join(" ")));
		}
		lines.push(String::new());
		return lines.join("\r\n");
	}
	let mut lines = vec!["#!/bin/sh".to_owned(), format!("cd {} || exit 1", posix_quote(folder))];
	lines.extend(check.map(|(program, missing)| format!("command -v {program} >/dev/null 2>&1 || {{ echo {}; exit {EXIT_NOT_INSTALLED}; }}", posix_quote(&missing))));
	lines.push(format!("command -v node >/dev/null 2>&1 || {{ echo {}; exit {EXIT_NO_NODE}; }}", posix_quote(NEEDS_NODE)));
	if version_check(agent, own) {
		lines.push(format!("claude --version 2>/dev/null | node .godspeed/new-enough.mjs {CLAUDE_MIN_VERSION} || {{ echo {}; exit {EXIT_OLD_AGENT}; }}", posix_quote(&too_old())));
	}
	// The learner's own command may start with a variable (A=b claude), which exec can't run.
	let start = own.map_or_else(|| format!("exec {name}"), str::to_owned);
	let then = |args: &[String]| if own.is_some() { format!("{start} {}; exit $?", args.join(" ")) } else { format!("{start} {}", args.join(" ")) };
	if target == StartTarget::ClaudeHelper {
		lines.push(format!("export {HELPER_ENV}=1"));
	}
	if helper {
		let args: Vec<String> = helper_args(agent, folder, platform).iter().map(|a| posix_quote(a)).collect();
		lines.push(format!("{start} {}", args.join(" ")));
	} else {
		let starts = teacher_starts(agent, folder, platform, posix_quote, "\"$GODSPEED_RESUME\"");
		lines.push(format!("if [ -n \"$GODSPEED_RESUME\" ]; then {}; fi", then(&starts.resume)));
		lines.push(format!("if [ -n \"$GODSPEED_TERMINAL\" ]; then {}; fi", then(&starts.fresh)));
		lines.push(format!("{start} {}", starts.outside.join(" ")));
	}
	lines.push(String::new());
	lines.join("\n")
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

	fn none() -> StartCommands {
		StartCommands::default()
	}

	fn own_claude() -> StartCommands {
		StartCommands { claude: Some("standardcompute launch claude --".to_owned()), codex: None }
	}

	#[test]
	fn an_agent_started_outside_godspeed_reads_both_variables_as_empty() {
		// What Claude Code does with `${NAME:-default}` when NAME is not set.
		let outside = mcp_json("/h/godspeed", Platform::Darwin).replace("${GODSPEED_TERMINAL:-}", "").replace("${GODSPEED_DATA_DIR:-}", "");
		let parsed = gs_json::parse(&outside).unwrap();
		let env = &parsed["mcpServers"]["godspeed"]["env"];
		assert_eq!((env["GODSPEED_TERMINAL"].as_str(), env["GODSPEED_DATA_DIR"].as_str()), (Some(""), Some("")), "empty sends no terminal header and keeps the usual data folder");
	}

	#[test]
	fn files_and_commands() {
		assert_eq!(mcp_json("/h/godspeed/", Platform::Darwin), "{\n\t\"mcpServers\": {\n\t\t\"godspeed\": {\n\t\t\t\"command\": \"node\",\n\t\t\t\"args\": [\n\t\t\t\t\"/h/godspeed/.godspeed/connect.mjs\"\n\t\t\t],\n\t\t\t\"env\": {\n\t\t\t\t\"GODSPEED_TERMINAL\": \"${GODSPEED_TERMINAL:-}\",\n\t\t\t\t\"GODSPEED_DATA_DIR\": \"${GODSPEED_DATA_DIR:-}\"\n\t\t\t}\n\t\t}\n\t}\n}\n");
		assert_eq!(copy_command(FolderAgent::Claude, "/h/godspeed", "/h", Platform::Darwin, &none()), "cd ~/godspeed && claude --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 \"Start teaching\"");
		assert!(start_script(StartTarget::Codex, "/h/my godspeed", Platform::Linux, &none()).contains("cd \"/h/my godspeed\" || exit 1\n"));
		assert_eq!(start_script_path("C:\\g", StartTarget::Codex, Platform::Win32), "C:\\g\\.godspeed\\start-codex.cmd");
		assert_eq!(start_script_path("/g", StartTarget::ClaudeHelper, Platform::Darwin), "/g/.godspeed/start-claude-helper.command");
	}

	#[test]
	fn a_missing_agent_ends_the_script_with_3_and_missing_node_with_4() {
		let mac = start_script(StartTarget::Claude, "/Users/me/godspeed", Platform::Darwin, &none());
		assert!(mac.contains("\ncommand -v claude >/dev/null 2>&1 || { echo \"Claude Code isn't installed. Get it at https://claude.com/claude-code, then click Start again in godspeed.\"; exit 3; }\n"), "{mac}");
		assert!(mac.contains("\ncommand -v node >/dev/null 2>&1 || { echo \"godspeed needs Node.js. Install it from https://nodejs.org, then click Start again in godspeed.\"; exit 4; }\n"), "{mac}");
		let win = start_script(StartTarget::Codex, "C:\\gs", Platform::Win32, &none());
		assert!(win.contains("\r\nwhere codex >nul 2>nul || (echo Codex isn't installed. Get it at https://developers.openai.com/codex, then click Start again in godspeed. & exit /b 3)\r\n"), "{win}");
		assert!(win.contains(" & exit /b 4)\r\n"), "{win}");
	}

	#[test]
	fn settings_allow_web_search_and_hook_every_compaction() {
		let settings = gs_json::parse(&claude_settings("/Users/me/godspeed", Platform::Darwin)).unwrap();
		assert_eq!(gs_json::stringify(&settings["permissions"]["allow"]), r#"["mcp__godspeed__*","WebSearch"]"#);
		assert_eq!(gs_json::stringify(&settings["hooks"]["PreCompact"]), r#"[{"hooks":[{"type":"command","command":"node","args":["/Users/me/godspeed/.godspeed/compacting.mjs"],"timeout":10}]}]"#);
		assert_eq!(gs_json::stringify(&settings["hooks"]["UserPromptSubmit"]), r#"[{"hooks":[{"type":"command","command":"node","args":["/Users/me/godspeed/.godspeed/typed.mjs"],"timeout":10}]}]"#);
		assert_eq!(gs_json::stringify(&settings["hooks"]["Notification"]), r#"[{"matcher":"permission_prompt|elicitation_dialog","hooks":[{"type":"command","command":"node","args":["/Users/me/godspeed/.godspeed/agent-event.mjs"],"timeout":10}]}]"#);
		assert_eq!(settings["hooks"].as_obj().unwrap().keys().cloned().collect::<Vec<_>>(), ["PreCompact", "UserPromptSubmit", "SessionStart", "SessionEnd", "Stop", "Notification", "PreToolUse"]);
	}

	#[test]
	fn the_agent_s_own_tools_are_told_in_the_background_by_the_names_that_have_words() {
		let settings = gs_json::parse(&claude_settings("/Users/me/godspeed", Platform::Darwin)).unwrap();
		assert_eq!(
			gs_json::stringify(&settings["hooks"]["PreToolUse"]),
			r#"[{"matcher":"WebSearch|WebFetch|Read|Grep|Glob|Bash|Edit|Write|NotebookEdit","hooks":[{"type":"command","command":"node","args":["/Users/me/godspeed/.godspeed/agent-event.mjs"],"async":true}]}]"#
		);
		let codex = start_script(StartTarget::Codex, "/Users/me/godspeed", Platform::Linux, &none());
		assert!(codex.contains(r#" -c "hooks.PreToolUse=[{matcher='Bash|apply_patch',hooks=[{type='command',command='node \"/Users/me/godspeed/.godspeed/agent-event.mjs\"',async=true}]}]""#), "{codex}");
		let matched = |matcher: &Json| matcher.str_or_empty().split('|').map(str::to_owned).collect::<Vec<_>>();
		assert_eq!(matched(&settings["hooks"]["PreToolUse"][0]["matcher"]), CLAUDE_OWN_TOOLS);
		for tool in CLAUDE_OWN_TOOLS.iter().chain(&CODEX_OWN_TOOLS) {
			assert!(crate::session::teacher_steps::own_tool_step(tool, None).is_some(), "{tool} has no words");
		}
	}

	#[test]
	fn the_waiter_wakes_the_agent_after_each_turn_and_the_learners_extras_stay_off() {
		let settings = gs_json::parse(&claude_settings("/Users/me/godspeed", Platform::Darwin)).unwrap();
		assert_eq!(
			gs_json::stringify(&settings["hooks"]["Stop"]),
			r#"[{"hooks":[{"type":"command","command":"node","args":["/Users/me/godspeed/.godspeed/agent-event.mjs"],"timeout":10},{"type":"command","command":"node","args":["/Users/me/godspeed/.godspeed/wait-for-work.mjs"],"asyncRewake":true,"timeout":7260}]}]"#
		);
		for (key, off) in [("enableArtifact", false), ("disableClaudeAiConnectors", true), ("syncClaudeAiSkills", false), ("syncClaudeAiPlugins", false)] {
			assert_eq!(settings[key].as_bool(), Some(off), "{key}");
		}
		assert_eq!(settings["env"]["GODSPEED_WAKES"].as_str(), Some("1"));
	}

	#[test]
	fn an_old_claude_code_ends_the_script_with_6() {
		let mac = start_script(StartTarget::ClaudeHelper, "/Users/me/godspeed", Platform::Darwin, &none());
		assert!(mac.contains("\nclaude --version 2>/dev/null | node .godspeed/new-enough.mjs 2.1.330 || { echo \"godspeed needs Claude Code 2.1.330 or newer. Update it (run: claude update), then click Start again in godspeed.\"; exit 6; }\n"), "{mac}");
		let win = start_script(StartTarget::Claude, "C:\\gs", Platform::Win32, &none());
		assert!(win.contains("\r\nclaude --version 2>nul | node .godspeed\\new-enough.mjs 2.1.330 || (echo godspeed needs Claude Code 2.1.330 or newer. Update it ^(run: claude update^), then click Start again in godspeed. & exit /b 6)\r\n"), "{win}");
		assert!(!start_script(StartTarget::Claude, "/Users/me/godspeed", Platform::Linux, &own_claude()).contains("--version"), "a launcher may not pass the flag on");
		assert!(!start_script(StartTarget::Codex, "/Users/me/godspeed", Platform::Linux, &none()).contains("--version"));
	}

	#[test]
	fn the_teacher_goes_back_to_a_chat_starts_quiet_in_godspeed_and_teaches_outside() {
		let claude = start_script(StartTarget::Claude, "/Users/me/godspeed", Platform::Darwin, &none());
		assert!(claude.contains("\nif [ -n \"$GODSPEED_RESUME\" ]; then exec claude --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 --resume \"$GODSPEED_RESUME\"; fi\n"), "{claude}");
		assert!(claude.contains("\nif [ -n \"$GODSPEED_TERMINAL\" ]; then exec claude --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000; fi\n"), "{claude}");
		assert!(claude.ends_with("\nexec claude --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 \"Start teaching\"\n"), "{claude}");
		let codex = start_script(StartTarget::Codex, "/Users/me/godspeed", Platform::Linux, &none());
		assert!(codex.contains("then exec codex resume -c "), "{codex}");
		assert!(codex.contains(" \"$GODSPEED_RESUME\"; fi\n"), "{codex}");
		let win = start_script(StartTarget::Claude, "C:\\Users\\me\\godspeed", Platform::Win32, &none());
		assert!(win.contains("\r\nif defined GODSPEED_RESUME (claude --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 --resume %GODSPEED_RESUME% & exit /b)\r\n"), "{win}");
		assert!(copy_command(FolderAgent::Claude, "/Users/me/godspeed", "/Users/me", Platform::Darwin, &none()).ends_with(" \"Start teaching\""), "an agent started outside godspeed starts teaching");
	}

	#[test]
	fn the_helper_starts_each_agent_with_its_own_prompt() {
		assert!(start_script(StartTarget::ClaudeHelper, "/Users/me/godspeed", Platform::Linux, &none()).ends_with("\nexport GODSPEED_HELPER=1\nexec claude --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 \"Start as the helper\"\n"));
		let codex = start_script(StartTarget::CodexHelper, "/Users/me/godspeed", Platform::Linux, &none());
		assert!(codex.contains(r#" -c "hooks.UserPromptSubmit=[{hooks=[{type='command',command='node \"/Users/me/godspeed/.godspeed/typed.mjs\"',timeout=10}]}]" "#), "{codex}");
		assert!(codex.contains(r#" -c "hooks.PermissionRequest=[{hooks=[{type='command',command='node \"/Users/me/godspeed/.godspeed/agent-event.mjs\"',timeout=10}]}]" "#), "{codex}");
		assert!(codex.ends_with("async=true}]}]\" \"Start as the helper\"\n"), "{codex}");
		let win = start_script(StartTarget::CodexHelper, "C:\\Users\\me\\godspeed", Platform::Win32, &none());
		assert!(win.contains(r#" -c "hooks.Stop=[{hooks=[{type='command',command='node \"C:\Users\me\godspeed\.godspeed\agent-event.mjs\"',timeout=10}]}]" "#), "{win}");
	}

	#[test]
	fn the_learners_own_command_starts_the_agent() {
		let own = own_claude();
		assert_eq!(copy_command(FolderAgent::Claude, "/Users/me/godspeed", "/Users/me", Platform::Darwin, &own), "cd ~/godspeed && standardcompute launch claude -- --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 \"Start teaching\"");
		assert!(copy_command(FolderAgent::Codex, "/Users/me/godspeed", "/Users/me", Platform::Darwin, &own).starts_with("cd ~/godspeed && codex -c "), "Codex keeps the usual one");
		assert_eq!(copy_command(FolderAgent::Claude, "C:\\gs", "C:\\Users\\me", Platform::Win32, &own), "cd /d \"C:\\gs\" && standardcompute launch claude -- --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 \"Start teaching\"");

		let script = start_script(StartTarget::Claude, "/Users/me/godspeed", Platform::Darwin, &own);
		assert!(script.contains("\ncommand -v standardcompute >/dev/null 2>&1 || { echo \"godspeed couldn't find standardcompute. Check the command under Change command in godspeed.\"; exit 3; }\n"), "{script}");
		assert!(script.ends_with("\nstandardcompute launch claude -- --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 \"Start teaching\"\n"));
		assert!(!script.contains("command -v claude") && !script.contains("exec "));
		assert!(start_script(StartTarget::ClaudeHelper, "/Users/me/godspeed", Platform::Linux, &own).ends_with("\nexport GODSPEED_HELPER=1\nstandardcompute launch claude -- --settings .godspeed/claude-settings.json --strict-mcp-config --mcp-config .mcp.json --disallowedTools Agent Skill --autocompact 150000 \"Start as the helper\"\n"));
		assert!(start_script(StartTarget::Codex, "/Users/me/godspeed", Platform::Linux, &own).contains("\nexec codex -c "));

		let codex = StartCommands { claude: None, codex: Some("standardcompute launch codex --".to_owned()) };
		let win = start_script(StartTarget::Codex, "C:\\gs", Platform::Win32, &codex);
		assert!(win.contains("\r\nwhere standardcompute >nul 2>nul || (echo godspeed couldn't find standardcompute. Check the command under Change command in godspeed. & exit /b 3)\r\n"), "{win}");
		assert!(win.contains("\r\nstandardcompute launch codex -- -c \"mcp_servers.godspeed.command='node'\""));

		let variable = StartCommands { claude: Some("ANTHROPIC_BASE_URL=https://example.test claude".to_owned()), codex: None };
		let script = start_script(StartTarget::Claude, "/Users/me/godspeed", Platform::Linux, &variable);
		assert_eq!(script.matches("command -v ").count(), 1, "only Node.js is checked when the first word isn't a program");
		assert!(script.contains("\nANTHROPIC_BASE_URL=https://example.test claude --settings "));
	}

	#[test]
	fn only_start_commands_a_script_can_hold_are_kept() {
		assert!(usable_start_command("standardcompute launch claude --"));
		assert!(!usable_start_command("claude\nrm -rf ~") && !usable_start_command("a\rb"));
		assert!(usable_start_command(&"x".repeat(300)) && !usable_start_command(&"x".repeat(301)));
		assert!(usable_start_command(&"😀".repeat(150)) && !usable_start_command(&"😀".repeat(151)), "counted in UTF-16 units");
		let saved = saved_start_commands(&gs_json::parse(r#"{"claude":"a b","codex":"","other":"x"}"#).unwrap());
		assert_eq!(gs_json::stringify(&saved.to_json()), r#"{"claude":"a b"}"#);
		assert!(saved_start_commands(&gs_json::parse(r#"{"claude":"a\nb","codex":3}"#).unwrap()).is_empty());
		assert!(saved_start_commands(&Json::from("claude")).is_empty());
		let both = saved_start_commands(&gs_json::parse(r#"{"codex":"c","claude":"a"}"#).unwrap());
		assert_eq!(gs_json::stringify(&both.to_json()), r#"{"claude":"a","codex":"c"}"#);
	}
}
