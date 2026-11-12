//! Deadlines godspeed asks the agent about by itself, so the learner never has to: open ones with
//! nothing linked, in a space with files it can read. Each deadline is asked about once (the
//! Talk record remembers).

use std::collections::HashSet;

use gs_base::time;
use gs_json::{Json, json};

use gs_base::text::cmp16;
use crate::messages::native_messages::new_app_request_message;

#[derive(Debug, Clone, PartialEq)]
pub struct UnlinkedDeadline {
	pub id: String,
	pub name: String,
	pub space_name: String,
	pub space_id: String,
	pub date: String,
	pub time: Option<String>,
}

fn text_of(value: &Json) -> String {
	value.as_str().unwrap_or("").to_owned()
}

/// Open deadlines (not done, not past) with no files linked, in spaces that aren't archived and
/// have a study file ready, minus the ones already asked. Spaces are space records.
pub fn unlinked_deadlines(spaces: &[Json], today: &str, asked: &HashSet<String>) -> Vec<UnlinkedDeadline> {
	let mut out = Vec::new();
	for c in spaces {
		let has_ready_study = c["files"].as_arr().is_some_and(|files| files.iter().any(|f| f["kind"].as_str() == Some("study") && f["status"].as_str() == Some("ready")));
		if c["archived"].truthy() || !has_ready_study {
			continue;
		}
		for d in c["deadlines"].as_arr().map_or(&[][..], Vec::as_slice) {
			let open = !d["done"].truthy()
				&& cmp16(d["date"].as_str().unwrap_or(""), today).is_ge()
				&& d["fileIds"].as_arr().is_some_and(Vec::is_empty)
				&& !asked.contains(d["id"].as_str().unwrap_or(""));
			if open {
				out.push(UnlinkedDeadline {
					id: text_of(&d["id"]),
					name: text_of(&d["name"]),
					space_name: text_of(&c["name"]),
					space_id: text_of(&c["id"]),
					date: text_of(&d["date"]),
					time: d["time"].as_str().filter(|t| !t.is_empty()).map(str::to_owned),
				});
			}
		}
	}
	out
}

/// How long Talk has to sit without a new message before godspeed asks in it.
const TALK_QUIET_MS: i64 = 10 * 60_000;

/// Talk has had no new message for TALK_QUIET_MS (or has none yet), so a request from godspeed
/// won't cut into the learner's conversation. `talk` has `updatedAt` and `messages`.
pub fn talk_quiet(talk: Option<&Json>, now: i64) -> bool {
	let Some(talk) = talk else { return true };
	talk["messages"].as_arr().is_none_or(Vec::is_empty) || talk["updatedAt"].as_str().and_then(time::parse_date).is_some_and(|at| now - at >= TALK_QUIET_MS)
}

/// The deadlines godspeed already asked about in this chat.
pub fn asked_deadline_ids(messages: &[Json]) -> HashSet<String> {
	let requests = messages.iter().filter(|m| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("app-request"));
	requests.flat_map(|m| m["details"]["deadlines"].as_arr().map_or(&[][..], Vec::as_slice)).map(|d| text_of(&d["id"])).collect()
}

/// The request for the agent: work out what each deadline covers from the space's files.
pub fn coverage_request(deadlines: &[UnlinkedDeadline]) -> Json {
	let list = deadlines
		.iter()
		.map(|d| {
			let time = d.time.as_ref().map_or_else(String::new, |t| format!(" {t}"));
			format!("- {} in {} (space_id {}, deadline_id {}, due {}{time})", d.name, d.space_name, d.space_id, d.id, d.date)
		})
		.collect::<Vec<_>>()
		.join("\n");
	let text = format!(
		"{} no files linked yet:\n{list}\n\n\
		Work out what each one covers from the space's own files (a practice exam or review sheet, the syllabus schedule, announcements) \
		and link them with update_space_deadline: file_ids, left_out_ids for earlier files it doesn't cover, and source for the file you went by. \
		When the files don't settle it, say so in one line and ask the learner. Keep the reply short.",
		if deadlines.len() == 1 { "This deadline has" } else { "These deadlines have" }
	);
	new_app_request_message(&text, deadlines.iter().map(|d| json!({ "id": d.id, "name": d.name, "spaceName": d.space_name })).collect())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn space() -> Json {
		json!({
			"id": "cls_a", "name": "CSE 21", "archived": false,
			"files": [{ "kind": "study", "status": "ready" }],
			"deadlines": [
				{ "id": "d1", "name": "Midterm", "date": "2026-11-02", "time": "10:00", "fileIds": [] },
				{ "id": "d2", "name": "Past", "date": "2026-10-01", "fileIds": [] },
				{ "id": "d3", "name": "Linked", "date": "2026-11-05", "fileIds": ["f"] },
				{ "id": "d4", "name": "Asked", "date": "2026-11-05", "fileIds": [] },
				{ "id": "d5", "name": "Done", "date": "2026-11-05", "fileIds": [], "done": true },
			],
		})
	}

	#[test]
	fn only_open_unlinked_unasked_deadlines_count() {
		let asked: HashSet<String> = ["d4".to_owned()].into();
		let found = unlinked_deadlines(&[space()], "2026-10-30", &asked);
		assert_eq!(found.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["d1"]);
		assert_eq!(found[0].time.as_deref(), Some("10:00"));
		let mut archived = space();
		archived.as_obj_mut().unwrap().insert("archived", true);
		assert!(unlinked_deadlines(&[archived], "2026-10-30", &asked).is_empty());
	}

	#[test]
	fn talk_is_quiet_after_ten_minutes() {
		let now = 1_000_000_000_000;
		let talk = |ago: i64| json!({ "updatedAt": time::iso(now - ago), "messages": [{}] });
		assert!(talk_quiet(None, now) && talk_quiet(Some(&json!({ "messages": [] })), now));
		assert!(talk_quiet(Some(&talk(TALK_QUIET_MS)), now));
		assert!(!talk_quiet(Some(&talk(TALK_QUIET_MS - 1000)), now));
	}

	#[test]
	fn the_request_names_each_deadline_and_is_remembered() {
		let found = unlinked_deadlines(&[space()], "2026-10-30", &HashSet::new());
		let request = coverage_request(&found[..1]);
		let content = request["content"].as_str().unwrap();
		assert!(content.contains("This deadline has no files linked yet:\n- Midterm in CSE 21 (space_id cls_a, deadline_id d1, due 2026-11-02 10:00)\n\n"));
		assert_eq!(asked_deadline_ids(&[request]), HashSet::from(["d1".to_owned()]));
	}
}
