//! Which supported files a linked class folder holds.

use std::fs::DirEntry;
use std::io;
use std::path::Path;

use gs_base::locale;
use gs_core::contracts::class::{MAX_LINKED_FILES, extension_of};

use crate::text::{TextChecks, is_readable_class_file};

/// Google Docs, Sheets, Slides and the like on a synced Drive: small link files whose contents
/// live online.
const GOOGLE_STUB_EXTENSIONS: [&str; 8] = [".gdoc", ".gsheet", ".gslides", ".gdraw", ".gform", ".gsite", ".gmap", ".gjam"];

/// Names kept for files a folder holds that can't be read.
const SKIPPED_EXAMPLES: usize = 3;

/// Folders never walked inside a linked class folder.
const SKIPPED_DIRS: [&str; 4] = ["node_modules", ".git", "Library", ".Trash"];

/// A linked folder's files that can't be read: how many, a few names, and how many are Google
/// Docs/Sheets/Slides links.
#[derive(Debug, Default, PartialEq)]
pub struct SkippedFiles {
	pub count: usize,
	pub examples: Vec<String>,
	pub google: usize,
}

#[derive(Debug, Default, PartialEq)]
pub struct Walk {
	/// Supported files as POSIX-style relative paths, folder by folder in name order.
	pub files: Vec<String>,
	/// The walk stopped at `MAX_LINKED_FILES` with more left.
	pub capped: bool,
	/// Subfolders (and files that couldn't be checked) that couldn't be read.
	pub unreadable: Vec<String>,
	pub skipped: SkippedFiles,
}

/// Every supported file under `root`. Hidden files, lock files, editor backups ("notes.md~") and
/// noise folders are passed over; other files that can't be read are counted in `skipped`. An
/// unreadable folder is not an empty one: the walk fails when the root can't be read (the error
/// is for the caller to word, as `scandir`), and lists unreadable subfolders in `unreadable`.
pub fn walk_linked_folder(root: &Path, checks: &TextChecks) -> io::Result<Walk> {
	let mut walk = Walk::default();
	visit(root, "", checks, &mut walk)?;
	Ok(walk)
}

fn visit(dir: &Path, rel: &str, checks: &TextChecks, walk: &mut Walk) -> io::Result<()> {
	let entries = match std::fs::read_dir(dir).and_then(|it| it.collect::<io::Result<Vec<DirEntry>>>()) {
		Ok(entries) => entries,
		Err(err) if rel.is_empty() => return Err(err),
		Err(_) => {
			walk.unreadable.push(rel.to_owned());
			return Ok(());
		}
	};
	let mut named: Vec<(String, DirEntry)> = entries.into_iter().map(|e| (e.file_name().to_string_lossy().into_owned(), e)).collect();
	named.sort_by(|a, b| locale::compare(&a.0, &b.0));
	for (name, entry) in named {
		if walk.capped {
			return Ok(());
		}
		// Hidden files (where Drive and editors keep temporary ones), Office lock files and editor backups.
		if name.starts_with('.') || name.starts_with("~$") || name.ends_with('~') {
			continue;
		}
		let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
		let Ok(kind) = entry.file_type() else { continue };
		if kind.is_dir() {
			if !SKIPPED_DIRS.contains(&name.as_str()) {
				visit(&entry.path(), &child_rel, checks, walk)?;
			}
		} else if kind.is_file() {
			match is_readable_class_file(&name, || checks.file_looks_like_text(&entry.path())) {
				None => walk.unreadable.push(child_rel),
				Some(false) => skip(&name, walk),
				Some(true) if walk.files.len() == MAX_LINKED_FILES => walk.capped = true,
				Some(true) => walk.files.push(child_rel),
			}
		}
	}
	Ok(())
}

fn skip(name: &str, walk: &mut Walk) {
	let skipped = &mut walk.skipped;
	skipped.count += 1;
	if GOOGLE_STUB_EXTENSIONS.contains(&extension_of(name).as_str()) {
		skipped.google += 1;
	}
	if skipped.examples.len() < SKIPPED_EXAMPLES {
		skipped.examples.push(name.to_owned());
	}
}
