//! The godspeed folder (default ~/godspeed), where the agent works: the agent that runs in it,
//! the learner's own start commands, and the folder's names. Pure.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text::len16;
use gs_json::{Json, Obj};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FolderAgent {
	Claude,
	Codex,
}

impl FolderAgent {
	pub const ALL: [FolderAgent; 2] = [FolderAgent::Claude, FolderAgent::Codex];

	pub fn name(self) -> &'static str {
		match self {
			FolderAgent::Claude => "claude",
			FolderAgent::Codex => "codex",
		}
	}

	/// The agent its `name` names.
	pub fn from_name(name: &str) -> Option<FolderAgent> {
		FolderAgent::ALL.into_iter().find(|agent| agent.name() == name)
	}

	/// The agent's name as the learner reads it.
	pub fn label(self) -> &'static str {
		match self {
			FolderAgent::Claude => "Claude Code",
			FolderAgent::Codex => "Codex",
		}
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
		for agent in FolderAgent::ALL {
			if let Some(command) = self.get(agent) {
				out.insert(agent.name(), command);
			}
		}
		Json::Obj(out)
	}
}

const START_COMMAND_MAX_CHARS: usize = 300;

/// A start command godspeed keeps: one line, not too long.
pub fn usable_start_command(command: &str) -> bool {
	len16(command) <= START_COMMAND_MAX_CHARS && !command.contains(['\r', '\n'])
}

/// The start commands in a saved value: the usable ones that aren't empty.
pub fn saved_start_commands(raw: &Json) -> StartCommands {
	let saved = |agent: FolderAgent| raw.as_obj().and_then(|o| o.get(agent.name())).and_then(Json::as_str).filter(|c| !c.is_empty() && usable_start_command(c)).map(str::to_owned);
	StartCommands { claude: saved(FolderAgent::Claude), codex: saved(FolderAgent::Codex) }
}

/// A folder godspeed takes: absolute, with no quotes, `$` signs or line breaks.
pub fn usable_folder(folder: &str) -> bool {
	static WINDOWS: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[A-Za-z]:\\", ""));
	static UNSAFE: LazyLock<Re> = LazyLock::new(|| Re::new(r#"["'`$\r\n]"#, ""));
	(folder.starts_with('/') || WINDOWS.test(folder)) && !UNSAFE.test(folder)
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn folders_must_be_absolute_with_no_quotes() {
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
	fn only_one_line_start_commands_are_kept() {
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
