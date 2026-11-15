//! What godspeed asks the learner's agent to do on deadlines: work out what they cover, write a
//! study guide, or rewrite what one is like. godspeed asks about open deadlines with nothing
//! linked by itself, each once; the deadline page asks for one deadline.

use std::collections::HashSet;

use gs_base::text::cmp16;
use gs_json::Json;

use super::prep_upgrade::{ABOUT_FILE_NAME, GUIDE_FILE_NAME};

/// What a request asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestKind {
	Coverage,
	Guide,
	About,
}

impl RequestKind {
	pub fn parse(name: &str) -> Option<RequestKind> {
		Some(match name {
			"coverage" => RequestKind::Coverage,
			"guide" => RequestKind::Guide,
			"about" => RequestKind::About,
			_ => return None,
		})
	}

	pub fn name(self) -> &'static str {
		match self {
			RequestKind::Coverage => "coverage",
			RequestKind::Guide => "guide",
			RequestKind::About => "about",
		}
	}
}

/// A deadline a request is about.
#[derive(Debug, Clone, PartialEq)]
pub struct RequestedDeadline {
	pub id: String,
	pub name: String,
	pub space_name: String,
	pub space_id: String,
	pub date: String,
	pub time: Option<String>,
	/// Files linked to it already.
	pub linked: usize,
}

fn text_of(value: &Json) -> String {
	value.str_or_empty().to_owned()
}

/// `deadline` of the space record `space`.
pub fn requested_deadline(space: &Json, deadline: &Json) -> RequestedDeadline {
	RequestedDeadline {
		id: text_of(&deadline["id"]),
		name: text_of(&deadline["name"]),
		space_name: text_of(&space["name"]),
		space_id: text_of(&space["id"]),
		date: text_of(&deadline["date"]),
		time: deadline["time"].as_str().filter(|t| !t.is_empty()).map(str::to_owned),
		linked: deadline["fileIds"].items().len(),
	}
}

/// Open deadlines (not done, not past) with no files linked, in spaces that aren't closed and
/// have a study file ready, minus the ones already asked. Spaces are space records.
pub fn unlinked_deadlines(spaces: &[Json], today: &str, asked: &HashSet<String>) -> Vec<RequestedDeadline> {
	let mut out = Vec::new();
	for c in spaces {
		let has_ready_study = c["files"].items().iter().any(|f| f["kind"].as_str() == Some("study") && f["status"].as_str() == Some("ready"));
		if c["closed"].truthy() || !has_ready_study {
			continue;
		}
		for d in c["deadlines"].items() {
			let open = !d["done"].truthy()
				&& cmp16(d["date"].str_or_empty(), today).is_ge()
				&& d["fileIds"].as_arr().is_some_and(Vec::is_empty)
				&& !asked.contains(d["id"].str_or_empty());
			if open {
				out.push(requested_deadline(c, d));
			}
		}
	}
	out
}

/// The deadlines godspeed asked about in the Talk chat of earlier versions.
pub fn asked_deadline_ids(messages: &[Json]) -> HashSet<String> {
	let requests = messages.iter().filter(|m| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("app-request"));
	requests.flat_map(|m| m["details"]["deadlines"].items()).map(|d| text_of(&d["id"])).collect()
}

fn line(d: &RequestedDeadline) -> String {
	let time = d.time.as_ref().map_or_else(String::new, |t| format!(" {t}"));
	let linked = match d.linked {
		0 => String::new(),
		1 => ", 1 file linked".to_owned(),
		n => format!(", {n} files linked"),
	};
	format!("- {} in {} (space_id {}, deadline_id {}, due {}{time}{linked})", d.name, d.space_name, d.space_id, d.id, d.date)
}

/// The request for the agent.
pub fn request_text(kind: RequestKind, deadlines: &[RequestedDeadline]) -> String {
	let list = deadlines.iter().map(line).collect::<Vec<_>>().join("\n");
	match kind {
		RequestKind::Coverage => format!(
			"Work out what {} from the space's own files (a practice exam or review sheet, the syllabus schedule, announcements) \
			and link them with update_space_deadline: file_ids, left_out_ids for earlier files it doesn't cover, and source for the file you went by.\n{list}",
			if deadlines.len() == 1 { "this deadline covers" } else { "each of these deadlines covers" }
		),
		RequestKind::Guide => format!(
			"Write a study guide for this deadline from the space's own files: the topics to know and how to practice each. \
			Add it with add_space_file as {GUIDE_FILE_NAME} (kind study), then add its id to the deadline's file_ids with update_space_deadline, keeping the ids already there.\n{list}"
		),
		RequestKind::About => format!(
			"Rewrite what this deadline is like. Write it with add_space_file as {ABOUT_FILE_NAME} (kind info) and set it as the deadline's about_file_id with update_space_deadline.\n{list}"
		),
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn space() -> Json {
		json!({
			"id": "cls_a", "name": "CSE 21", "closed": false,
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
		let mut closed = space();
		closed.as_obj_mut().unwrap().insert("closed", true);
		assert!(unlinked_deadlines(&[closed], "2026-10-30", &asked).is_empty());
	}

	#[test]
	fn each_request_names_its_deadlines() {
		let found = unlinked_deadlines(&[space()], "2026-10-30", &HashSet::new());
		let text = request_text(RequestKind::Coverage, &found[..1]);
		assert!(text.starts_with("Work out what this deadline covers from the space's own files"));
		assert!(text.ends_with("source for the file you went by.\n- Midterm in CSE 21 (space_id cls_a, deadline_id d1, due 2026-11-02 10:00)"));
		assert!(request_text(RequestKind::Coverage, &found).contains("each of these deadlines covers"));
		let linked = requested_deadline(&space(), &space()["deadlines"][2]);
		assert!(request_text(RequestKind::Guide, &[linked]).ends_with("keeping the ids already there.\n- Linked in CSE 21 (space_id cls_a, deadline_id d3, due 2026-11-05, 1 file linked)"));
		assert!(request_text(RequestKind::About, &found[..1]).contains("add_space_file as What it's like.md (kind info)"));
	}

	#[test]
	fn the_old_talk_chat_s_requests_count_as_asked() {
		let request = json!({ "role": "custom", "customType": "app-request", "details": { "deadlines": [{ "id": "d1" }, { "id": "d4" }] } });
		assert_eq!(asked_deadline_ids(&[request, json!({ "role": "user", "content": "hi" })]), HashSet::from(["d1".to_owned(), "d4".to_owned()]));
	}

	#[test]
	fn kinds_read_back_their_names() {
		for kind in [RequestKind::Coverage, RequestKind::Guide, RequestKind::About] {
			assert_eq!(RequestKind::parse(kind.name()), Some(kind));
		}
		assert_eq!(RequestKind::parse("talk"), None);
	}
}
