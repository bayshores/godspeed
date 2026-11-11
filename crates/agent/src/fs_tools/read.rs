//! The read tool: a text file by lines (2000 lines or 50 KB at most per call, with a notice
//! saying where to continue) or an image as an attachment the model sees.

use std::io::Read;
use std::path::Path;
use std::sync::Arc;

use gs_base::{fsx, text};
use gs_engine::turn::tool::Tool;
use gs_engine::turn::tool_execute::{Image, ImageFileResult};
use gs_json::Json;

use super::fs_shared::{MAX_OUTPUT_BYTES, format_size, is_binary_file, read_error, resolve_source_path};
use super::node_path::{basename, extname};
use crate::tools::schema::{self, integer, string_min};
use super::server_tool::{off_thread, server_tool};

const MAX_LINES: usize = 2000;

/// Pictures the model can look at, by extension. Learner files are study material, so the
/// extension is enough.
fn image_mime(ext: &str) -> Option<&'static str> {
	Some(match ext {
		".jpg" | ".jpeg" => "image/jpeg",
		".png" => "image/png",
		".gif" => "image/gif",
		".webp" => "image/webp",
		".bmp" => "image/bmp",
		_ => return None,
	})
}

pub fn read_tool() -> Arc<dyn Tool> {
	let parameters = schema::object(
		&["path"],
		vec![
			("path", string_min(1, "Path to the file to read (relative or absolute)")),
			("offset", integer(1, "Line number to start reading from (1-indexed)")),
			("limit", integer(1, "Maximum number of lines to read")),
		],
	);
	server_tool(
		"read",
		"Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50.0KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.".to_owned(),
		parameters,
		|args, _ctx| async move {
			let file = resolve_source_path(args["path"].as_str());
			let (offset, limit) = (args["offset"].as_i64(), args["limit"].as_i64());
			off_thread(move || read(&file, offset, limit)).await
		},
	)
}

fn read(file: &Path, offset: Option<i64>, limit: Option<i64>) -> Result<Json, String> {
	let name = file.to_string_lossy();
	let ext = extname(&name).to_ascii_lowercase();
	let mime = image_mime(&ext);
	// The 8 KB sniff keeps a video from ever being loaded; a PDF's head may have no NUL byte,
	// hence the extension check.
	if mime.is_none() && (ext == ".pdf" || is_binary_file(file)?) {
		let size = std::fs::metadata(file).map_err(|e| fsx::node_error_message(&e, "stat", file))?.len();
		let pdf_hint = if ext == ".pdf" { " For a PDF, dispatch a pdf job if you have that tool." } else { "" };
		return Ok(Json::Str(format!("{} is a binary file ({}), not readable as text.{pdf_hint}", basename(&name), format_size(size))));
	}
	let bytes = read_all(file)?;
	if let Some(mime) = mime {
		let text = format!("Read image file [{mime}] \u{2014} {} ({}), attached as an image.", basename(&name), format_size(bytes.len() as u64));
		return Ok(ImageFileResult { text, images: vec![Image { data: gs_base::base64::encode(&bytes), mime_type: mime.to_owned() }], details: None }.into());
	}
	read_text_slice(&text::from_utf8_lossy(&bytes), offset, limit).map(Json::Str)
}

/// `fs.readFile`: Err is Node's message (a read of a folder has no path in it).
fn read_all(file: &Path) -> Result<Vec<u8>, String> {
	let mut open = std::fs::File::open(file).map_err(|e| fsx::node_error_message(&e, "open", file))?;
	let mut bytes = Vec::new();
	open.read_to_end(&mut bytes).map_err(|e| read_error(&e, file))?;
	Ok(bytes)
}

/// The lines asked for, cut at the 2000-line and 50 KB ceilings with a notice that says where
/// to continue.
fn read_text_slice(content: &str, offset: Option<i64>, limit: Option<i64>) -> Result<String, String> {
	let all: Vec<&str> = content.split('\n').collect();
	let total = all.len();
	let start = offset.map_or(0, |o| (o - 1).max(0) as usize);
	if start >= total {
		return Err(format!("Offset {} is beyond end of file ({total} lines total)", offset.unwrap_or(0)));
	}
	// An explicit limit first (never beyond the end), then the line ceiling.
	let end = limit.map_or(total, |l| total.min(start.saturating_add(l.max(0) as usize)));
	let mut selected = &all[start..end];
	let mut truncated_by = None;
	if selected.len() > MAX_LINES {
		selected = &selected[..MAX_LINES];
		truncated_by = Some("lines");
	}
	// Then the byte ceiling: the most lines whose join fits.
	let joined_bytes = |lines: &[&str]| lines.iter().map(|l| l.len()).sum::<usize>() + lines.len().saturating_sub(1);
	if joined_bytes(selected) > MAX_OUTPUT_BYTES {
		let mut keep = selected.len();
		while keep > 0 && joined_bytes(&selected[..keep]) > MAX_OUTPUT_BYTES {
			keep -= 1;
		}
		selected = &selected[..keep];
		truncated_by = Some("bytes");
	}
	let limit_text = format_size(MAX_OUTPUT_BYTES as u64);
	if selected.is_empty() {
		// One line is over the cap by itself: show its head (cut on a UTF-8 boundary) and point
		// past it, so the next read never repeats.
		let line = all[start].as_bytes();
		let mut cut = MAX_OUTPUT_BYTES;
		while cut > 0 && (line[cut] & 0xc0) == 0x80 {
			cut -= 1;
		}
		let next = if start + 1 < total { format!(" Use offset={} to continue.]", start + 2) } else { "]".to_owned() };
		return Ok(format!(
			"{}\n\n[Line {} is {}, over the {limit_text} limit; showing its first {limit_text}.{next}",
			text::from_utf8_lossy(&line[..cut]),
			start + 1,
			format_size(line.len() as u64)
		));
	}
	let body = selected.join("\n");
	let shown_to = start + selected.len();
	Ok(match truncated_by {
		None if total > shown_to => format!("{body}\n\n[{} more lines in file. Use offset={} to continue.]", total - shown_to, shown_to + 1),
		None => body,
		Some(why) => {
			let reason = if why == "lines" { format!("{MAX_LINES} line limit") } else { format!("{limit_text} limit") };
			format!("{body}\n\n[Showing lines {}-{shown_to} of {total} ({reason}). Use offset={} to continue.]", start + 1, shown_to + 1)
		}
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_short_file_comes_back_whole() {
		assert_eq!(read_text_slice("a\nb\nc", None, None).unwrap(), "a\nb\nc");
	}

	#[test]
	fn offset_and_limit_say_where_to_continue() {
		assert_eq!(read_text_slice("a\nb\nc\nd", Some(2), Some(2)).unwrap(), "b\nc\n\n[1 more lines in file. Use offset=4 to continue.]");
		assert_eq!(read_text_slice("a\nb", Some(3), None).unwrap_err(), "Offset 3 is beyond end of file (2 lines total)");
	}

	#[test]
	fn a_trailing_newline_counts_an_empty_last_line() {
		assert_eq!(read_text_slice("a\n", None, None).unwrap(), "a\n");
		assert_eq!(read_text_slice("a\n", Some(2), None).unwrap(), "");
	}

	#[test]
	fn two_thousand_lines_is_the_ceiling() {
		let content = (1..=2500).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
		let out = read_text_slice(&content, None, None).unwrap();
		assert!(out.ends_with("2000\n\n[Showing lines 1-2000 of 2500 (2000 line limit). Use offset=2001 to continue.]"));
	}

	#[test]
	fn fifty_kb_is_the_other_ceiling() {
		let content = vec!["x".repeat(999); 100].join("\n");
		let out = read_text_slice(&content, None, None).unwrap();
		assert!(out.ends_with("\n\n[Showing lines 1-51 of 100 (50.0KB limit). Use offset=52 to continue.]"));
	}

	#[test]
	fn one_huge_line_shows_its_head_and_points_past_it() {
		let content = format!("{}\nnext", "\u{e9}".repeat(40_000));
		let out = read_text_slice(&content, None, None).unwrap();
		let (head, notice) = out.split_once("\n\n[").unwrap();
		assert_eq!(head.chars().count(), 25_600);
		assert_eq!(notice, "Line 1 is 78.1KB, over the 50.0KB limit; showing its first 50.0KB. Use offset=2 to continue.]");
		let last = read_text_slice(&"y".repeat(60_000), None, None).unwrap();
		assert!(last.ends_with("showing its first 50.0KB.]"));
	}
}
