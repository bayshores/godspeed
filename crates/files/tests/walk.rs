//! Folder walk and text-check details the golden cases don't reach.

mod support;

use std::fs;
use std::time::{Duration, SystemTime};

use gs_files::text::TextChecks;
use gs_files::walk::walk_linked_folder;
use support::{TempDir, write};

fn set_modified(file: &std::path::Path, time: SystemTime) {
	fs::File::options().write(true).open(file).unwrap().set_modified(time).unwrap();
}

#[test]
fn a_text_check_is_kept_while_size_and_time_stay_the_same() {
	let dir = TempDir::new();
	let file = dir.path().join("README");
	write(&file, "hello");
	let time = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
	set_modified(&file, time);
	let checks = TextChecks::default();
	assert_eq!(checks.file_looks_like_text(&file), Some(true));

	write(&file, [0u8; 5]);
	set_modified(&file, time);
	assert_eq!(checks.file_looks_like_text(&file), Some(true), "same time and size: the old answer stands");

	set_modified(&file, time + Duration::from_secs(1));
	assert_eq!(checks.file_looks_like_text(&file), Some(false), "a new time means a new look");
}

#[test]
fn a_file_that_cannot_be_checked_says_nothing() {
	let dir = TempDir::new();
	assert_eq!(TextChecks::default().file_looks_like_text(&dir.path().join("gone")), None);
}

#[test]
fn a_walk_does_not_follow_links_and_lists_in_folder_order() {
	let dir = TempDir::new();
	fs::create_dir(dir.path().join("b")).unwrap();
	write(dir.path().join("b/two.txt"), "2");
	write(dir.path().join("a.txt"), "1");
	#[cfg(unix)]
	std::os::unix::fs::symlink("b", dir.path().join("link")).unwrap();
	let walk = walk_linked_folder(dir.path(), &TextChecks::default()).unwrap();
	assert_eq!(walk.files, ["a.txt", "b/two.txt"]);
	assert!(!walk.capped);
}

#[test]
fn a_missing_root_is_an_error_not_an_empty_folder() {
	let dir = TempDir::new();
	let err = walk_linked_folder(&dir.path().join("gone"), &TextChecks::default()).unwrap_err();
	assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
}
