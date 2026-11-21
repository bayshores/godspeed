//! Which supported files a linked space folder holds.

use std::collections::HashSet;
use std::fs::DirEntry;
use std::io;
use std::path::Path;

use gs_base::locale;
use gs_core::contracts::space::{MAX_LINKED_FILES, extension_of};

use crate::text::{TextChecks, is_readable_space_file};

/// Google Docs, Sheets, Slides and the like on a synced Drive: small link files whose contents
/// live online.
const GOOGLE_STUB_EXTENSIONS: [&str; 8] = [".gdoc", ".gsheet", ".gslides", ".gdraw", ".gform", ".gsite", ".gmap", ".gjam"];

/// Names kept for files a folder holds that can't be read.
const SKIPPED_EXAMPLES: usize = 3;

/// Folders never walked inside a linked space folder.
const SKIPPED_DIRS: [&str; 4] = ["node_modules", ".git", "Library", ".Trash"];

/// A linked folder's files that can't be read: how many, a few names, and how many are Google
/// Docs/Sheets/Slides links.
#[derive(Debug, Default, PartialEq)]
pub struct SkippedFiles {
	pub count: usize,
	pub examples: Vec<String>,
	pub google: usize,
}

/// What a walk leaves out on top of its own rules, as POSIX-style paths relative to the root:
/// the vault's notes folders and the notes godspeed wrote, whose facts are already in the graph.
/// A path in `keep` is read anyway, even inside a skipped folder.
#[derive(Debug, Default)]
pub struct Skip {
	pub dirs: HashSet<String>,
	pub files: HashSet<String>,
	pub keep: HashSet<String>,
}

impl Skip {
	fn keeps_inside(&self, dir: &str) -> bool {
		self.keep.iter().any(|k| k.strip_prefix(dir).is_some_and(|rest| rest.starts_with('/')))
	}

	fn file_is_skipped(&self, rel: &str, inside_skipped_dir: bool) -> bool {
		(inside_skipped_dir || self.files.contains(rel)) && !self.keep.contains(rel)
	}
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
pub fn walk_linked_folder(root: &Path, checks: &TextChecks, skip: &Skip) -> io::Result<Walk> {
	let mut walk = Walk::default();
	visit(root, "", &Mode::Linked { checks, skip }, false, &mut walk)?;
	Ok(walk)
}

/// Every Markdown file under `root`, at most `max`, by the same rules for hidden files and noise
/// folders. Used to read an Obsidian vault, which has no supported-file or text checks to make.
pub fn walk_markdown(root: &Path, max: usize) -> io::Result<Walk> {
	let mut walk = Walk::default();
	visit(root, "", &Mode::Markdown { max }, false, &mut walk)?;
	Ok(walk)
}

enum Mode<'a> {
	Linked { checks: &'a TextChecks, skip: &'a Skip },
	Markdown { max: usize },
}

fn visit(dir: &Path, rel: &str, mode: &Mode, in_skipped: bool, walk: &mut Walk) -> io::Result<()> {
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
			if SKIPPED_DIRS.contains(&name.as_str()) {
				continue;
			}
			let in_skipped = match mode {
				// Inside a skipped folder only the kept notes are read, so a folder holding none is not entered.
				Mode::Linked { skip, .. } if skip.dirs.contains(&child_rel) => {
					if !skip.keeps_inside(&child_rel) {
						continue;
					}
					true
				}
				_ => in_skipped,
			};
			visit(&entry.path(), &child_rel, mode, in_skipped, walk)?;
		} else if kind.is_file() {
			match mode {
				Mode::Markdown { max } => {
					if extension_of(&name) != ".md" {
						continue;
					}
					if walk.files.len() == *max {
						walk.capped = true;
					} else {
						walk.files.push(child_rel);
					}
				}
				Mode::Linked { checks, skip } => {
					if skip.file_is_skipped(&child_rel, in_skipped) {
						continue;
					}
					match is_readable_space_file(&name, || checks.file_looks_like_text(&entry.path())) {
						None => walk.unreadable.push(child_rel),
						Some(false) => skip_unreadable(&name, walk),
						Some(true) if walk.files.len() == MAX_LINKED_FILES => walk.capped = true,
						Some(true) => walk.files.push(child_rel),
					}
				}
			}
		}
	}
	Ok(())
}

fn skip_unreadable(name: &str, walk: &mut Walk) {
	let skipped = &mut walk.skipped;
	skipped.count += 1;
	if GOOGLE_STUB_EXTENSIONS.contains(&extension_of(name).as_str()) {
		skipped.google += 1;
	}
	if skipped.examples.len() < SKIPPED_EXAMPLES {
		skipped.examples.push(name.to_owned());
	}
}
