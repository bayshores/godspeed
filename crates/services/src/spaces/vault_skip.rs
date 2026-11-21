//! What a linked folder scan leaves out when the folder holds the learner's Obsidian vault: the
//! notes folders godspeed writes in, and the notes it wrote. Their facts come from the lessons, so
//! reading them again would count each idea twice. A note the learner took over or handed to
//! godspeed with `godspeed: keep` is still read.

use std::path::Path;

use gs_base::fsx;
use gs_core::records::settings::resolve_vault;
use gs_core::vault::frontmatter::{Doc, Owner};
use gs_core::vault::note_record::NoteState;
use gs_files::walk::Skip;
use gs_json::Json;

use crate::App;

/// The skip lists for the linked folder at `root`.
pub fn vault_skip(app: &App, root: &Path) -> Skip {
	let settings = app.stores.settings.read_settings().ok().flatten();
	let Some(vault) = resolve_vault(settings.as_ref()).0 else { return Skip::default() };
	skip_in(root, Path::new(&vault), &app.stores.vault_notes.read())
}

/// `path` as a POSIX-style path under `root`, None when it is not inside it.
fn under(root: &Path, path: &Path) -> Option<String> {
	let rel = path.strip_prefix(root).ok()?;
	let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
	(!parts.is_empty()).then(|| parts.join("/"))
}

/// A note still godspeed's: its file names a topic. A file that is gone is skipped too, since the
/// scan would not find it; one the learner took over reads as theirs.
fn is_godspeeds(file: &Path) -> bool {
	match fsx::read_text(file) {
		Ok(text) => matches!(Doc::parse(&text).owner(), Some(Owner::Topic(_))),
		Err(_) => true,
	}
}

fn skip_in(root: &Path, vault: &Path, record: &Json) -> Skip {
	let mut skip = Skip::default();
	if let Some(folders) = record["folders"].as_obj() {
		skip.dirs.extend(folders.iter().filter_map(|(_, folder)| under(root, &vault.join(folder.as_str()?))));
	}
	for (_, note) in record["notes"].as_obj().into_iter().flatten() {
		let Some(file) = note["path"].as_str().map(|p| vault.join(p)) else { continue };
		let Some(rel) = under(root, &file) else { continue };
		match NoteState::parse(note["state"].str_or_empty()) {
			Some(NoteState::Active) if is_godspeeds(&file) => {
				skip.files.insert(rel);
			}
			Some(NoteState::Active | NoteState::Yours | NoteState::Kept) => {
				skip.keep.insert(rel);
			}
			Some(NoteState::Removed) | None => {}
		}
	}
	skip
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::scratch_dir;

	fn write(root: &Path, rel: &str, text: &str) {
		let file = root.join(rel);
		std::fs::create_dir_all(file.parent().unwrap()).unwrap();
		fsx::write_text_atomic(&file, text).unwrap();
	}

	fn record() -> Json {
		json!({
			"folders": { "spc_a": "CSE 21" },
			"notes": {
				"tpc_1": { "spaceId": "spc_a", "path": "CSE 21/Sorting.md", "state": "active" },
				"tpc_2": { "spaceId": "spc_a", "path": "CSE 21/Taken.md", "state": "active" },
				"tpc_3": { "spaceId": "spc_a", "path": "Mine.md", "state": "kept" },
				"tpc_4": { "spaceId": "spc_a", "path": "CSE 21/Theirs.md", "state": "yours" },
				"tpc_5": { "spaceId": "spc_a", "path": "CSE 21/Gone.md", "state": "removed" }
			}
		})
	}

	#[test]
	fn the_notes_folder_and_godspeeds_notes_are_skipped_and_kept_notes_are_not() {
		let root = scratch_dir("vault-skip");
		write(&root, "CSE 21/Sorting.md", "---\ngodspeed: tpc_1\n---\nbody");
		write(&root, "CSE 21/Taken.md", "---\nclass: CSE 21\n---\nthe learner took the key out");
		write(&root, "Mine.md", "---\ngodspeed: keep\n---\nmine");
		let skip = skip_in(&root, &root, &record());
		assert_eq!(skip.dirs, ["CSE 21".to_owned()].into());
		assert_eq!(skip.files, ["CSE 21/Sorting.md".to_owned()].into());
		assert!(skip.keep.contains("CSE 21/Taken.md") && skip.keep.contains("Mine.md") && skip.keep.contains("CSE 21/Theirs.md"));
		assert!(!skip.keep.contains("CSE 21/Gone.md"));
	}

	#[test]
	fn a_vault_outside_the_linked_folder_skips_nothing() {
		let root = scratch_dir("vault-skip-away");
		let skip = skip_in(&root.join("linked"), &root.join("vault"), &record());
		assert!(skip.dirs.is_empty() && skip.files.is_empty() && skip.keep.is_empty());
	}

	#[test]
	fn a_vault_inside_the_linked_folder_gives_paths_from_the_linked_folder() {
		let root = scratch_dir("vault-skip-inside");
		write(&root, "Notes/CSE 21/Sorting.md", "---\ngodspeed: tpc_1\n---\n");
		let skip = skip_in(&root, &root.join("Notes"), &record());
		assert!(skip.dirs.contains("Notes/CSE 21"));
		assert!(skip.files.contains("Notes/CSE 21/Sorting.md"));
	}
}
