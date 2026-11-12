//! Files new to a space: the kind one gets when it arrives, and how long a file a folder scan
//! found counts as new.

use std::collections::{HashMap, HashSet};

use gs_json::Json;

use super::file_series::group_file_series;

/// How long an arrived file counts as new (the Files page's New mark, the sidebar dot, the
/// agent's [Today] note), in days.
pub const NEW_FILE_DAYS: i64 = 3;

/// How long an added or removed file shows in the Files page's Recent changes (and a removed one
/// stays on the space record), in days.
pub const RECENT_CHANGE_DAYS: i64 = 14;

/// Whether an ISO time is within RECENT_CHANGE_DAYS of `now` (false for unreadable times, as
/// NaN compares false).
pub fn is_recent_change(at: &str, now: i64) -> bool {
	gs_base::time::parse_date(at).is_some_and(|t| now - t <= RECENT_CHANGE_DAYS * 86_400_000)
}

/// Whether the time is within the last NEW_FILE_DAYS.
pub fn is_recent(at: Option<&str>, now: i64) -> bool {
	at.and_then(gs_base::time::parse_date).is_some_and(|t| now - t <= NEW_FILE_DAYS * 86_400_000)
}

/// The kind a file new to a space gets: the kind of the series it joins (HW5 joins HW1 to 4,
/// which are space info), when that series' files all share one kind. Otherwise study
/// material. Keyed by file id.
pub fn kinds_for_new_files(existing: &[Json], added: &[Json]) -> HashMap<String, String> {
	let id_of = |f: &Json| f["id"].as_str().unwrap_or("").to_owned();
	let mut kinds: HashMap<String, String> = added.iter().map(|f| (id_of(f), "study".to_owned())).collect();
	if added.is_empty() {
		return kinds;
	}
	let known: HashMap<String, &str> = existing.iter().map(|f| (id_of(f), f["kind"].as_str().unwrap_or(""))).collect();
	let all: Vec<Json> = existing.iter().chain(added).cloned().collect();
	let (series, _) = group_file_series(&all);
	for s in series {
		let members: Vec<String> = s.items.iter().flat_map(|i| i.files.iter().map(|&at| id_of(&all[at]))).collect();
		let old: HashSet<&str> = members.iter().filter_map(|id| known.get(id).copied()).collect();
		let Some(kind) = old.iter().next().filter(|_| old.len() == 1) else { continue };
		for id in members {
			if let Some(slot) = kinds.get_mut(&id) {
				*slot = (*kind).to_owned();
			}
		}
	}
	kinds
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn a_new_homework_joins_the_kind_of_its_series() {
		let existing = vec![json!({ "id": "a", "name": "HW1.pdf", "kind": "info" }), json!({ "id": "b", "name": "HW2.pdf", "kind": "info" })];
		let added = vec![json!({ "id": "c", "name": "HW3.pdf" }), json!({ "id": "d", "name": "notes.pdf" })];
		let kinds = kinds_for_new_files(&existing, &added);
		assert_eq!((kinds["c"].as_str(), kinds["d"].as_str()), ("info", "study"));
	}

	#[test]
	fn recent_times() {
		let now = 10 * 86_400_000;
		assert!(is_recent(Some(&gs_base::time::iso(now - 86_400_000)), now));
		assert!(!is_recent(Some(&gs_base::time::iso(now - 4 * 86_400_000)), now));
		assert!(!is_recent(None, now) && !is_recent(Some("junk"), now));
	}
}
