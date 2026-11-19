//! The app's commands are listed by hand in build.rs, capabilities/main.json and main.rs. A command
//! missing from one of them only fails in the built app, so this test compares the three lists.

use std::collections::BTreeSet;

const BUILD_RS: &str = include_str!("../build.rs");
const CAPABILITY: &str = include_str!("../capabilities/main.json");
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

fn capability_commands() -> Names {
	quoted_between(CAPABILITY, "\"permissions\"", "]").iter().map(|permission| command_of_permission(permission)).collect()
}

/// The last path segment of each `generate_handler!` entry, skipping `#[cfg]` lines.
fn handler_commands() -> Names {
	let lines = MAIN_RS.lines().skip_while(|line| !line.contains("generate_handler![")).skip(1).take_while(|line| !line.contains("])"));
	lines.map(str::trim).filter(|line| !line.starts_with('#')).filter_map(|line| line.trim_end_matches(',').rsplit("::").next()).map(str::to_owned).collect()
}

#[test]
fn the_three_command_lists_name_the_same_commands() {
	let lists = [("build.rs", build_rs_commands()), ("capabilities/main.json", capability_commands()), ("main.rs generate_handler!", handler_commands())];
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
