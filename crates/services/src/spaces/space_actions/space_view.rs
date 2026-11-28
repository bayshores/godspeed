//! How a space looks to an agent: summary, file counts, topics, deadlines and lessons.

use gs_base::clock;
use gs_core::spaces::file_state::FileStatus;
use gs_json::{Json, Obj, json};

use crate::spaces::files::file_in;
use crate::spaces::gaps::open_gap_of;
use crate::spaces::space_card::{space_file_path, space_topics};
use super::{SpaceActions, given, local_now};

/// A path as `read_space` shows it: each topic's name and standing, and what the next one covers.
pub(super) fn path_view(path: &Json) -> Json {
	let topics = path["topics"].items();
	let names: Vec<Json> = topics.iter().map(|t| json!({ "name": t["name"], "status": t["status"] })).collect();
	let next = topics.iter().find(|t| t["id"] == path["nextId"]).map_or(Json::Null, |t| json!({ "name": t["name"], "covers": t["covers"] }));
	json!({ "goal": path["goal"], "topics": names, "next": next })
}

impl SpaceActions {
	/// A space as agents see it: summary, file counts by status (and the files that could not be
	/// read, or every file with `with_files`), the graph's topics, deadlines and lessons. A linked
	/// folder can hold 500 files, so the full list comes only on request. Err when the space's
	/// graph cannot be read.
	pub(super) fn space_view(&self, space_id: &str, with_files: bool) -> Result<Option<Json>, String> {
		let app = &self.app;
		let Some(record) = app.stores.spaces.get_space(space_id) else { return Ok(None) };
		let files = record["files"].items();
		let sizes = if with_files { app.search.file_extents(space_id) } else { Obj::new() };
		let mut counts = Obj::new();
		for f in files {
			let status = f["status"].str_or_empty();
			let n = counts.get(status).and_then(Json::as_f64).unwrap_or(0.0);
			counts.insert(status, n + 1.0);
		}
		let or_null = |key: &str| if record[key].is_null() { Json::Null } else { record[key].clone() };
		let mut view = Obj::new();
		view.insert("id", record["id"].clone());
		view.insert("name", record["name"].clone());
		view.insert("description", record["description"].clone());
		view.insert("signature", or_null("signature"));
		view.insert("icon", or_null("icon"));
		view.insert("closed", record["closed"].clone());
		view.insert("linkedFolder", or_null("linkedFolder"));
		view.insert("fileCounts", counts);
		if let Some(name) = record["waitingDeadline"]["name"].as_str() {
			view.insert("waitingDeadline", format!("{name}: an interview with no date yet. The next interview you add becomes it."));
		}
		if let Some(gap) = open_gap_of(app, &record, clock::now_ms()) {
			view.insert("outOfDate", gap.agent_line);
		}
		if with_files {
			let listed: Vec<Json> = files
				.iter()
				.map(|f| {
					let mut entry = Obj::new();
					for key in ["id", "name", "kind", "origin", "status"] {
						entry.insert(key, f[key].clone());
					}
					if f["error"].truthy() {
						entry.insert("error", f["error"].clone());
					}
					// A .tex names the PDF built from it, so the teacher finds the source to edit.
					entry.insert_present("pdfId", f.get("pdfId"));
					// Where the agent built the file, and the lesson it was for.
					entry.insert_present("madeFrom", f.get("madeFrom"));
					entry.insert_present("lessonId", f.get("lessonId"));
					if let Some(size) = sizes.get(f["id"].str_or_empty()).filter(|s| s.truthy()) {
						entry.insert("size", size.clone());
					}
					entry.insert("path", space_file_path(app, &record, f).map_or(Json::Null, Json::from));
					Json::Obj(entry)
				})
				.collect();
			view.insert("files", listed);
		} else {
			let failed: Vec<Json> = files
				.iter()
				.filter(|f| matches!(FileStatus::of(f), Some(FileStatus::Failed | FileStatus::NeedsWhisper)))
				.map(|f| {
					let mut entry = Obj::new();
					for key in ["id", "name", "status"] {
						entry.insert(key, f[key].clone());
					}
					if f["error"].truthy() {
						entry.insert("error", f["error"].clone());
					}
					Json::Obj(entry)
				})
				.collect();
			view.insert("failedFiles", failed);
		}
		view.insert("topics", space_topics(app, space_id)?);
		view.insert("today", local_now());
		let named = |ids: &Json| -> Vec<Json> {
			ids.as_arr()
				.into_iter()
				.flatten()
				.map(|id| {
					let name = id.as_str().and_then(|i| file_in(&record, i)).map(|f| &f["name"]).filter(|n| !n.is_null()).unwrap_or(id);
					json!({ "id": id, "name": name })
				})
				.collect()
		};
		let deadlines: Vec<Json> = record["deadlines"]
			.as_arr()
			.into_iter()
			.flatten()
			.map(|d| {
				let mut entry = Obj::new();
				for key in ["id", "kind", "name", "date"] {
					entry.insert(key, d[key].clone());
				}
				if given(d, "time") {
					entry.insert("time", d["time"].clone());
				}
				entry.insert("done", d["done"].clone());
				entry.insert("files", named(&d["fileIds"]));
				if d["leftOutIds"].truthy() {
					entry.insert("leftOut", named(&d["leftOutIds"]));
				}
				if d["source"].truthy() {
					entry.insert("source", d["source"].clone());
				}
				if d["aboutFileId"].truthy() {
					entry.insert("about", named(&json!([d["aboutFileId"]]))[0].clone());
				}
				Json::Obj(entry)
			})
			.collect();
		view.insert("deadlines", deadlines);
		let lessons: Vec<Json> = app
			.stores
			.chats
			.list_space_chats(space_id)
			.iter()
			.map(|c| {
				let mut entry = Obj::new();
				for key in ["id", "title", "kind", "updatedAt"] {
					entry.insert_present(key, c.get(key));
				}
				Json::Obj(entry)
			})
			.collect();
		view.insert("lessons", lessons);
		Ok(Some(Json::Obj(view)))
	}
}

#[cfg(test)]
mod tests {
	use gs_core::spaces::today_note::local_day;
	use gs_core::study::deadline_plan::add_days;

	use super::super::tests::{actions, value};
	use super::*;
	use crate::app::agent_memory::current_agent_briefing;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::gaps::answer_gap;

	#[test]
	fn the_teacher_is_told_what_looks_missing_until_the_learner_waves_it_off() {
		let app = test_app(&scratch_dir("space-view-out-of-date"));
		let today = local_day(clock::now_ms());
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 29" })).unwrap()["id"].str_or_empty().to_owned();
		for (kind, name, days) in [("homework", "HW2", 5), ("exam", "Test 2", 2)] {
			app.stores.spaces.add_deadline(&space_id, &json!({ "kind": kind, "name": name, "date": add_days(&today, -days) })).unwrap();
		}
		let line = format!("No deadline on record after Test 2 ({}).", gs_core::spaces::today_note::day_label(&add_days(&today, -2)));
		let read = || value(actions(&app).read_space(&json!({ "space_id": space_id }))).0;
		assert_eq!(read()["outOfDate"], json!(line));
		assert!(current_agent_briefing(&app, 4000).contains(&format!("- CSE 29 (space_id \"{space_id}\"): {line}\n")));
		answer_gap(&app, &space_id, &format!("{space_id}:{}:recent", read()["deadlines"][1]["id"].str_or_empty())).unwrap();
		assert!(read().get("outOfDate").is_none());
		assert!(!current_agent_briefing(&app, 4000).contains(&line));
	}
}
