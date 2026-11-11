//! The find tool: files under a folder by glob, as paths from that folder.

use std::path::Path;
use std::sync::Arc;

use gs_engine::turn::abort::Abort;
use gs_engine::turn::tool::Tool;
use gs_json::Json;

use super::fs_shared::{MAX_OUTPUT_BYTES, cap_output, format_size, resolve_source_path, off_thread};
use super::glob::GlobMatcher;
use crate::tools::fn_tool::FnTool;
use gs_core::session::schema::{self, integer, string, string_min};
use super::walk::walk_files;

const DEFAULT_LIMIT: usize = 1000;

pub fn find_tool() -> Arc<dyn Tool> {
	let parameters = schema::object(
		&["pattern"],
		vec![
			("pattern", string_min(1, "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'")),
			("path", string("Directory to search in (default: the learner's home directory)")),
			("limit", integer(1, "Maximum number of results (default: 1000)")),
		],
	);
	FnTool::server(
		"find",
		format!(
			"Search for files by glob pattern. Returns matching file paths relative to the search directory. Ignores node_modules, .git, and Library directories. Output is truncated to {DEFAULT_LIMIT} results or {} (whichever is hit first).",
			format_size(MAX_OUTPUT_BYTES as u64)
		),
		parameters,
		|args, ctx| async move {
			if ctx.abort.is_aborted() {
				return Ok(Json::Str("Operation aborted".to_owned()));
			}
			let dir = resolve_source_path(args["path"].as_str());
			let pattern = args["pattern"].as_str().unwrap_or_default().to_owned();
			let limit = args["limit"].as_i64().map_or(DEFAULT_LIMIT, |l| l.max(0) as usize);
			off_thread(move || find(&dir, &pattern, limit, &ctx.abort)).await
		},
	).into_arc()
}

fn find(dir: &Path, pattern: &str, limit: usize, abort: &Abort) -> Result<Json, String> {
	let shown = dir.display();
	let meta = std::fs::metadata(dir).map_err(|_| format!("Path not found: {shown}"))?;
	if !meta.is_dir() {
		return Err(format!("Not a directory: {shown}"));
	}
	let matcher = GlobMatcher::new(pattern);
	let mut matches: Vec<String> = Vec::new();
	let mut limit_reached = false;
	let walked = walk_files(dir, abort, |_, relative| {
		if !matcher.matches(relative) {
			return false;
		}
		if matches.len() >= limit {
			limit_reached = true;
			return true;
		}
		matches.push(relative.to_owned());
		false
	});

	if walked.aborted {
		return Ok(Json::Str(if matches.is_empty() {
			"Search aborted before any results.".to_owned()
		} else {
			format!("{}\n\n[search aborted \u{2014} partial results]", matches.join("\n"))
		}));
	}
	if matches.is_empty() && !limit_reached {
		return Ok(Json::Str(if walked.timed_out {
			"Search timed out after 10s with no matches yet. Narrow the search to a subdirectory.".to_owned()
		} else {
			"No files found matching pattern".to_owned()
		}));
	}
	let (content, truncated) = cap_output(&matches);
	let mut notices = Vec::new();
	if limit_reached || matches.len() >= limit {
		notices.push(format!("{limit} results limit reached"));
	}
	if truncated {
		notices.push(format!("{} limit reached", format_size(MAX_OUTPUT_BYTES as u64)));
	}
	if walked.timed_out {
		notices.push("search timed out after 10s \u{2014} partial results, narrow the directory".to_owned());
	}
	Ok(Json::Str(if notices.is_empty() { content } else { format!("{content}\n\n[{}]", notices.join(". ")) }))
}
