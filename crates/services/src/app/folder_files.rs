//! Writing the godspeed folder's own file: the space-setup steps the teacher reads, the app's own
//! folder-files/setup-spaces.md embedded at build time.

use std::path::Path;

use gs_base::fsx;

use super::disk::write_file_atomic;

/// Where the space-setup steps go, from the folder.
pub(super) const SETUP_STEPS: &str = ".godspeed/setup-spaces.md";
const SETUP_TEXT: &str = include_str!("../../folder-files/setup-spaces.md");

/// The first line of the CLAUDE.md and AGENTS.md an older godspeed wrote in the folder.
const OLD_INSTRUCTIONS_HEAD: &str = "<!-- godspeed rewrites this file each time it starts.";

/// What an older godspeed wrote in `.godspeed/` and no longer uses: the agent's connection and
/// its hooks' scripts, its Claude Code settings, the start scripts (each a backup, a helper or a
/// second agent's too), the script that woke the agent with work and the compaction hooks. An
/// older godspeed rewrote each of them at every start, so none holds the learner's own words.
fn old_files() -> Vec<String> {
	let mut names: Vec<String> = ["connect.mjs", "target.mjs", "typed.mjs", "agent-event.mjs", "new-enough.mjs", "package.json", "claude-settings.json", "wait-for-work.mjs", "forget.mjs", "compacting.mjs"]
		.map(str::to_owned)
		.to_vec();
	for extension in ["command", "cmd", "sh"] {
		for start in ["claude", "codex", "claude-backup", "claude-helper", "codex-helper"] {
			names.push(format!("start-{start}.{extension}"));
		}
	}
	names
}

/// An older godspeed's CLAUDE.md or AGENTS.md: it still starts with the line saying godspeed
/// rewrites it. One the learner made their own does not.
fn is_old_instructions(text: &str) -> bool {
	text.starts_with(OLD_INSTRUCTIONS_HEAD)
}

/// An older godspeed's `.mcp.json`: godspeed's is its only server. One the learner added a server
/// to is theirs.
fn is_old_mcp_json(text: &str) -> bool {
	let Ok(parsed) = gs_json::parse(text) else { return false };
	parsed["mcpServers"].as_obj().is_some_and(|servers| servers.len() == 1 && servers.contains_key("godspeed"))
}

/// Removes `file` when it is there and `old` says godspeed wrote it.
fn remove_if_old(file: &Path, old: fn(&str) -> bool) -> Result<(), String> {
	match fsx::read_text(file) {
		Ok(text) if old(&text) => fsx::remove_if_present(file, "rm"),
		_ => Ok(()),
	}
}

/// Write the folder's file, creating the folder if need be, and clear out what an older godspeed
/// left. The learner's own files, and the pictures and files they once gave the agent in
/// `.godspeed/attachments`, stay. Err is the first failure, worded like Node's.
pub(crate) fn write_folder(folder: &str) -> Result<(), String> {
	let root = Path::new(folder);
	let steps = root.join(SETUP_STEPS);
	// Only when it changed, so a refresh leaves the folder alone.
	if fsx::read_text(&steps).ok().as_deref() != Some(SETUP_TEXT) {
		write_file_atomic(&steps, SETUP_TEXT)?;
	}
	for name in ["CLAUDE.md", "AGENTS.md"] {
		remove_if_old(&root.join(name), is_old_instructions)?;
	}
	remove_if_old(&root.join(".mcp.json"), is_old_mcp_json)?;
	// Older godspeeds wrote the setup steps as a skill (/setup-classes, then /setup-spaces).
	for name in ["setup-classes", "setup-spaces"] {
		let old_skill = root.join(".claude").join("skills").join(name);
		fsx::remove_dir_if_present(&old_skill)?;
	}
	let dot = root.join(".godspeed");
	for name in old_files() {
		fsx::remove_if_present(&dot.join(name), "rm")?;
	}
	let images = dot.join("images");
	fsx::remove_dir_if_present(&images)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::scratch_dir;

	const OLD_CLAUDE: &str = "<!-- godspeed rewrites this file each time it starts. Put your own notes for Claude in CLAUDE.local.md. -->\n\n# godspeed\n";
	const OLD_MCP: &str = "{\n\t\"mcpServers\": {\n\t\t\"godspeed\": {\n\t\t\t\"command\": \"node\",\n\t\t\t\"args\": [\"/h/godspeed/.godspeed/connect.mjs\"]\n\t\t}\n\t}\n}\n";

	#[test]
	fn a_folder_gets_its_file_and_a_second_write_changes_nothing() {
		let root = scratch_dir("folder-files");
		let folder = root.join("godspeed");
		let name = folder.to_string_lossy().into_owned();
		write_folder(&name).unwrap();
		let steps = folder.join(SETUP_STEPS);
		assert_eq!(std::fs::read_to_string(&steps).unwrap(), SETUP_TEXT);
		let first = std::fs::metadata(&steps).unwrap().modified().unwrap();
		write_folder(&name).unwrap();
		assert_eq!(std::fs::metadata(&steps).unwrap().modified().unwrap(), first);
	}

	#[test]
	fn what_an_older_godspeed_left_unchanged_goes() {
		let root = scratch_dir("folder-files-old");
		let old = [root.join(".claude/skills/setup-classes"), root.join(".claude/skills/setup-spaces")];
		for skill in &old {
			write_file_atomic(&skill.join("SKILL.md"), "old").unwrap();
		}
		write_file_atomic(&root.join("CLAUDE.md"), OLD_CLAUDE).unwrap();
		write_file_atomic(&root.join("AGENTS.md"), &OLD_CLAUDE.replace("Claude in CLAUDE.local.md", "Codex in ~/.codex/AGENTS.md")).unwrap();
		write_file_atomic(&root.join(".mcp.json"), OLD_MCP).unwrap();
		let dot = root.join(".godspeed");
		let gone = ["connect.mjs", "target.mjs", "typed.mjs", "agent-event.mjs", "new-enough.mjs", "package.json", "claude-settings.json", "start-claude.sh", "start-codex.command", "start-codex.cmd", "start-claude-backup.sh", "start-codex-helper.cmd", "wait-for-work.mjs", "forget.mjs", "compacting.mjs", "images/a.png"];
		for name in gone {
			write_file_atomic(&dot.join(name), "old").unwrap();
		}
		write_folder(&root.to_string_lossy()).unwrap();
		assert!(old.iter().all(|skill| !skill.exists()) && dot.join("setup-spaces.md").is_file());
		for name in ["CLAUDE.md", "AGENTS.md", ".mcp.json"] {
			assert!(!root.join(name).exists(), "{name}");
		}
		for name in gone.iter().map(|name| name.trim_end_matches("/a.png")) {
			assert!(!dot.join(name).exists(), "{name}");
		}
	}

	#[test]
	fn the_learners_own_files_stay() {
		let root = scratch_dir("folder-files-own");
		let own_claude = "# My notes\n\nKeep answers short.\n";
		let edited_agents = format!("My own line first.\n{OLD_CLAUDE}");
		let own_mcp = "{\"mcpServers\": {\"godspeed\": {\"command\": \"node\"}, \"notes\": {\"command\": \"notes-server\"}}}\n";
		write_file_atomic(&root.join("CLAUDE.md"), own_claude).unwrap();
		write_file_atomic(&root.join("AGENTS.md"), &edited_agents).unwrap();
		write_file_atomic(&root.join(".mcp.json"), own_mcp).unwrap();
		write_file_atomic(&root.join("CLAUDE.local.md"), "mine").unwrap();
		let attachments = root.join(".godspeed/attachments");
		write_file_atomic(&attachments.join("photo.png"), "picture").unwrap();
		write_file_atomic(&attachments.join("sheet.pdf"), "pdf").unwrap();
		write_folder(&root.to_string_lossy()).unwrap();
		assert_eq!(std::fs::read_to_string(root.join("CLAUDE.md")).unwrap(), own_claude);
		assert_eq!(std::fs::read_to_string(root.join("AGENTS.md")).unwrap(), edited_agents);
		assert_eq!(std::fs::read_to_string(root.join(".mcp.json")).unwrap(), own_mcp);
		assert_eq!(std::fs::read_to_string(root.join("CLAUDE.local.md")).unwrap(), "mine");
		assert_eq!(std::fs::read_to_string(attachments.join("photo.png")).unwrap(), "picture");
		assert_eq!(std::fs::read_to_string(attachments.join("sheet.pdf")).unwrap(), "pdf");
	}

	#[test]
	fn a_blocked_folder_names_the_failing_step() {
		let root = scratch_dir("folder-files-blocked");
		write_file_atomic(&root.join("file"), "x").unwrap();
		let err = write_folder(&root.join("file").to_string_lossy()).unwrap_err();
		assert!(err.starts_with("EEXIST: file already exists, mkdir ") || err.starts_with("ENOTDIR: not a directory, mkdir "), "{err}");
	}
}
