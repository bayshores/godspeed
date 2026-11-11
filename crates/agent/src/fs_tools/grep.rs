//! The grep tool: a pattern searched in one file or under a folder, as `path:LINE: text` lines
//! with optional `path-LINE- text` context.

use std::path::Path;
use std::sync::Arc;

use gs_base::re::{self, Re};
use gs_base::posix::basename;
use gs_base::regexp::new_regexp;
use gs_base::{clock, text};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::tool::Tool;
use gs_json::Json;

use super::fs_shared::{GREP_MAX_LINE_LENGTH, MAX_OUTPUT_BYTES, WALK_TIMEOUT_MS, byte_len, format_size, is_binary_file, resolve_source_path, truncate_grep_line, off_thread};
use super::glob::GlobMatcher;
use crate::tools::fn_tool::FnTool;
use gs_core::session::schema::{self, boolean, integer, string, string_min};
use super::walk::walk_files;

const DEFAULT_LIMIT: usize = 100;
/// Bigger files are skipped in a walk, and named by a message when asked for directly.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub fn grep_tool() -> Arc<dyn Tool> {
	let parameters = schema::object(
		&["pattern"],
		vec![
			("pattern", string_min(1, "Search pattern (regex or literal string)")),
			("path", string("Directory or file to search (default: the learner's home directory)")),
			("glob", string("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'")),
			("ignoreCase", boolean("Case-insensitive search (default: false)")),
			("literal", boolean("Treat pattern as literal string instead of regex (default: false)")),
			("context", integer(0, "Number of lines to show before and after each match (default: 0)")),
			("limit", integer(1, "Maximum number of matches to return (default: 100)")),
		],
	);
	FnTool::server(
		"grep",
		format!(
			"Search file contents for a pattern. Returns matching lines with file paths and line numbers. Ignores node_modules, .git, and Library directories. Output is truncated to {DEFAULT_LIMIT} matches or {} (whichever is hit first). Long lines are truncated to {GREP_MAX_LINE_LENGTH} chars.",
			format_size(MAX_OUTPUT_BYTES as u64)
		),
		parameters,
		|args, ctx| async move {
			if ctx.abort.is_aborted() {
				return Ok(Json::Str("Operation aborted".to_owned()));
			}
			let request = Request {
				path: resolve_source_path(args["path"].as_str()),
				pattern: args["pattern"].as_str().unwrap_or_default().to_owned(),
				glob: args["glob"].as_str().filter(|g| !g.is_empty()).map(str::to_owned),
				ignore_case: args["ignoreCase"].truthy(),
				literal: args["literal"].truthy(),
				context: args["context"].as_i64().map_or(0, |c| c.max(0) as usize),
				limit: args["limit"].as_i64().map_or(DEFAULT_LIMIT, |l| l.max(1) as usize),
			};
			off_thread(move || grep(&request, &ctx.abort)).await
		},
	).into_arc()
}

struct Request {
	path: std::path::PathBuf,
	pattern: String,
	glob: Option<String>,
	ignore_case: bool,
	literal: bool,
	context: usize,
	limit: usize,
}

/// A file to scan: where it is, and how its matches are named.
struct Target {
	full: String,
	name: String,
}

fn grep(req: &Request, abort: &Abort) -> Result<Json, String> {
	let shown = req.path.display();
	let meta = std::fs::metadata(&req.path).map_err(|_| format!("Path not found: {shown}"))?;
	let is_directory = meta.is_dir();

	let source = if req.literal { re::escape(&req.pattern) } else { req.pattern.clone() };
	let regex = new_regexp(&source, if req.ignore_case { "i" } else { "" })?;

	let mut targets: Vec<Target> = Vec::new();
	let (mut timed_out, mut aborted) = (false, false);
	if is_directory {
		let glob = req.glob.as_deref().map(GlobMatcher::new);
		let walked = walk_files(&req.path, abort, |full, relative| {
			if glob.as_ref().is_none_or(|g| g.matches(relative)) {
				targets.push(Target { full: full.to_owned(), name: relative.to_owned() });
			}
			false
		});
		(timed_out, aborted) = (walked.timed_out, walked.aborted);
	} else {
		// A file the model named gets a reason, not a false "No matches found" (the silent
		// skips below are for walks).
		if meta.len() > MAX_FILE_BYTES {
			return Ok(Json::Str(format!("File is {}, over the {} grep limit. Use read with offset/limit instead.", format_size(meta.len()), format_size(MAX_FILE_BYTES))));
		}
		if is_binary_file(&req.path).unwrap_or(true) {
			return Ok(Json::Str("Binary file, not searched. For a PDF, dispatch a pdf job if you have that tool.".to_owned()));
		}
		let full = req.path.to_string_lossy().into_owned();
		targets.push(Target { name: basename(&full).to_owned(), full });
	}

	let mut scan = Scan { req, regex: &regex, out: Vec::new(), out_bytes: 0, output_capped: false, match_count: 0, limit_reached: false, lines_truncated: false };
	// The walk's deadline only bounds collecting; reading every collected file could run for
	// minutes, so the scan has the same budget, checked per file.
	let scan_deadline = clock::now_ms() + WALK_TIMEOUT_MS;
	let mut scan_timed_out = false;
	for target in &targets {
		if abort.is_aborted() {
			aborted = true;
			break;
		}
		if clock::now_ms() > scan_deadline {
			scan_timed_out = true;
			break;
		}
		if scan.match_count >= req.limit {
			scan.limit_reached = true;
			break;
		}
		scan.file(target);
		if scan.limit_reached || scan.output_capped {
			break;
		}
	}
	Ok(Json::Str(scan.finish(aborted, timed_out || scan_timed_out)))
}

/// The matches found so far, capped while collecting so wide context never piles up past 50 KB.
struct Scan<'a> {
	req: &'a Request,
	regex: &'a Re,
	out: Vec<String>,
	out_bytes: usize,
	output_capped: bool,
	match_count: usize,
	limit_reached: bool,
	lines_truncated: bool,
}

impl Scan<'_> {
	fn file(&mut self, target: &Target) {
		let Some(content) = read_searchable(Path::new(&target.full)) else { return };
		let lines: Vec<&str> = content.split('\n').collect();
		for (i, line) in lines.iter().enumerate() {
			if self.output_capped {
				break;
			}
			if !self.regex.test(line) {
				continue;
			}
			if self.match_count >= self.req.limit {
				self.limit_reached = true;
				break;
			}
			self.match_count += 1;
			let number = i + 1;
			let (start, end) = if self.req.context > 0 { (number.saturating_sub(self.req.context).max(1), (number + self.req.context).min(lines.len())) } else { (number, number) };
			for current in start..=end {
				let (shown, was_truncated) = truncate_grep_line(lines.get(current - 1).copied().unwrap_or(""));
				self.lines_truncated |= was_truncated;
				// `:` marks the match, `-` its context.
				let out_line = if current == number { format!("{}:{current}: {shown}", target.name) } else { format!("{}-{current}- {shown}", target.name) };
				let add = byte_len(&out_line) + usize::from(!self.out.is_empty());
				if self.out_bytes + add > MAX_OUTPUT_BYTES {
					self.output_capped = true;
					break;
				}
				self.out_bytes += add;
				self.out.push(out_line);
			}
		}
	}

	fn finish(&self, aborted: bool, timed_out: bool) -> String {
		if aborted {
			return if self.out.is_empty() { "Search aborted before any results.".to_owned() } else { format!("{}\n\n[search aborted \u{2014} partial results]", self.out.join("\n")) };
		}
		if self.out.is_empty() {
			return if timed_out { "Search timed out after 10s with no matches yet. Narrow the search to a subdirectory.".to_owned() } else { "No matches found".to_owned() };
		}
		let mut notices = Vec::new();
		if self.limit_reached || self.match_count >= self.req.limit {
			notices.push(format!("{} matches limit reached", self.req.limit));
		}
		if self.lines_truncated {
			notices.push(format!("Some lines truncated to {GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines"));
		}
		if self.output_capped {
			notices.push(format!("{} limit reached", format_size(MAX_OUTPUT_BYTES as u64)));
		}
		if timed_out {
			notices.push("search timed out after 10s \u{2014} partial results, narrow the directory".to_owned());
		}
		let content = self.out.join("\n");
		if notices.is_empty() { content } else { format!("{content}\n\n[{}]", notices.join(". ")) }
	}
}

/// The file's lines joined by `\n` (any line ending), or None when it is gone, over the size
/// cap, binary or unreadable: a walk skips those without a word.
fn read_searchable(file: &Path) -> Option<String> {
	let size = std::fs::metadata(file).ok()?.len();
	if size > MAX_FILE_BYTES || is_binary_file(file).unwrap_or(true) {
		return None;
	}
	let content = text::from_utf8_lossy(&std::fs::read(file).ok()?);
	Some(content.replace("\r\n", "\n").replace('\r', "\n"))
}
