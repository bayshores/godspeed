//! Updating on stand-in programs: a `claude` that updates itself, and a `codex` in npm's global
//! folder, in Homebrew's, or elsewhere, beside stand-in `npm` and `brew`. Each stand-in keeps its
//! version in a file the update rewrites. No test starts a real agent, npm or Homebrew.

use super::*;
use crate::process::NO_CLAUDE;
use crate::stand_ins::Programs;

/// The command, each line it printed, and how it ended.
async fn ran(update: Result<Update, String>) -> (&'static str, Vec<String>, Result<(), String>) {
	match update.unwrap() {
		Update::Running { command, mut lines, ended } => {
			let mut told = Vec::new();
			while let Some(line) = lines.recv().await {
				told.push(line);
			}
			(command, told, ended.await.unwrap())
		}
		Update::Unknown { command } => panic!("no way to update was found; it offered {command}"),
	}
}

/// `claude` saying the version in its folder's `version` file, and running `update` as `script`.
fn claude(name: &str, script: &str) -> Programs {
	let programs = Programs::new(name);
	let dir = programs.0.display().to_string();
	gs_base::fsx::write_text_atomic(&programs.0.join("version"), "2.1.327\n").unwrap();
	programs.add("claude", &format!("dir='{dir}'\ncase \"$1\" in\n--version) echo \"$(cat \"$dir/version\") (Claude Code)\" ;;\nupdate) {script} ;;\nesac\n"))
}

#[tokio::test]
async fn claude_code_updates_itself_and_each_line_it_prints_is_told() {
	let script = "echo 'Current version: 2.1.327'; echo 'Checking for updates...' >&2; printf 'Downloading 10%%\\rDownloading 100%%\\r\\n'; echo; echo 2.1.340 > \"$dir/version\"; echo 'Successfully updated from 2.1.327 to version 2.1.340'";
	let programs = claude("update-claude", script);
	let (command, mut lines, ended) = ran(programs.claude_runtime(None).update().await).await;
	assert_eq!((command, ended), ("claude update", Ok(())));
	lines.sort();
	assert_eq!(lines, ["Checking for updates...", "Current version: 2.1.327", "Downloading 100%", "Successfully updated from 2.1.327 to version 2.1.340"], "both outputs, a redrawn line as it ends, no blank line");
}

#[tokio::test]
async fn an_update_that_fails_or_leaves_the_agent_old_says_its_last_line_of_errors_or_else_of_output() {
	for (name, script, why) in [
		("update-refused", "echo 'Error: EACCES: permission denied' >&2; echo 'Updating...'; exit 1", "Error: EACCES: permission denied"),
		("update-managed", "echo 'Claude Code is managed by Homebrew.'", "Claude Code is managed by Homebrew."),
		("update-silent", "exit 0", "claude is still 2.1.327"),
		("update-silent-fail", "exit 3", "the update ended with exit status: 3"),
	] {
		let programs = claude(name, script);
		let (command, _, ended) = ran(programs.claude_runtime(None).update().await).await;
		assert_eq!((command, ended), ("claude update", Err(why.to_owned())), "{name}");
	}
}

/// A stand-in program at `file` under the folder, with `codex` on the PATH linking to it, as npm
/// and Homebrew link the programs they install.
fn linked_codex(programs: Programs, file: &str) -> Programs {
	let dir = programs.0.display().to_string();
	gs_base::fsx::write_text_atomic(&programs.0.join("version"), "0.150.0\n").unwrap();
	std::fs::create_dir_all(programs.0.join(file).parent().unwrap()).unwrap();
	let programs = programs.add(file, &format!("echo \"codex-cli $(cat '{dir}/version')\"\n"));
	std::os::unix::fs::symlink(programs.0.join(file), programs.0.join("codex")).unwrap();
	programs
}

/// `npm` and `brew` naming their folders under the stand-ins' folder; an install or upgrade
/// keeps its words in `asked` and writes the new version.
fn npm_and_brew(programs: Programs, npm_root: &str) -> Programs {
	let dir = programs.0.display().to_string();
	let updates = format!("echo \"$*\" >> '{dir}/asked'; echo 0.170.0 > '{dir}/version'");
	programs
		.add("npm", &format!("case \"$1\" in\nroot) echo '{dir}/{npm_root}' ;;\ninstall) echo 'changed 1 package in 3s'; {updates} ;;\nesac\n"))
		.add("brew", &format!("case \"$1\" in\n--prefix) echo '{dir}/homebrew' ;;\nupgrade) echo '==> Upgrading 1 outdated package:'; {updates} ;;\nesac\n"))
}

fn asked(programs: &Programs) -> String {
	std::fs::read_to_string(programs.0.join("asked")).unwrap_or_default()
}

#[tokio::test]
async fn codex_in_npms_folder_updates_with_npm() {
	let programs = npm_and_brew(linked_codex(Programs::new("update-npm"), "npm-global/lib/node_modules/@openai/codex/bin/codex.js"), "npm-global/lib/node_modules");
	assert_eq!(ran(programs.codex_runtime(None).update().await).await, (CODEX_NPM, vec!["changed 1 package in 3s".to_owned()], Ok(())));
	assert_eq!(asked(&programs), "install -g @openai/codex@latest\n");
}

#[tokio::test]
async fn codex_from_homebrew_updates_with_brew() {
	let programs = npm_and_brew(linked_codex(Programs::new("update-brew"), "homebrew/Caskroom/codex/0.150.0/codex-aarch64-apple-darwin"), "npm-global/lib/node_modules");
	assert_eq!(ran(programs.codex_runtime(None).update().await).await, (CODEX_BREW, vec!["==> Upgrading 1 outdated package:".to_owned()], Ok(())));
	assert_eq!(asked(&programs), "upgrade codex\n");
}

#[tokio::test]
async fn codex_installed_another_way_is_left_to_the_learner_with_the_command() {
	let programs = npm_and_brew(linked_codex(Programs::new("update-other"), "downloads/codex"), "npm-global/lib/node_modules");
	for folder in ["npm-global/lib/node_modules", "homebrew/Caskroom"] {
		std::fs::create_dir_all(programs.0.join(folder)).unwrap();
	}
	assert!(matches!(programs.codex_runtime(None).update().await, Ok(Update::Unknown { command: CODEX_NPM })));
	assert_eq!(asked(&programs), "", "nothing ran");
}

#[tokio::test]
async fn an_update_is_refused_for_the_learners_own_command_a_missing_agent_and_the_stand_in() {
	let programs = claude("update-refusals", "exit 0");
	let refused = |update: Result<Update, String>| update.err().unwrap();
	assert_eq!(refused(programs.claude_runtime(Some("my-claude")).update().await), OWN_COMMAND);
	assert_eq!(refused(Programs::new("update-missing").claude_runtime(None).update().await), NO_CLAUDE);
	assert_eq!(refused(crate::fake::FakeAgent::new(Vec::new()).runtime().update().await), "the stand-in agent has no update");
}
