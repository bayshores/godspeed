//! Shared plumbing for the learner-filesystem tools (ls, find, grep, read). Read-only by
//! construction: relative paths and default roots resolve against the learner's home, and
//! walks never enter the noise folders.

use std::fs::FileType;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use gs_base::{fsx, num, text};

use super::node_path;

/// The output ceiling for every fs tool.
pub const MAX_OUTPUT_BYTES: usize = 50 * 1024;
pub const GREP_MAX_LINE_LENGTH: usize = 500;
/// Wall-clock budget for tree walks (find and grep over a whole home folder).
pub const WALK_TIMEOUT_MS: i64 = 10_000;

/// A path argument: absolute stays, a leading `~` means home, relative or absent means home.
pub fn resolve_source_path(p: Option<&str>) -> PathBuf {
	let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_owned());
	let Some(p) = p.filter(|p| !p.is_empty()) else { return PathBuf::from(home) };
	if p == "~" || p.starts_with("~/") || p.starts_with("~\\") {
		return PathBuf::from(node_path::join(&home, &p[1..]));
	}
	if p.starts_with('/') { PathBuf::from(p) } else { PathBuf::from(node_path::join(&home, p)) }
}

/// 50 KB prints as "50.0KB".
pub fn format_size(bytes: u64) -> String {
	if bytes >= 1024 { format!("{}KB", num::to_fixed(bytes as f64 / 1024.0, 1)) } else { format!("{bytes}B") }
}

/// `Buffer.byteLength(s, "utf-8")`.
pub fn byte_len(s: &str) -> usize {
	text::utf8_bytes(s).len()
}

/// Caps output to `MAX_OUTPUT_BYTES` on whole lines.
pub fn cap_output(lines: &[String]) -> (String, bool) {
	let mut out: Vec<&str> = Vec::new();
	let mut bytes = 0;
	for line in lines {
		let add = byte_len(line) + usize::from(!out.is_empty());
		if bytes + add > MAX_OUTPUT_BYTES {
			return (out.join("\n"), true);
		}
		bytes += add;
		out.push(line);
	}
	(out.join("\n"), false)
}

/// True if the first 8 KB hold a NUL byte (a binary file). Err is Node's message.
pub fn is_binary_file(file: &Path) -> Result<bool, String> {
	let open = std::fs::File::open(file).map_err(|e| fsx::node_error_message(&e, "open", file))?;
	let mut head = Vec::new();
	open.take(8192).read_to_end(&mut head).map_err(|e| read_error(&e, file))?;
	Ok(head.contains(&0))
}

/// A failed read of an open file: Node words it without the path.
pub fn read_error(err: &io::Error, file: &Path) -> String {
	let full = fsx::node_error_message(err, "read", file);
	match full.strip_suffix(&format!(" '{}'", file.display())) {
		Some(without_path) => without_path.to_owned(),
		None => full,
	}
}

/// A line cut to `GREP_MAX_LINE_LENGTH` UTF-16 units.
pub fn truncate_grep_line(line: &str) -> (String, bool) {
	if line.len() <= GREP_MAX_LINE_LENGTH || text::len16(line) <= GREP_MAX_LINE_LENGTH {
		return (line.to_owned(), false);
	}
	(format!("{}\u{2026} [truncated]", text::slice16(line, 0, Some(GREP_MAX_LINE_LENGTH as i64))), true)
}

/// One entry of a folder.
pub struct DirItem {
	pub name: String,
	pub file_type: Option<FileType>,
}

/// A folder's entries in byte order of their names, the order libuv's scandir gives.
pub fn read_dir_items(dir: &Path) -> io::Result<Vec<DirItem>> {
	let mut items = Vec::new();
	for entry in std::fs::read_dir(dir)? {
		let entry = entry?;
		items.push(DirItem { name: entry.file_name().to_string_lossy().into_owned(), file_type: entry.file_type().ok() });
	}
	items.sort_by(|a, b| a.name.cmp(&b.name));
	Ok(items)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sizes_print_like_the_tools() {
		assert_eq!(format_size(0), "0B");
		assert_eq!(format_size(1023), "1023B");
		assert_eq!(format_size(1024), "1.0KB");
		assert_eq!(format_size(MAX_OUTPUT_BYTES as u64), "50.0KB");
		assert_eq!(format_size(2_160_000), "2109.4KB");
	}

	#[test]
	fn paths_resolve_against_home() {
		let home = std::env::var("HOME").unwrap();
		assert_eq!(resolve_source_path(None), PathBuf::from(&home));
		assert_eq!(resolve_source_path(Some("")), PathBuf::from(&home));
		assert_eq!(resolve_source_path(Some("/a/../b/")), PathBuf::from("/a/../b/"));
		assert_eq!(resolve_source_path(Some("x/./y")), PathBuf::from(format!("{home}/x/y")));
		assert_eq!(resolve_source_path(Some("~")), PathBuf::from(&home));
		assert_eq!(resolve_source_path(Some("~/x/../y")), PathBuf::from(format!("{home}/y")));
		assert_eq!(resolve_source_path(Some("~x")), PathBuf::from(format!("{home}/~x")));
	}

	#[test]
	fn output_is_cut_on_whole_lines() {
		let lines: Vec<String> = (0..3).map(|_| "x".repeat(MAX_OUTPUT_BYTES / 2 - 1)).collect();
		let (content, truncated) = cap_output(&lines);
		assert!(truncated);
		assert_eq!(content.lines().count(), 2);
		let (all, truncated) = cap_output(&lines[..1]);
		assert!(!truncated);
		assert_eq!(all, lines[0]);
	}

	#[test]
	fn long_lines_are_cut_in_utf16_units() {
		assert_eq!(truncate_grep_line("short"), ("short".to_owned(), false));
		let (cut, was) = truncate_grep_line(&"y".repeat(501));
		assert!(was);
		assert_eq!(cut, format!("{}\u{2026} [truncated]", "y".repeat(500)));
		// 250 emoji are 500 units: whole. One more is cut inside a pair.
		assert!(!truncate_grep_line(&"\u{1f600}".repeat(250)).1);
		assert!(truncate_grep_line(&"\u{1f600}".repeat(251)).1);
	}
}
