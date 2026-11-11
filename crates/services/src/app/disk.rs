//! Disk work whose failures are worded like Node's, because the learner or an agent reads them
//! ("Couldn't write to ...: EACCES: permission denied, open '...'").

use std::io::Write;
use std::path::Path;

use gs_base::{fsx, ids, text};

/// `fs.mkdirSync(dir, { recursive: true })`.
pub fn make_dir(dir: &Path) -> Result<(), String> {
	std::fs::create_dir_all(dir).map_err(|err| fsx::node_error_message(&err, "mkdir", dir))
}

/// write-file-atomic.ts: a temp file beside the target, then a rename. The temp file's name is
/// in the error text, which `fsx::write_atomic` does not give.
pub fn write_file_atomic(file: &Path, content: &str) -> Result<(), String> {
	if let Some(dir) = file.parent() {
		make_dir(dir)?;
	}
	let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
	let temp = file.with_file_name(format!("{name}.tmp-{}", &ids::uuid()[..8]));
	let written = std::fs::File::create(&temp)
		.and_then(|mut open| open.write_all(&text::utf8_bytes(content)))
		.map_err(|err| fsx::node_error_message(&err, "open", &temp))
		.and_then(|()| {
			std::fs::rename(&temp, file).map_err(|err| format!("{} -> '{}'", fsx::node_error_message(&err, "rename", &temp), file.display()))
		});
	if written.is_err() {
		let _ = std::fs::remove_file(&temp);
	}
	written
}

/// `fs.rmSync(path, { recursive: true, force: true })`: what can go is removed, and a failure
/// names the path with the OS's own text ("ENOTEMPTY, Directory not empty: '...'").
pub fn remove_all(path: &Path) -> Result<(), String> {
	let Ok(meta) = std::fs::symlink_metadata(path) else { return Ok(()) };
	let removed = if meta.is_dir() {
		for entry in std::fs::read_dir(path).into_iter().flatten().flatten() {
			let _ = remove_all(&entry.path());
		}
		std::fs::remove_dir(path)
	} else {
		std::fs::remove_file(path)
	};
	removed.map_err(|err| {
		let shown = err.to_string();
		let shown = shown.split(" (os error").next().unwrap_or(&shown);
		format!("{}, {shown}: '{}'", fsx::error_code(&err).unwrap_or("UNKNOWN"), path.display())
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::scratch_dir;

	#[test]
	fn atomic_write_makes_parents_and_leaves_no_temp() {
		let d = scratch_dir("disk-write");
		write_file_atomic(&d.join("a/b.txt"), "x").unwrap();
		assert_eq!(std::fs::read_to_string(d.join("a/b.txt")).unwrap(), "x");
		assert_eq!(std::fs::read_dir(d.join("a")).unwrap().count(), 1);
	}

	#[test]
	fn a_blocked_folder_reads_like_node() {
		let d = scratch_dir("disk-blocked");
		write_file_atomic(&d.join("file"), "x").unwrap();
		let err = write_file_atomic(&d.join("file/deeper/inner.txt"), "x").unwrap_err();
		assert!(err.starts_with("ENOTDIR: not a directory, mkdir "), "{err}");
		let err = make_dir(&d.join("file")).unwrap_err();
		assert!(err.starts_with("EEXIST: file already exists, mkdir "), "{err}");
	}

	#[test]
	fn remove_all_takes_a_tree_and_forgives_a_missing_path() {
		let d = scratch_dir("disk-remove");
		write_file_atomic(&d.join("t/u/v.txt"), "x").unwrap();
		remove_all(&d.join("t")).unwrap();
		assert!(!d.join("t").exists());
		remove_all(&d.join("t")).unwrap();
	}
}
