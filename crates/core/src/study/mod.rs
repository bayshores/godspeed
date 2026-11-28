//! Progress, study sessions, homework, deadline plans and cheat sheets.

pub mod progress;
#[expect(clippy::module_inception, reason = "the file that holds the folder's main job carries the folder's name")]
pub mod study;
pub mod continue_study;
pub mod homework;
pub mod deadline_plan;
pub mod cheat_sheet;
pub mod topic_end;
pub mod review;
pub mod topic_parts;
pub mod kept;
pub mod reply_nudges;

mod answers;
mod calibration;
mod derive_progress;
mod fact_progress;
mod path_progress;
mod sheet_cards;
mod sheet_parse;
mod sheet_request;
mod topic_links;
mod work_on_next;

use gs_base::text::cmp16;
use gs_json::Json;

/// The session on `deadline_id` whose `at` field (a time) is the latest; the first one wins a tie.
pub(crate) fn latest_session<'a>(deadline_id: &str, sessions: &'a [Json], at: &str) -> Option<&'a Json> {
	let mut latest: Option<&Json> = None;
	for s in sessions {
		if s["deadlineId"].as_str() == Some(deadline_id) && latest.is_none_or(|l| cmp16(s[at].str_or_empty(), l[at].str_or_empty()).is_gt()) {
			latest = Some(s);
		}
	}
	latest
}
