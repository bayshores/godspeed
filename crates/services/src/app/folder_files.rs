//! Writing the godspeed folder's files: the agent's instructions, its connection and its start
//! scripts. The fixed texts are the app's own agent-folder-files, embedded at build time; the
//! ones that name the folder come from gs_core's agent_folder.

use std::path::Path;

use gs_base::fsx;
use gs_core::spaces::agent_folder::{FolderAgent, Platform, StartCommands, claude_settings, mcp_json, start_script, start_script_path};
use gs_json::{json, stringify_pretty};

use super::disk::write_file_atomic;

/// The agent's instructions and the space-setup steps they point at, copied into the folder as
/// they are.
const DOCS: [(&str, &str); 3] = [
	("CLAUDE.md", include_str!("../../folder-files/CLAUDE.md")),
	("AGENTS.md", include_str!("../../folder-files/AGENTS.md")),
	(".godspeed/setup-spaces.md", include_str!("../../folder-files/setup-spaces.md")),
];

/// The connector's, the hooks' and the start scripts' own scripts, copied into `.godspeed/` as
/// they are.
const SCRIPTS: [(&str, &str); 5] = [
	("connect.mjs", include_str!("../../folder-files/connect.mjs")),
	("target.mjs", include_str!("../../folder-files/target.mjs")),
	("typed.mjs", include_str!("../../folder-files/typed.mjs")),
	("agent-event.mjs", include_str!("../../folder-files/agent-event.mjs")),
	("new-enough.mjs", include_str!("../../folder-files/new-enough.mjs")),
];

/// Write a file only when it changed, so a refresh leaves the folder alone.
fn put(file: &Path, content: &str, mode: Option<u32>) -> Result<(), String> {
	if fsx::read_text(file).ok().as_deref() != Some(content) {
		write_file_atomic(file, content)?;
	}
	match mode {
		Some(mode) => set_mode(file, mode),
		None => Ok(()),
	}
}

#[cfg(unix)]
fn set_mode(file: &Path, mode: u32) -> Result<(), String> {
	use std::os::unix::fs::PermissionsExt;
	std::fs::set_permissions(file, std::fs::Permissions::from_mode(mode)).map_err(|err| fsx::node_error_message(&err, "chmod", file))
}

#[cfg(not(unix))]
fn set_mode(_file: &Path, _mode: u32) -> Result<(), String> {
	Ok(())
}

/// What an older godspeed wrote in `.godspeed/` and no longer uses: an old backup start script,
/// the second agent's start scripts, the script that woke the agent with work, its saved images
/// and the compaction hooks.
fn old_files() -> Vec<String> {
	let mut names: Vec<String> = ["wait-for-work.mjs", "forget.mjs", "compacting.mjs"].map(str::to_owned).to_vec();
	for extension in ["command", "cmd", "sh"] {
		for start in ["claude-backup", "claude-helper", "codex-helper"] {
			names.push(format!("start-{start}.{extension}"));
		}
	}
	names
}

/// Write the folder's files, creating it if need be; the start scripts run the learner's own
/// commands. Err is the first failure, worded like Node's.
pub fn write_folder(folder: &str, platform: Platform, commands: &StartCommands) -> Result<(), String> {
	let root = Path::new(folder);
	let dot = root.join(".godspeed");
	for (name, content) in DOCS {
		put(&root.join(name), content, None)?;
	}
	// Older godspeeds wrote the setup steps as a skill (/setup-classes, then /setup-spaces);
	// the teacher starts with skills off, so they are a plain file now.
	for name in ["setup-classes", "setup-spaces"] {
		let old_skill = root.join(".claude").join("skills").join(name);
		match std::fs::remove_dir_all(&old_skill) {
			Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(fsx::node_error_message(&err, "rm", &old_skill)),
			_ => {}
		}
	}
	put(&root.join(".mcp.json"), &mcp_json(folder, platform), None)?;
	for (name, content) in SCRIPTS {
		put(&dot.join(name), content, None)?;
	}
	let package = json!({ "private": true, "type": "module", "version": gs_base::config::VERSION });
	put(&dot.join("package.json"), &format!("{}\n", stringify_pretty(&package, "\t")), None)?;
	put(&dot.join("claude-settings.json"), &claude_settings(folder, platform), None)?;
	for agent in FolderAgent::ALL {
		put(Path::new(&start_script_path(folder, agent, platform)), &start_script(agent, folder, platform, commands), Some(0o755))?;
	}
	for name in old_files() {
		fsx::remove_if_present(&dot.join(name), "rm")?;
	}
	let images = dot.join("images");
	match std::fs::remove_dir_all(&images) {
		Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(fsx::node_error_message(&err, "rm", &images)),
		_ => Ok(()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::scratch_dir;

	fn platform() -> Platform {
		Platform::Linux
	}

	#[test]
	fn a_folder_gets_every_file_and_a_second_write_changes_nothing() {
		let root = scratch_dir("folder-files");
		let folder = root.join("godspeed");
		let name = folder.to_string_lossy().into_owned();
		write_folder(&name, platform(), &StartCommands::default()).unwrap();
		for file in ["CLAUDE.md", "AGENTS.md", ".mcp.json", ".godspeed/setup-spaces.md", ".godspeed/connect.mjs", ".godspeed/target.mjs", ".godspeed/typed.mjs", ".godspeed/agent-event.mjs", ".godspeed/new-enough.mjs", ".godspeed/package.json", ".godspeed/claude-settings.json", ".godspeed/start-claude.sh", ".godspeed/start-codex.sh"] {
			assert!(folder.join(file).is_file(), "{file}");
		}
		let first = std::fs::metadata(folder.join("CLAUDE.md")).unwrap().modified().unwrap();
		write_folder(&name, platform(), &StartCommands::default()).unwrap();
		assert_eq!(std::fs::metadata(folder.join("CLAUDE.md")).unwrap().modified().unwrap(), first);
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			for script in ["start-claude.sh", "start-codex.sh"] {
				assert_eq!(std::fs::metadata(folder.join(".godspeed").join(script)).unwrap().permissions().mode() & 0o777, 0o755, "{script}");
			}
		}
	}

	#[test]
	fn what_an_older_godspeed_left_goes() {
		let root = scratch_dir("folder-files-old");
		let old = [root.join(".claude/skills/setup-classes"), root.join(".claude/skills/setup-spaces")];
		for skill in &old {
			write_file_atomic(&skill.join("SKILL.md"), "old").unwrap();
		}
		let dot = root.join(".godspeed");
		for name in ["start-claude-backup.sh", "start-claude-helper.sh", "start-codex-helper.cmd", "wait-for-work.mjs", "forget.mjs", "compacting.mjs", "images/a.png"] {
			write_file_atomic(&dot.join(name), "old").unwrap();
		}
		write_folder(&root.to_string_lossy(), platform(), &StartCommands::default()).unwrap();
		assert!(old.iter().all(|skill| !skill.exists()) && dot.join("setup-spaces.md").is_file());
		for name in ["start-claude-backup.sh", "start-claude-helper.sh", "start-codex-helper.cmd", "wait-for-work.mjs", "forget.mjs", "compacting.mjs", "images"] {
			assert!(!dot.join(name).exists(), "{name}");
		}
		assert!(dot.join("start-claude.sh").is_file());
	}

	#[test]
	fn a_blocked_folder_names_the_failing_step() {
		let root = scratch_dir("folder-files-blocked");
		write_file_atomic(&root.join("file"), "x").unwrap();
		let err = write_folder(&root.join("file").to_string_lossy(), platform(), &StartCommands::default()).unwrap_err();
		assert!(err.starts_with("EEXIST: file already exists, mkdir ") || err.starts_with("ENOTDIR: not a directory, mkdir "), "{err}");
	}
}
