//! The learner's saved prompt segments,
//! one .md file each under the prompts folder, mirroring the source layout.
//!
//! A path outside that layout is refused (nothing read, written or deleted).

use std::path::Path;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_core::records::prompt_segments::is_valid_segment_path;

pub struct PromptOverrides {
	paths: Paths,
}

impl PromptOverrides {
	pub fn new(paths: &Paths) -> PromptOverrides {
		PromptOverrides { paths: paths.clone() }
	}

	/// The segment paths that have an override file, sorted.
	pub fn list_overrides(&self) -> Vec<String> {
		let mut found = Vec::new();
		walk(&self.paths.prompts_dir, "", &mut found);
		found.sort();
		found
	}

	pub fn read_override(&self, segment_path: &str) -> Option<String> {
		if !is_valid_segment_path(segment_path) {
			return None;
		}
		fsx::read_text(&self.paths.prompt_override_file(segment_path)).ok()
	}

	/// Err when the file cannot be written; a bad path writes nothing and is not an error.
	pub fn write_override(&self, segment_path: &str, text: &str) -> Result<(), String> {
		if !is_valid_segment_path(segment_path) {
			return Ok(());
		}
		let file = self.paths.prompt_override_file(segment_path);
		fsx::write_text_atomic(&file, text).map_err(|err| fsx::node_error_message(&err, "open", &file))
	}

	/// Already absent counts as done.
	pub fn delete_override(&self, segment_path: &str) {
		if is_valid_segment_path(segment_path) {
			let _ = std::fs::remove_file(self.paths.prompt_override_file(segment_path));
		}
	}
}

/// Every .md file below `dir` (symlinks are not followed) whose relative path is a valid segment.
fn walk(dir: &Path, prefix: &str, found: &mut Vec<String>) {
	let Ok(entries) = std::fs::read_dir(dir) else { return };
	for entry in entries.flatten() {
		let name = entry.file_name().to_string_lossy().into_owned();
		let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
		match entry.file_type() {
			Ok(kind) if kind.is_dir() => walk(&dir.join(&name), &rel, found),
			Ok(kind) if kind.is_file() && name.ends_with(".md") && is_valid_segment_path(&rel) => found.push(rel),
			_ => {}
		}
	}
}
