//! The godspeed folder's spaces/: where each space file's shortcut goes, grouped like the Files
//! page (spaces/<space>/<group>/<file>, archived spaces under spaces/Archived/). Names are
//! made safe on every OS, and two of one name get " (2)".

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use gs_base::{re::Re, text};
use gs_json::Json;

use super::file_groups::file_groups;

const ARCHIVED_DIR: &str = "Archived";
pub const README_NAME: &str = "READ ME.txt";

/// A file or folder name every OS accepts: reserved characters become "-", trailing dots and
/// spaces go, Windows device names get a "_", at most 150 UTF-16 units.
pub fn safe_entry_name(name: &str) -> String {
	static BAD: LazyLock<Re> = LazyLock::new(|| Re::new(r#"[/\\:*?"<>|\x00-\x1f]"#, "g"));
	static TRAIL: LazyLock<Re> = LazyLock::new(|| Re::new(r"[. ]+$", ""));
	static RESERVED: LazyLock<Re> = LazyLock::new(|| Re::new(r"^(con|prn|aux|nul|com\d|lpt\d)$", "i"));
	let mut out = text::trim(&TRAIL.replace(&BAD.replace(name, "-"), "")).to_owned();
	if out.is_empty() {
		out = "Untitled".to_owned();
	}
	let stem = match text::last_index_of16(&out, ".") {
		Some(dot) if dot > 0 => text::slice16(&out, 0, Some(dot as i64)),
		_ => out.clone(),
	};
	if RESERVED.test(&stem) {
		out = format!("{stem}_{}", text::slice16(&out, text::len16(&stem) as i64, None));
	}
	text::slice16(&out, 0, Some(150))
}

/// `name`, or "name (2).ext", "name (3).ext"... when it's taken (any case, since macOS and
/// Windows folders ignore it). Marks the result taken.
pub fn unique_name(name: &str, taken: &mut HashSet<String>) -> String {
	let (stem, ext) = match text::last_index_of16(name, ".") {
		Some(dot) if dot > 0 => (text::slice16(name, 0, Some(dot as i64)), text::slice16(name, dot as i64, None)),
		_ => (name.to_owned(), String::new()),
	};
	let mut pick = name.to_owned();
	let mut n = 2;
	while taken.contains(&pick.to_lowercase()) {
		pick = format!("{stem} ({n}){ext}");
		n += 1;
	}
	taken.insert(pick.to_lowercase());
	pick
}

/// One shortcut spaces/ should hold.
#[derive(Debug, Clone, PartialEq)]
pub struct Shortcut {
	/// Path segments under spaces/, the file's name last.
	pub at: Vec<String>,
	pub file_id: String,
}

/// Each space's folder under spaces/ (path segments), by space id. Spaces are records with
/// `id`, `name` and `archived`.
pub fn space_dirs(spaces: &[Json]) -> HashMap<String, Vec<String>> {
	let mut out = HashMap::new();
	let mut top: HashSet<String> = [ARCHIVED_DIR, README_NAME].iter().map(|n| n.to_lowercase()).collect();
	let mut archived = HashSet::new();
	for space in spaces {
		let is_archived = space["archived"].truthy();
		let dir = unique_name(&safe_entry_name(space["name"].as_str().unwrap_or("")), if is_archived { &mut archived } else { &mut top });
		let path = if is_archived { vec![ARCHIVED_DIR.to_owned(), dir] } else { vec![dir] };
		out.insert(space["id"].as_str().unwrap_or("").to_owned(), path);
	}
	out
}

/// Every shortcut spaces/ should hold, in Files page order. Spaces are records with `id`,
/// `name`, `archived` and `files`.
pub fn shortcut_layout(spaces: &[Json]) -> Vec<Shortcut> {
	let mut out = Vec::new();
	let dirs = space_dirs(spaces);
	for space in spaces {
		let base = &dirs[space["id"].as_str().unwrap_or("")];
		let mut groups = HashSet::new();
		let files = space["files"].as_arr().map_or(&[][..], Vec::as_slice);
		for group in file_groups(files) {
			let group_dir = unique_name(&safe_entry_name(&group.label), &mut groups);
			let mut names = HashSet::new();
			for item in &group.items {
				for file in &item.files {
					let mut at = base.clone();
					at.push(group_dir.clone());
					at.push(unique_name(&safe_entry_name(file["name"].as_str().unwrap_or("")), &mut names));
					out.push(Shortcut { at, file_id: file["id"].as_str().unwrap_or("").to_owned() });
				}
			}
		}
	}
	out
}

/// The note in spaces/, plus the files that couldn't get a shortcut.
pub fn readme_text(skipped: &[String]) -> String {
	let mut lines = vec![
		"These are shortcuts to your space files in godspeed, grouped like the Files page.".to_owned(),
		String::new(),
		"Add, remove or switch files in the godspeed window, not here. godspeed keeps this folder up to date and removes only the shortcuts it made, so anything else you put here stays.".to_owned(),
	];
	if !skipped.is_empty() {
		lines.push(String::new());
		lines.push("These files couldn't get a shortcut on this computer:".to_owned());
		lines.extend(skipped.iter().map(|s| format!("- {s}")));
	}
	format!("{}\n", lines.join("\n"))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn names_are_safe_everywhere() {
		assert_eq!(safe_entry_name("a/b:c?. "), "a-b-c-");
		assert_eq!(safe_entry_name("CON.txt"), "CON_.txt");
		assert_eq!(safe_entry_name(" .. "), "Untitled");
	}

	#[test]
	fn taken_names_get_a_number() {
		let mut taken = HashSet::new();
		assert_eq!(unique_name("a.pdf", &mut taken), "a.pdf");
		assert_eq!(unique_name("A.pdf", &mut taken), "A (2).pdf");
		assert_eq!(unique_name("a.pdf", &mut taken), "a (3).pdf");
	}

	#[test]
	fn archived_spaces_go_under_archived() {
		let spaces = [json!({ "id": "x", "name": "Archived", "archived": false }), json!({ "id": "y", "name": "Old", "archived": true })];
		let dirs = space_dirs(&spaces);
		assert_eq!(dirs["x"], ["Archived (2)"]);
		assert_eq!(dirs["y"], ["Archived", "Old"]);
	}

	#[test]
	fn the_readme_lists_skipped_files() {
		assert!(readme_text(&[]).ends_with("stays.\n"));
		assert!(readme_text(&["a.pdf".to_owned()]).ends_with("this computer:\n- a.pdf\n"));
	}
}
