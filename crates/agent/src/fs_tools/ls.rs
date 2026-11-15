//! The ls tool: one folder's entries, sorted without regard to case, folders marked with `/`.

use std::path::Path;
use std::sync::Arc;

use gs_base::{fsx, locale};
use gs_engine::turn::tool::Tool;
use gs_json::Json;

use super::fs_shared::{cap_output, existing_dir, off_thread, output_limit, read_dir_items, resolve_source_path};
use super::protected::{Protected, real_path};
use crate::tools::fn_tool::FnTool;
use gs_core::session::schema::{self, integer, string};

const DEFAULT_LIMIT: usize = 500;

pub fn ls_tool() -> Arc<dyn Tool> {
	let parameters = schema::object(
		&[],
		vec![
			("path", string("Directory to list (default: the learner's home directory)")),
			("limit", integer(1, "Maximum number of entries to return (default: 500)")),
		],
	);
	FnTool::server(
		"ls",
		format!(
			"List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to {DEFAULT_LIMIT} entries or {} (whichever is hit first).",
			output_limit()
		),
		parameters,
		|args, _ctx| async move {
			let given = args["path"].str_or_empty().to_owned();
			let dir = resolve_source_path(args["path"].as_str());
			let limit = args["limit"].as_i64().map_or(DEFAULT_LIMIT, |l| l.max(0) as usize);
			off_thread(move || {
				let guard = Protected::current();
				guard.refuse(&given, &dir)?;
				list(&dir, limit, &guard)
			}).await
		},
	).into_arc()
}

fn list(dir: &Path, limit: usize, guard: &Protected) -> Result<Json, String> {
	existing_dir(dir)?;
	let mut entries = read_dir_items(dir).map_err(|e| format!("Cannot read directory: {}", fsx::node_error_message(&e, "scandir", dir)))?;
	// Case-insensitive; names that differ only in case keep their byte order.
	entries.sort_by(|a, b| locale::compare(&a.name.to_lowercase(), &b.name.to_lowercase()));

	let mut lines: Vec<String> = Vec::new();
	let mut limit_reached = false;
	let real_dir = real_path(dir);
	for entry in &entries {
		if guard.hides(&real_dir.join(&entry.name)) {
			continue;
		}
		if lines.len() >= limit {
			limit_reached = true;
			break;
		}
		// An entry that cannot be statted is left out.
		if let Ok(meta) = std::fs::metadata(dir.join(&entry.name)) {
			lines.push(if meta.is_dir() { format!("{}/", entry.name) } else { entry.name.clone() });
		}
	}
	if lines.is_empty() {
		return Ok(Json::Str("Directory is empty".to_owned()));
	}
	let (content, truncated) = cap_output(&lines);
	let mut notices = Vec::new();
	if limit_reached {
		notices.push(format!("{limit} entries limit"));
	}
	if truncated {
		notices.push(format!("{} limit", output_limit()));
	}
	Ok(Json::Str(if notices.is_empty() { content } else { format!("{content}\n\n[Truncated: {}]", notices.join(", ")) }))
}
