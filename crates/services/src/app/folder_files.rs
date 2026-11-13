//! Writing the godspeed folder's files: the agent's instructions, its connection and its start
//! scripts. The fixed texts are the app's own agent-folder-files, embedded at build time; the
//! ones that name the folder come from gs_core's agent_folder.

use std::path::Path;

use gs_base::{clock, fsx};
use gs_core::spaces::agent_folder::{Platform, StartCommands, claude_settings, mcp_json, start_script, start_script_path};
use gs_json::{json, stringify_pretty};

use super::agent_folder::START_TARGETS;
use super::disk::write_file_atomic;

/// Images the waiter saved for the agent are kept this long.
const IMAGE_DAYS: i64 = 7;

/// The agent's instructions and the space-setup skill, copied into the folder as they are.
const DOCS: [(&str, &str); 3] = [
	("CLAUDE.md", include_str!("../../folder-files/CLAUDE.md")),
	("AGENTS.md", include_str!("../../folder-files/AGENTS.md")),
	(".claude/skills/setup-spaces/SKILL.md", include_str!("../../folder-files/setup-spaces.md")),
];

/// The waiter's and the hooks' scripts, copied into `.godspeed/` as they are.
const SCRIPTS: [(&str, &str); 5] = [
	("connect.mjs", include_str!("../../folder-files/connect.mjs")),
	("target.mjs", include_str!("../../folder-files/target.mjs")),
	("wait-for-work.mjs", include_str!("../../folder-files/wait-for-work.mjs")),
	("forget.mjs", include_str!("../../folder-files/forget.mjs")),
	("compacting.mjs", include_str!("../../folder-files/compacting.mjs")),
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

/// Removes the waiter's saved images older than `IMAGE_DAYS`.
fn drop_old_images(folder: &Path) -> Result<(), String> {
	let dir = folder.join(".godspeed").join("images");
	if !dir.exists() {
		return Ok(());
	}
	let cutoff = clock::now_ms() as f64 - (IMAGE_DAYS * 86_400_000) as f64;
	let mut names: Vec<String> = std::fs::read_dir(&dir)
		.map_err(|err| fsx::node_error_message(&err, "scandir", &dir))?
		.flatten()
		.map(|entry| entry.file_name().to_string_lossy().into_owned())
		.collect();
	names.sort();
	for name in names {
		let file = dir.join(&name);
		let meta = std::fs::metadata(&file).map_err(|err| fsx::node_error_message(&err, "stat", &file))?;
		let modified = meta.modified().ok().and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64() * 1000.0);
		if modified < cutoff {
			if meta.is_dir() {
				return Err(format!("Path is a directory: rm returned EISDIR (is a directory) {}", file.display()));
			}
			std::fs::remove_file(&file).map_err(|err| fsx::node_error_message(&err, "rm", &file))?;
		}
	}
	Ok(())
}

/// Write the folder's files, creating it if need be; the start scripts run the learner's own
/// commands. Err is the first failure, worded like Node's.
pub fn write_folder(folder: &str, platform: Platform, commands: &StartCommands) -> Result<(), String> {
	let root = Path::new(folder);
	let dot = root.join(".godspeed");
	for (name, content) in DOCS {
		put(&root.join(name), content, None)?;
	}
	// The command was /setup-classes before the rename.
	let old_skill = root.join(".claude").join("skills").join("setup-classes");
	match std::fs::remove_dir_all(&old_skill) {
		Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(fsx::node_error_message(&err, "rm", &old_skill)),
		_ => {}
	}
	put(&root.join(".mcp.json"), &mcp_json(folder, platform), None)?;
	for (name, content) in SCRIPTS {
		put(&dot.join(name), content, None)?;
	}
	let package = json!({ "private": true, "type": "module", "version": gs_base::config::VERSION });
	put(&dot.join("package.json"), &format!("{}\n", stringify_pretty(&package, "\t")), None)?;
	put(&dot.join("claude-settings.json"), &claude_settings(folder, platform), None)?;
	for target in START_TARGETS {
		put(Path::new(&start_script_path(folder, target, platform)), &start_script(target, folder, platform, commands), Some(0o755))?;
	}
	// An older godspeed left a start script the helper's replaces.
	for extension in ["command", "cmd", "sh"] {
		let old_script = dot.join(format!("start-claude-backup.{extension}"));
		match std::fs::remove_file(&old_script) {
			Err(err) if err.kind() != std::io::ErrorKind::NotFound => return Err(fsx::node_error_message(&err, "rm", &old_script)),
			_ => {}
		}
	}
	drop_old_images(root)
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
		for file in ["CLAUDE.md", "AGENTS.md", ".mcp.json", ".claude/skills/setup-spaces/SKILL.md", ".godspeed/connect.mjs", ".godspeed/target.mjs", ".godspeed/wait-for-work.mjs", ".godspeed/forget.mjs", ".godspeed/compacting.mjs", ".godspeed/package.json", ".godspeed/claude-settings.json", ".godspeed/start-claude.sh", ".godspeed/start-claude-helper.sh", ".godspeed/start-codex.sh", ".godspeed/start-codex-helper.sh"] {
			assert!(folder.join(file).is_file(), "{file}");
		}
		let first = std::fs::metadata(folder.join("CLAUDE.md")).unwrap().modified().unwrap();
		write_folder(&name, platform(), &StartCommands::default()).unwrap();
		assert_eq!(std::fs::metadata(folder.join("CLAUDE.md")).unwrap().modified().unwrap(), first);
		#[cfg(unix)]
		{
			use std::os::unix::fs::PermissionsExt;
			for script in ["start-claude.sh", "start-claude-helper.sh", "start-codex.sh", "start-codex-helper.sh"] {
				assert_eq!(std::fs::metadata(folder.join(".godspeed").join(script)).unwrap().permissions().mode() & 0o777, 0o755, "{script}");
			}
		}
	}

	#[test]
	fn the_old_setup_skill_and_backup_script_go() {
		let root = scratch_dir("folder-files-old-skill");
		let old = root.join(".claude/skills/setup-classes");
		write_file_atomic(&old.join("SKILL.md"), "old").unwrap();
		let old_script = root.join(".godspeed/start-claude-backup.sh");
		write_file_atomic(&old_script, "#!/bin/sh\n").unwrap();
		write_folder(&root.to_string_lossy(), platform(), &StartCommands::default()).unwrap();
		assert!(!old.exists() && root.join(".claude/skills/setup-spaces/SKILL.md").is_file());
		assert!(!old_script.exists() && root.join(".godspeed/start-claude-helper.sh").is_file());
	}

	#[test]
	fn a_blocked_folder_names_the_failing_step() {
		let root = scratch_dir("folder-files-blocked");
		write_file_atomic(&root.join("file"), "x").unwrap();
		let err = write_folder(&root.join("file").to_string_lossy(), platform(), &StartCommands::default()).unwrap_err();
		assert!(err.starts_with("EEXIST: file already exists, mkdir ") || err.starts_with("ENOTDIR: not a directory, mkdir "), "{err}");
	}

	#[test]
	fn old_images_go_and_new_ones_stay() {
		let root = scratch_dir("folder-files-images");
		let images = root.join(".godspeed/images");
		write_file_atomic(&images.join("new.png"), "x").unwrap();
		write_file_atomic(&images.join("old.png"), "x").unwrap();
		let old = std::time::UNIX_EPOCH + std::time::Duration::from_millis((clock::now_ms() - 8 * 86_400_000) as u64);
		std::fs::File::options().write(true).open(images.join("old.png")).unwrap().set_modified(old).unwrap();
		drop_old_images(&root).unwrap();
		assert!(images.join("new.png").exists() && !images.join("old.png").exists());
	}
}
