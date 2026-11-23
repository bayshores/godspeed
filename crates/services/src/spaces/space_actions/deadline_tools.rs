//! The tools that add, change and remove a space's deadlines.

use gs_base::clock;
use gs_core::spaces::space_deadlines::{PAST_ADD_DAYS, saved_done};
use gs_core::spaces::space_tools::ToolOutcome;
use gs_core::spaces::today_note::local_day;
use gs_json::{Json, Obj, json};

use crate::spaces::{add_space_deadline, remove_space_deadline, update_space_deadline};
use super::{SpaceActions, change, given, no_space, template_text};

/// What `update_space_deadline` can change: its argument, the record's key and the word the
/// Activity label uses for it.
const EDITS: [(&str, &str, &str); 10] = [
	("kind", "kind", "kind"),
	("name", "name", "name"),
	("date", "date", "date"),
	("time", "time", "time"),
	("file_ids", "fileIds", "files"),
	("left_out_ids", "leftOutIds", "files"),
	("source", "source", "source"),
	("assignment_file_id", "assignmentFileId", "assignment sheet"),
	("about_file_id", "aboutFileId", "info file"),
	("done", "done", "done"),
];

/// The Activity label of a deadline edit: what was changed, as "Changing Test 2's date and files".
/// A new date or time alone is a move.
fn edit_label(name: &str, args: &Json) -> String {
	match args["done"].as_bool() {
		Some(true) => return format!("Marking {name} done"),
		Some(false) => return format!("Marking {name} not done"),
		None => {}
	}
	let mut words: Vec<&str> = Vec::new();
	for (arg, _, word) in EDITS {
		if given(args, arg) && !words.contains(&word) {
			words.push(word);
		}
	}
	if !words.is_empty() && words.iter().all(|w| matches!(*w, "date" | "time")) {
		return format!("Moving {name}");
	}
	match words.split_last() {
		None => format!("Changing {name}"),
		Some((last, [])) => format!("Changing {name}'s {last}"),
		Some((last, rest)) => format!("Changing {name}'s {} and {last}", rest.join(", ")),
	}
}

/// A deadline's page in the window.
fn deadline_page(deadline_id: &str) -> String {
	format!("/space/deadline/{deadline_id}")
}

impl SpaceActions {
	pub fn add_space_deadline(&self, args: &Json) -> ToolOutcome {
		let space_id = args["space_id"].str_or_empty();
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		let (mut added, mut refused) = (Vec::new(), Vec::new());
		let today = local_day(clock::now_ms());
		for d in args["deadlines"].items().iter() {
			let mut init = Obj::new();
			for key in ["kind", "name", "date"] {
				if given(d, key) {
					init.insert(key, d[key].clone());
				}
			}
			if given(d, "time") {
				init.insert("time", d["time"].clone());
			}
			if d["file_ids"].truthy() {
				init.insert("fileIds", d["file_ids"].clone());
			}
			if d["left_out_ids"].truthy() {
				init.insert("leftOutIds", d["left_out_ids"].clone());
			}
			if given(d, "source") {
				init.insert("source", d["source"].clone());
			}
			if given(d, "assignment_file_id") {
				init.insert("assignmentFileId", d["assignment_file_id"].clone());
			}
			if given(d, "about_file_id") {
				init.insert("aboutFileId", d["about_file_id"].clone());
			}
			if d["date"].as_str().is_some_and(|date| saved_done(date, &today)) {
				init.insert("done", true);
			}
			// An interview takes an old prep's waiting deadline, as the window's Add the date does.
			if d["kind"].as_str() == Some("interview")
				&& let Some(waiting) = self.app.stores.spaces.get_space(space_id).and_then(|r| r["waitingDeadline"]["id"].as_str().map(str::to_owned))
			{
				init.insert("id", waiting);
			}
			match add_space_deadline(&self.app, space_id, &Json::Obj(init)) {
				Ok(deadline) => added.push(deadline),
				Err(failure) => {
					let mut entry = Obj::new();
					entry.insert_present("name", d.get("name"));
					entry.insert("error", failure.error);
					refused.push(Json::Obj(entry));
				},
			}
		}
		if added.is_empty() {
			return ToolOutcome::Err(refused.iter().map(|r| format!("{}: {}", template_text(r.get("name")), r["error"].str_or_empty())).collect::<Vec<_>>().join("\n"));
		}
		let changes = added.iter().map(|d| change(format!("Adding {}", d["name"].str_or_empty()), &Json::from(space_id), "deadline", d["id"].str_or_empty(), &deadline_page(d["id"].str_or_empty()))).collect();
		let late: Vec<&str> = added.iter().filter(|d| d["done"].truthy()).map(|d| d["name"].str_or_empty()).collect();
		let note = (!late.is_empty()).then(|| format!("Saved as done, due more than {PAST_ADD_DAYS} days ago: {}.", late.join(", ")));
		let mut value = json!({ "deadlines": added });
		if let Some(obj) = value.as_obj_mut() {
			if !refused.is_empty() {
				obj.insert("refused", refused);
			}
			if let Some(note) = note {
				obj.insert("note", note);
			}
		}
		self.done(value, changes)
	}

	pub fn update_space_deadline(&self, args: &Json) -> ToolOutcome {
		let (space_id, deadline_id) = (args["space_id"].str_or_empty(), args["deadline_id"].str_or_empty());
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		let mut patch = Obj::new();
		for (arg, key, _) in EDITS {
			if given(args, arg) {
				patch.insert(key, args[arg].clone());
			}
		}
		let deadline = match update_space_deadline(&self.app, space_id, deadline_id, &Json::Obj(patch)) {
			Ok(deadline) => deadline,
			Err(failure) => return ToolOutcome::Err(failure.error),
		};
		let label = edit_label(deadline["name"].str_or_empty(), args);
		self.done(json!({ "deadline": deadline }), vec![change(label, &Json::from(space_id), "deadline", deadline_id, &deadline_page(deadline_id))])
	}

	pub fn remove_space_deadline(&self, args: &Json) -> ToolOutcome {
		let (space_id, deadline_id) = (args["space_id"].str_or_empty(), args["deadline_id"].str_or_empty());
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let removed_name = record["deadlines"].items().iter().find(|d| d["id"].as_str() == Some(deadline_id)).and_then(|d| d["name"].as_str()).unwrap_or("a deadline").to_owned();
		let mocks = match remove_space_deadline(&self.app, space_id, deadline_id) {
			Ok(mocks) => mocks,
			Err(failure) => return ToolOutcome::Err(failure.error),
		};
		let mut removed = change(format!("Removing {removed_name}"), &Json::from(space_id), "deadline", deadline_id, "/");
		if let Some(obj) = removed.as_obj_mut() {
			obj.insert("removed", true);
		}
		let mut value = json!({ "removed": deadline_id });
		if mocks > 0
			&& let Some(obj) = value.as_obj_mut()
		{
			obj.insert("note", if mocks == 1 { "Its mock is removed too.".to_owned() } else { format!("Its {mocks} mocks are removed too.") });
		}
		self.done(value, vec![removed])
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use super::super::tests::{actions, value};

	#[tokio::test]
	async fn an_interview_the_agent_adds_takes_an_old_preps_waiting_deadline() {
		let root = scratch_dir("space-actions-waiting");
		let app = test_app(&root);
		let actions = actions(&app);
		let (made, _) = value(actions.create_space(&json!({ "name": "Larkspur loop" })));
		let space_id = made["space"]["id"].as_str().unwrap().to_owned();
		let write = |name: &str, kind: &str| value(actions.add_space_file(&json!({ "space_id": space_id, "name": name, "text": "Two rounds.", "kind": kind }))).0["file"]["id"].clone();
		let (about, guide) = (write("What it's like", "info"), write("Study guide", "study"));
		app.stores.spaces.rewrite_space(&space_id, |r| {
			let mut next = r.clone();
			next.as_obj_mut().unwrap().insert("waitingDeadline", json!({ "id": "ddl_0a1b2c3d4e5f", "name": "Larkspur loop", "aboutFileId": about, "fileIds": [guide] }));
			next
		}).unwrap();
		let (read, _) = value(actions.read_space(&json!({ "space_id": space_id })));
		assert_eq!(read["waitingDeadline"], json!("Larkspur loop: an interview with no date yet. The next interview you add becomes it."));

		let deadlines = json!([{ "kind": "exam", "name": "Quiz", "date": "2026-11-20" }, { "kind": "interview", "name": "Onsite", "date": "2026-11-24" }, { "kind": "interview", "name": "Final round", "date": "2026-11-28" }]);
		let (added, _) = value(actions.add_space_deadline(&json!({ "space_id": space_id, "deadlines": deadlines })));
		let ids: Vec<&str> = added["deadlines"].as_arr().unwrap().iter().map(|d| d["id"].str_or_empty()).collect();
		assert_ne!(ids[0], "ddl_0a1b2c3d4e5f", "an exam is not it");
		assert_eq!(ids[1], "ddl_0a1b2c3d4e5f");
		assert_ne!(ids[2], "ddl_0a1b2c3d4e5f", "only the first interview takes it");
		assert_eq!((added["deadlines"][1]["aboutFileId"].clone(), added["deadlines"][1]["fileIds"].clone()), (about, json!([guide])));
		assert!(app.stores.spaces.get_space(&space_id).unwrap().get("waitingDeadline").is_none());
		assert!(value(actions.read_space(&json!({ "space_id": space_id }))).0.get("waitingDeadline").is_none());
	}

	#[test]
	fn an_edit_label_names_what_changed() {
		let label = |args: Json| edit_label("Test 2", &args);
		assert_eq!(label(json!({ "file_ids": [] })), "Changing Test 2's files");
		assert_eq!(label(json!({ "date": "2026-11-24", "file_ids": [], "left_out_ids": [] })), "Changing Test 2's date and files");
		assert_eq!(label(json!({ "kind": "exam", "source": "x", "about_file_id": null })), "Changing Test 2's kind, source and info file");
		assert_eq!(label(json!({ "date": "2026-11-24", "time": "09:00" })), "Moving Test 2");
		assert_eq!(label(json!({ "done": true, "name": "Test 2" })), "Marking Test 2 done");
		assert_eq!(label(json!({})), "Changing Test 2");
	}

	#[test]
	fn removing_a_deadline_removes_its_mocks_and_says_how_many() {
		let root = scratch_dir("space-actions-remove-mocks");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Larkspur onsite" })).unwrap()["id"].as_str().unwrap().to_owned();
		let add = |name: &str| app.stores.spaces.add_deadline(&space_id, &json!({ "kind": "interview", "name": name, "date": "2026-11-24" })).unwrap()["id"].as_str().unwrap().to_owned();
		let (onsite, screen) = (add("Onsite"), add("Phone screen"));
		let format = json!({ "questions": 1 });
		for (id, deadline) in [("mock_00000001", &onsite), ("mock_00000002", &onsite), ("mock_00000003", &screen)] {
			app.stores.mocks.write_mock(&space_id, &gs_core::mocks::mock::new_mock(id, deadline, 1.0, &format, "t")).unwrap();
		}
		let (removed, _) = value(actions(&app).remove_space_deadline(&json!({ "space_id": space_id, "deadline_id": onsite })));
		assert_eq!(removed["note"], json!("Its 2 mocks are removed too."));
		let left: Vec<Json> = app.stores.mocks.list_mocks(&space_id).unwrap().iter().map(|m| m["id"].clone()).collect();
		assert_eq!(left, [json!("mock_00000003")]);
		let (quiet, _) = value(actions(&app).remove_space_deadline(&json!({ "space_id": space_id, "deadline_id": screen })));
		assert_eq!(quiet["note"], json!("Its mock is removed too."), "as the window says it");
	}

	#[test]
	fn a_deadline_the_agent_adds_more_than_a_week_late_is_saved_done() {
		let root = scratch_dir("space-actions-late-adds");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].as_str().unwrap().to_owned();
		let today = local_day(clock::now_ms());
		let ago = |days: i64| gs_core::study::deadline_plan::add_days(&today, -days);
		let deadlines = json!([
			{ "kind": "homework", "name": "HW1", "date": ago(PAST_ADD_DAYS + 1) },
			{ "kind": "homework", "name": "HW2", "date": ago(PAST_ADD_DAYS) },
			{ "kind": "homework", "name": "HW3", "date": ago(40) },
		]);
		let (added, _) = value(actions(&app).add_space_deadline(&json!({ "space_id": space_id, "deadlines": deadlines })));
		let done: Vec<bool> = added["deadlines"].items().iter().map(|d| d["done"].truthy()).collect();
		assert_eq!(done, [true, false, true]);
		assert!(added["deadlines"][0].get("doneAt").is_none(), "never ticked, so never done today");
		assert_eq!(added["note"], json!("Saved as done, due more than 7 days ago: HW1, HW3."));
		let (fresh, _) = value(actions(&app).add_space_deadline(&json!({ "space_id": space_id, "deadlines": [{ "kind": "exam", "name": "Final", "date": ago(-10) }] })));
		assert!(fresh.get("note").is_none() && !fresh["deadlines"][0]["done"].truthy());
	}
}
