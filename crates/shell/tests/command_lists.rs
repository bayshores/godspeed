//! The app's commands are listed by hand in build.rs, capabilities/main.json and main.rs. A command
//! missing from one of them only fails in the built app, so this test compares the three lists.
//! The terminal window's capability may name only some of them.

use std::collections::BTreeSet;

const BUILD_RS: &str = include_str!("../build.rs");
const CAPABILITY: &str = include_str!("../capabilities/main.json");
const TERMINAL_CAPABILITY: &str = include_str!("../capabilities/terminal.json");
const MAIN_RS: &str = include_str!("../src/main.rs");

type Names = BTreeSet<String>;

/// The quoted names between a line holding `start` and the next line holding `end`.
fn quoted_between(source: &str, start: &str, end: &str) -> Vec<String> {
	let lines = source.lines().skip_while(|line| !line.contains(start)).skip(1).take_while(|line| !line.contains(end));
	lines.filter_map(|line| line.trim().trim_end_matches(',').strip_prefix('"')?.strip_suffix('"')).map(str::to_owned).collect()
}

/// `allow-terminal-add-file` is the permission for the command `terminal_add_file`.
fn command_of_permission(permission: &str) -> String {
	permission.strip_prefix("allow-").unwrap_or(permission).replace('-', "_")
}

fn build_rs_commands() -> Names {
	quoted_between(BUILD_RS, ".commands(&[", "]);").into_iter().collect()
}

fn capability_commands(capability: &str) -> Names {
	quoted_between(capability, "\"permissions\"", "]").iter().map(|permission| command_of_permission(permission)).collect()
}

/// The last path segment of each `generate_handler!` entry, skipping `#[cfg]` lines.
fn handler_commands() -> Names {
	let lines = MAIN_RS.lines().skip_while(|line| !line.contains("generate_handler![")).skip(1).take_while(|line| !line.contains("])"));
	lines.map(str::trim).filter(|line| !line.starts_with('#')).filter_map(|line| line.trim_end_matches(',').rsplit("::").next()).map(str::to_owned).collect()
}

#[test]
fn the_three_command_lists_name_the_same_commands() {
	let lists = [("build.rs", build_rs_commands()), ("capabilities/main.json", capability_commands(CAPABILITY)), ("main.rs generate_handler!", handler_commands())];
	let all: Names = lists.iter().flat_map(|(_, names)| names.iter().cloned()).collect();
	assert!(all.len() > 20, "the lists were not read: {all:?}");
	let mut problems = Vec::new();
	for (list, names) in &lists {
		let missing: Vec<&String> = all.difference(names).collect();
		if !missing.is_empty() {
			problems.push(format!("{list} is missing {missing:?}"));
		}
	}
	assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// What the terminal window's page must never reach: the main window's own, the updater, the
/// folder picker, printing and file paths, and the call that opens the window itself.
const MAIN_ONLY: [&str; 11] = [
	"show_window",
	"toggle_menu",
	"update_state",
	"update_check",
	"update_install",
	"pick_folder",
	"report_bug",
	"list_fonts",
	"print_pdf",
	"drag_paths",
	"terminal_window_open",
];

#[test]
fn the_terminal_window_may_call_only_some_of_the_commands() {
	let (terminal, main) = (capability_commands(TERMINAL_CAPABILITY), capability_commands(CAPABILITY));
	assert!(terminal.len() > 10, "the capability was not read: {terminal:?}");
	let unknown: Vec<&String> = terminal.difference(&main).collect();
	assert!(unknown.is_empty(), "capabilities/terminal.json names commands main.json does not: {unknown:?}");
	let forbidden: Vec<&String> = terminal.iter().filter(|command| MAIN_ONLY.contains(&command.as_str())).collect();
	assert!(forbidden.is_empty(), "capabilities/terminal.json grants main-only commands: {forbidden:?}");
}
