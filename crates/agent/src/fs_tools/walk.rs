//! Depth-first walk under a folder for find and grep.

use std::path::{MAIN_SEPARATOR, Path};

use gs_base::clock;
use gs_base::config::resolve;
use gs_engine::turn::abort::Abort;

use super::fs_shared::{WALK_TIMEOUT_MS, read_dir_items};

/// Folders never entered: dependencies and repository data, and the home folder's caches, app
/// support and trash. Only walks skip them; naming one as the path is allowed.
const EXCLUDED_DIR_NAMES: [&str; 4] = ["node_modules", ".git", "Library", ".Trash"];

/// Why a walk ended early.
pub(super) struct Walked {
	pub timed_out: bool,
	pub aborted: bool,
}

struct Walk<'a, F> {
	abort: &'a Abort,
	deadline: i64,
	visit: F,
	out: Walked,
}

/// Visits every file under `root` (symlinks and other kinds are not followed) with its full
/// path (this OS's separators) and its path from `root` (`/` separators). `visit` returns true to stop. The walk
/// stops by itself after `WALK_TIMEOUT_MS` or when the abort fires, keeping what it found.
pub fn walk_files(root: &Path, abort: &Abort, visit: impl FnMut(&str, &str) -> bool) -> Walked {
	let mut walk = Walk { abort, deadline: clock::now_ms() + WALK_TIMEOUT_MS, visit, out: Walked { timed_out: false, aborted: false } };
	if abort.is_aborted() {
		walk.out.aborted = true;
		return walk.out;
	}
	// Paths below the root are joined the way path.join does, which settles `..` in the root.
	let base = resolve(root).to_string_lossy().into_owned();
	walk.dir(root, base.trim_end_matches(MAIN_SEPARATOR), "");
	walk.out
}

impl<F: FnMut(&str, &str) -> bool> Walk<'_, F> {
	/// True when the walk must stop.
	fn stop(&mut self) -> bool {
		if clock::now_ms() > self.deadline {
			self.out.timed_out = true;
			return true;
		}
		if self.abort.is_aborted() {
			self.out.aborted = true;
			return true;
		}
		false
	}

	/// `read_from` is the folder as the OS opens it, `dir` as its files are named.
	fn dir(&mut self, read_from: &Path, dir: &str, relative: &str) -> bool {
		if self.stop() {
			return true;
		}
		// An unreadable folder is skipped.
		let Ok(items) = read_dir_items(read_from) else { return false };
		for item in items {
			if self.stop() {
				return true;
			}
			let full = format!("{dir}{MAIN_SEPARATOR}{}", item.name);
			let below = if relative.is_empty() { item.name.clone() } else { format!("{relative}/{}", item.name) };
			let Some(kind) = item.file_type else { continue };
			if kind.is_dir() {
				if EXCLUDED_DIR_NAMES.contains(&item.name.as_str()) {
					continue;
				}
				if self.dir(Path::new(&full), &full, &below) {
					return true;
				}
			} else if kind.is_file() && (self.visit)(&full, &below) {
				return true;
			}
		}
		false
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::fs_tools::tests::TempDir;

	fn collect(root: &Path, abort: &Abort) -> (Vec<String>, Walked) {
		let mut seen = Vec::new();
		let out = walk_files(root, abort, |_, rel| {
			seen.push(rel.to_owned());
			false
		});
		(seen, out)
	}

	#[cfg(unix)]
	#[test]
	fn walks_in_name_order_and_skips_noise_and_links() {
		let dir = TempDir::new("walk");
		dir.put("b.txt", "");
		dir.put("a/z.txt", "");
		dir.put("a/node_modules/skip.txt", "");
		dir.put(".git/config", "");
		dir.put("Library/skip.txt", "");
		dir.put(".Trash/skip.txt", "");
		dir.link("b.txt", "link.txt");
		dir.link("a", "linked-dir");
		let (seen, out) = collect(dir.path(), &Abort::new());
		assert_eq!(seen, ["a/z.txt", "b.txt"]);
		assert!(!out.timed_out && !out.aborted);
	}

	#[cfg(unix)]
	#[test]
	fn the_root_may_be_a_noise_folder_and_a_link() {
		let dir = TempDir::new("walk-root");
		dir.put("node_modules/skip.txt", "");
		dir.link("node_modules", "to-modules");
		assert_eq!(collect(&dir.path().join("node_modules"), &Abort::new()).0, ["skip.txt"]);
		assert_eq!(collect(&dir.path().join("to-modules"), &Abort::new()).0, ["skip.txt"]);
	}

	#[test]
	fn a_visit_can_stop_the_walk() {
		let dir = TempDir::new("walk-stop");
		dir.put("a.txt", "");
		dir.put("b.txt", "");
		let mut count = 0;
		walk_files(dir.path(), &Abort::new(), |_, _| {
			count += 1;
			true
		});
		assert_eq!(count, 1);
	}

	#[test]
	fn an_abort_ends_the_walk_with_what_it_has() {
		let dir = TempDir::new("walk-abort");
		dir.put("a.txt", "");
		let abort = Abort::new();
		abort.abort();
		let (seen, out) = collect(dir.path(), &abort);
		assert!(seen.is_empty() && out.aborted);
	}

	#[test]
	fn unicode_names_and_unreadable_folders() {
		let dir = TempDir::new("walk-unicode");
		dir.put("日本語/ファイル.txt", "");
		dir.put("emoji \u{1f393}.txt", "");
		let (seen, _) = collect(dir.path(), &Abort::new());
		assert_eq!(seen, ["emoji \u{1f393}.txt", "日本語/ファイル.txt"]);
		assert!(collect(&dir.path().join("missing"), &Abort::new()).0.is_empty());
	}
}
