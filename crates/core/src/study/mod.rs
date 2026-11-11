//! Progress, study sessions, homework, deadline plans and cheat sheets.

pub mod progress;
pub mod study;
pub mod continue_study;
pub mod homework;
pub mod deadline_plan;
pub mod cheat_sheet;

mod answers;
mod calibration;
mod derive_progress;
mod fact_progress;
mod sheet_cards;
mod sheet_parse;
mod sheet_request;
mod topic_links;
mod work_on_next;

use gs_base::text::cmp16;
use gs_json::Json;

/// The items of a JSON array; none for anything else.
pub(crate) fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

/// The session on `deadline_id` created last (the first one wins a tie).
pub(crate) fn latest_session<'a>(deadline_id: &str, sessions: &'a [Json]) -> Option<&'a Json> {
	let mut latest: Option<&Json> = None;
	for s in sessions {
		if s["deadlineId"].as_str() == Some(deadline_id) && latest.is_none_or(|l| cmp16(s["createdAt"].as_str().unwrap_or(""), l["createdAt"].as_str().unwrap_or("")).is_gt()) {
			latest = Some(s);
		}
	}
	latest
}
