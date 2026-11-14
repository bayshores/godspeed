//! The godspeed folder (default ~/godspeed): the one folder an outside agent is opened in. It
//! holds the agent's instructions (CLAUDE.md, AGENTS.md), the connection to the app (.mcp.json
//! for Claude Code, command-line flags for Codex) and, in .godspeed/, the scripts and the start
//! scripts the app's "Open Claude Code" button runs. Pure: the generated file contents and
//! commands.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text::len16;
use gs_json::{Json, Obj, json, stringify_pretty};

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
/// background jobs in a second window.
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

/// The prompt each agent starts with; CLAUDE.md and AGENTS.md say what it means.
const START_PROMPT: &str = "Start teaching";
const HELPER_PROMPT: &str = "Start as the helper";

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
/// tools, the waiter and web search (what an interview is like is looked up online) without asking, and tells
/// the app when the session starts compacting and when it lost its context. Fetching a page still
/// asks: text hidden in a space file could send the learner's data out.
pub fn claude_settings(folder: &str, platform: Platform) -> String {
	let hook = |script: &str| json!([{ "type": "command", "command": "node", "args": [join(folder, platform, &[".godspeed", script])], "timeout": 10 }]);
	let forget = hook("forget.mjs");
	let settings = json!({
		"enabledMcpjsonServers": ["godspeed"],
		"permissions": { "allow": ["mcp__godspeed__*", format!("Bash({WAITER})"), format!("Bash({WAITER} *)"), "WebSearch"] },
		"hooks": {
			"PreCompact": [{ "hooks": hook("compacting.mjs") }],
			"SessionStart": [{ "matcher": "compact", "hooks": forget.clone() }],
			"SessionEnd": [{ "matcher": "clear", "hooks": forget }],
		},
	});
	format!("{}\n", stringify_pretty(&settings, "\t"))
}

/// Codex's arguments: godspeed's server through the folder's connector, its tools pre-approved,
/// and a timeout longer than wait_for_work's 600 s. TOML literal strings ('...'), so no value
/// needs escaping.
fn codex_args(folder: &str, platform: Platform, prompt: &str) -> Vec<String> {
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
		prompt.to_owned(),
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

fn start_args(target: StartTarget, folder: &str, platform: Platform) -> Vec<String> {
	match target {
		StartTarget::Codex => codex_args(folder, platform, START_PROMPT),
		StartTarget::CodexHelper => codex_args(folder, platform, HELPER_PROMPT),
		StartTarget::Claude => claude_args(),
		StartTarget::ClaudeHelper => vec!["--settings".to_owned(), CLAUDE_SETTINGS.to_owned(), HELPER_PROMPT.to_owned()],
	}
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
		let args: Vec<String> = claude_args().iter().map(|a| cmd_quote(a)).collect();
		return format!("cd /d \"{folder}\" && {start} {}", args.join(" "));
	}
	static HOME_RELATIVE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^~[\w./-]*$", ""));
	let short = short_folder(folder, home);
	let cd = if HOME_RELATIVE.test(&short) { short } else { posix_quote(folder) };
	let args = if agent == FolderAgent::Claude { claude_args() } else { codex_args(folder, platform, START_PROMPT) };
	let args: Vec<String> = args.iter().map(|a| posix_quote(a)).collect();
	format!("cd {cd} && {start} {}", args.join(" "))
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

/// The start script the button runs in a new terminal window.
pub fn start_script(target: StartTarget, folder: &str, platform: Platform, commands: &StartCommands) -> String {
	let agent = target.agent();
	let own = commands.get(agent);
	let check = install_check(agent, own);
	let args = start_args(target, folder, platform);
	let name = agent.name();
	if platform == Platform::Win32 {
		let args: Vec<String> = args.iter().map(|a| cmd_quote(a)).collect();
		let mut lines = vec!["@echo off".to_owned(), format!("cd /d \"{folder}\"")];
		lines.extend(check.map(|(program, missing)| format!("where {program} >nul 2>nul || (echo {missing} & exit /b 1)")));
		lines.push(format!("where node >nul 2>nul || (echo {} & exit /b 1)", needs_node(agent)));
		lines.push(format!("{} {}", own.unwrap_or(name), args.join(" ")));
		lines.push(String::new());
		return lines.join("\r\n");
	}
	let args: Vec<String> = args.iter().map(|a| posix_quote(a)).collect();
	let mut lines = vec!["#!/bin/sh".to_owned(), format!("cd {} || exit 1", posix_quote(folder))];
	lines.extend(check.map(|(program, missing)| format!("command -v {program} >/dev/null 2>&1 || {{ echo {}; exit 1; }}", posix_quote(&missing))));
	lines.push(format!("command -v node >/dev/null 2>&1 || {{ echo {}; exit 1; }}", posix_quote(needs_node(agent))));
	// The learner's own command may start with a variable (A=b claude), which exec can't run.
	let start = own.map_or_else(|| format!("exec {name}"), str::to_owned);
	lines.push(format!("{start} {}", args.join(" ")));
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
	fn files_and_commands() {
		assert_eq!(mcp_json("/h/godspeed/", Platform::Darwin), "{\n\t\"mcpServers\": {\n\t\t\"godspeed\": {\n\t\t\t\"command\": \"node\",\n\t\t\t\"args\": [\n\t\t\t\t\"/h/godspeed/.godspeed/connect.mjs\"\n\t\t\t]\n\t\t}\n\t}\n}\n");
		assert_eq!(copy_command(FolderAgent::Claude, "/h/godspeed", "/h", Platform::Darwin, &none()), "cd ~/godspeed && claude --settings .godspeed/claude-settings.json \"Start teaching\"");
		assert!(start_script(StartTarget::Codex, "/h/my godspeed", Platform::Linux, &none()).contains("cd \"/h/my godspeed\" || exit 1\n"));
		assert_eq!(start_script_path("C:\\g", StartTarget::Codex, Platform::Win32), "C:\\g\\.godspeed\\start-codex.cmd");
		assert_eq!(start_script_path("/g", StartTarget::ClaudeHelper, Platform::Darwin), "/g/.godspeed/start-claude-helper.command");
	}

	#[test]
	fn settings_allow_web_search_and_hook_every_compaction() {
		let settings = gs_json::parse(&claude_settings("/Users/me/godspeed", Platform::Darwin)).unwrap();
		assert_eq!(gs_json::stringify(&settings["permissions"]["allow"]), r#"["mcp__godspeed__*","Bash(node .godspeed/wait-for-work.mjs)","Bash(node .godspeed/wait-for-work.mjs *)","WebSearch"]"#);
		assert_eq!(gs_json::stringify(&settings["hooks"]["PreCompact"]), r#"[{"hooks":[{"type":"command","command":"node","args":["/Users/me/godspeed/.godspeed/compacting.mjs"],"timeout":10}]}]"#);
		assert_eq!(settings["hooks"].as_obj().unwrap().keys().cloned().collect::<Vec<_>>(), ["PreCompact", "SessionStart", "SessionEnd"]);
	}

	#[test]
	fn the_helper_starts_each_agent_with_its_own_prompt() {
		assert!(start_script(StartTarget::ClaudeHelper, "/Users/me/godspeed", Platform::Linux, &none()).ends_with("\nexec claude --settings .godspeed/claude-settings.json \"Start as the helper\"\n"));
		assert!(start_script(StartTarget::CodexHelper, "/Users/me/godspeed", Platform::Linux, &none()).ends_with("'approve'\" \"Start as the helper\"\n"));
	}

	#[test]
	fn the_learners_own_command_starts_the_agent() {
		let own = own_claude();
		assert_eq!(copy_command(FolderAgent::Claude, "/Users/me/godspeed", "/Users/me", Platform::Darwin, &own), "cd ~/godspeed && standardcompute launch claude -- --settings .godspeed/claude-settings.json \"Start teaching\"");
		assert!(copy_command(FolderAgent::Codex, "/Users/me/godspeed", "/Users/me", Platform::Darwin, &own).starts_with("cd ~/godspeed && codex -c "), "Codex keeps the usual one");
		assert_eq!(copy_command(FolderAgent::Claude, "C:\\gs", "C:\\Users\\me", Platform::Win32, &own), "cd /d \"C:\\gs\" && standardcompute launch claude -- --settings .godspeed/claude-settings.json \"Start teaching\"");

		let script = start_script(StartTarget::Claude, "/Users/me/godspeed", Platform::Darwin, &own);
		assert!(script.contains("\ncommand -v standardcompute >/dev/null 2>&1 || { echo \"godspeed couldn't find standardcompute. Check the command under Change command in godspeed.\"; exit 1; }\n"), "{script}");
		assert!(script.ends_with("\nstandardcompute launch claude -- --settings .godspeed/claude-settings.json \"Start teaching\"\n"));
		assert!(!script.contains("command -v claude") && !script.contains("exec "));
		assert!(start_script(StartTarget::ClaudeHelper, "/Users/me/godspeed", Platform::Linux, &own).ends_with("\nstandardcompute launch claude -- --settings .godspeed/claude-settings.json \"Start as the helper\"\n"));
		assert!(start_script(StartTarget::Codex, "/Users/me/godspeed", Platform::Linux, &own).contains("\nexec codex -c "));

		let codex = StartCommands { claude: None, codex: Some("standardcompute launch codex --".to_owned()) };
		let win = start_script(StartTarget::Codex, "C:\\gs", Platform::Win32, &codex);
		assert!(win.contains("\r\nwhere standardcompute >nul 2>nul || (echo godspeed couldn't find standardcompute. Check the command under Change command in godspeed. & exit /b 1)\r\n"), "{win}");
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
