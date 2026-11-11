//! Parity with Node for the program lookup (tests/golden/transcribe.json, made by
//! scripts/golden.ts from transcribe.golden.ts). The transcriptions and downloads are replayed
//! inside the crate, where the program search and the download address can be set.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use gs_json::{Json, parse};
use gs_transcribe::programs::find_program;

fn script(file: &Path, mode: u32) {
	std::fs::create_dir_all(file.parent().unwrap()).unwrap();
	gs_base::fsx::write_text_atomic(file, "#!/bin/sh\n").unwrap();
	std::fs::set_permissions(file, std::fs::Permissions::from_mode(mode)).unwrap();
}

/// The same folders the golden spec builds.
fn lookup_tree(root: &Path) {
	use std::os::unix::fs::symlink;
	script(&root.join("a/tool-x"), 0o644);
	script(&root.join("b/tool-x"), 0o755);
	script(&root.join("c/tool-x"), 0o755);
	std::fs::create_dir_all(root.join("d/tool-x")).unwrap();
	std::fs::create_dir_all(root.join("e")).unwrap();
	symlink(root.join("b/tool-x"), root.join("e/tool-x")).unwrap();
	std::fs::create_dir_all(root.join("f")).unwrap();
	symlink(root.join("nowhere"), root.join("f/tool-x")).unwrap();
	script(&root.join("g/tool-x"), 0o100);
	std::fs::create_dir_all(root.join("h")).unwrap();
	symlink(root.join("a/tool-x"), root.join("h/tool-x")).unwrap();
	script(&root.join("i/tool-y"), 0o755);
}

#[test]
fn find_program_matches_node() {
	let file = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/transcribe.json");
	let golden = parse(&std::fs::read_to_string(file).unwrap()).unwrap();
	let cases = golden.as_arr().unwrap().iter().find(|c| c["name"] == Json::from("findProgram")).unwrap()["output"].clone();
	let root = std::env::temp_dir().join(format!("gs-transcribe-lookup-{}", gs_base::ids::uuid()));
	lookup_tree(&root);
	let root_text = root.to_string_lossy().into_owned();
	for case in cases.as_arr().unwrap() {
		let template = case["path"].as_str();
		let path_env = template.map(|t| t.replace("$R", &root_text));
		let found = find_program(case["name"].as_str().unwrap(), path_env.as_deref()).map(|p| p.to_string_lossy().replace(&root_text, "<root>"));
		let note = case["note"].as_str().unwrap();
		assert_eq!(Json::from(found), case["found"], "{note}");
	}
	std::fs::remove_dir_all(&root).unwrap();
}
