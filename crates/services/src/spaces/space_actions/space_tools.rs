//! The tools that read, make, edit and link a space.

use gs_core::contracts::space::clean_signature;
use gs_core::spaces::space_path::{CleanPath, clean_path};
use gs_core::spaces::space_tools::ToolOutcome;
use gs_json::{Json, Obj, json};
use gs_search::index::PassageRef;

use crate::spaces::{link_folder, update_space};
use crate::app::agent_folder::shortcut_path_problem;
use crate::graph::study_start::path_for;
use super::space_view::path_view;
use super::{SpaceActions, bad_signature, change, folder_name, given, no_space};

/// The signature argument cleaned: Ok(None) when not given, Err when given but not valid.
fn signature_arg(args: &Json) -> Result<Option<Json>, ()> {
	if !args["signature"].truthy() {
		return Ok(None);
	}
	clean_signature(&args["signature"]).map(Some).ok_or(())
}

/// The path argument cleaned against the space's `old` path: Ok(None) when not given.
fn path_arg(args: &Json, old: Option<&Json>) -> Result<Option<CleanPath>, String> {
	if !args["path"].truthy() {
		return Ok(None);
	}
	clean_path(&args["path"], old, || gs_base::ids::uuid_hex("pth", 12)).map(Some)
}

/// What the answer says of a path it saved: the count, and the old topics it left off.
fn path_answer(clean: &CleanPath) -> Json {
	let mut out = Obj::new();
	out.insert("topics", clean.path["topics"].items().len());
	if !clean.removed.is_empty() {
		out.insert("removed", clean.removed.clone());
	}
	Json::Obj(out)
}

impl SpaceActions {
	pub fn list_spaces(&self, _args: &Json) -> ToolOutcome {
		let lessons = self.app.stores.chats.list_chats();
		let spaces: Vec<Json> = self
			.app
			.stores
			.spaces
			.list_spaces()
			.iter()
			.map(|c| {
				let in_space = lessons.iter().filter(|l| l["spaceId"].as_str().is_some_and(|id| Some(id) == c["id"].as_str())).count();
				json!({
					"id": c["id"],
					"name": c["name"],
					"description": c["description"],
					"icon": c["icon"],
					"closed": c["closed"],
					"linkedFolder": c["linkedFolder"],
					"files": c["fileCount"],
					"lessons": in_space,
				})
			})
			.collect();
		let no_space_lessons = lessons.iter().filter(|l| !l["spaceId"].truthy()).count();
		self.done(json!({ "spaces": spaces, "noSpaceLessons": no_space_lessons }), Vec::new())
	}

	pub fn read_space(&self, args: &Json) -> ToolOutcome {
		let space_id = args["space_id"].str_or_empty();
		let (mut view, path) = match (self.space_view(space_id, args["files"].truthy()), path_for(&self.app, space_id)) {
			(Ok(Some(view)), Ok(path)) => (view, path),
			(Ok(None), _) => return no_space(space_id),
			(Err(err), _) | (_, Err(err)) => return ToolOutcome::Err(err),
		};
		if let (Some(path), Some(obj)) = (path, view.as_obj_mut()) {
			obj.insert("path", path_view(&path));
		}
		self.done(view, Vec::new())
	}

	pub async fn search_space_files(&self, args: &Json) -> ToolOutcome {
		let space_id = args["space_id"].str_or_empty();
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let limit = args["limit"].as_f64().map_or(8, |l| l as usize);
		match self.app.search.search_space_files(space_id, record["files"].items(), args["query"].str_or_empty(), limit).await {
			Ok((found, _)) => self.done(Json::from(found), Vec::new()),
			Err(err) => ToolOutcome::Err(err),
		}
	}

	pub fn read_passage(&self, args: &Json) -> ToolOutcome {
		let space_id = args["space_id"].str_or_empty();
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let Some(at) = PassageRef::of_args(args) else { return ToolOutcome::Err("Give passage_id, or file_id with range.".to_owned()) };
		self.done(Json::from(self.app.search.read_passage(space_id, record["files"].items(), &at)), Vec::new())
	}

	pub fn create_space(&self, args: &Json) -> ToolOutcome {
		let Ok(sig) = signature_arg(args) else { return bad_signature() };
		let path = match path_arg(args, None) {
			Ok(path) => path,
			Err(problem) => return ToolOutcome::Err(problem),
		};
		let mut init = Obj::new();
		for key in ["name", "description", "icon"] {
			if given(args, key) {
				init.insert(key, args[key].clone());
			}
		}
		if let Some(sig) = sig {
			init.insert("signature", sig);
		}
		if let Some(path) = &path {
			init.insert("path", path.path.clone());
		}
		let created = match self.app.stores.spaces.create_space(&Json::Obj(init)) {
			Ok(created) => created,
			Err(err) => return ToolOutcome::Err(err),
		};
		let id = created["id"].str_or_empty();
		let label = format!("Creating {}", created["name"].str_or_empty());
		let view = match self.space_view(id, false) {
			Ok(view) => view,
			Err(err) => return ToolOutcome::Err(err),
		};
		let mut answer = json!({ "space": view });
		if let (Some(path), Some(obj)) = (&path, answer.as_obj_mut()) {
			obj.insert("path", path_answer(path));
		}
		self.done(answer, vec![self.opened(change(label, &created["id"], "space", id, "/space"))])
	}

	pub fn update_space(&self, args: &Json) -> ToolOutcome {
		let space_id = args["space_id"].str_or_empty();
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let Ok(sig) = signature_arg(args) else { return bad_signature() };
		let path = match path_arg(args, record.get("path")) {
			Ok(path) => path,
			Err(problem) => return ToolOutcome::Err(problem),
		};
		let mut patch = Obj::new();
		for key in ["name", "description", "closed"] {
			if given(args, key) {
				patch.insert(key, args[key].clone());
			}
		}
		if args["icon"].truthy() {
			patch.insert("icon", args["icon"].clone());
		}
		if let Some(sig) = &sig {
			patch.insert("signature", sig.clone());
		}
		if let Some(path) = &path {
			patch.insert("path", path.path.clone());
		}
		let space = match update_space(&self.app, space_id, &Json::Obj(patch)) {
			Ok(space) => space,
			Err(failure) => return ToolOutcome::Err(failure.error),
		};
		let verb = match args["closed"].as_bool() {
			Some(true) => "Closing",
			Some(false) => "Reopening",
			None => "Updating",
		};
		let mut changed = Obj::new();
		for key in ["name", "description", "signature", "icon", "closed"] {
			let was_given = if key == "signature" { sig.is_some() } else { given(args, key) };
			if was_given && let Some(value) = space.get(key) {
				changed.insert(key, value.clone());
			}
		}
		if let Some(path) = &path {
			changed.insert("path", path_answer(path));
		}
		let label = format!("{verb} {}", space["name"].str_or_empty());
		self.done(json!({ "spaceId": space_id, "changed": Json::Obj(changed) }), vec![change(label, &Json::from(space_id), "space", space_id, "/space")])
	}

	pub fn link_space_folder(&self, args: &Json) -> ToolOutcome {
		let (space_id, path) = (args["space_id"].str_or_empty(), args["path"].str_or_empty());
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		if let Some(problem) = shortcut_path_problem(&self.app, path) {
			return ToolOutcome::Err(problem);
		}
		if let Err(failure) = link_folder(&self.app, space_id, path) {
			return ToolOutcome::Err(failure.error);
		}
		let label = format!("Linking {}", folder_name(Some(path)));
		let view = match self.space_view(space_id, false) {
			Ok(view) => view,
			Err(err) => return ToolOutcome::Err(err),
		};
		self.done(json!({ "space": view, "note": "Linked." }), vec![change(label, &Json::from(space_id), "space", space_id, "/space/files")])
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use super::super::tests::{actions, value};
	use super::super::{Mark, SendFirstMessage, space_actions};
	use crate::app::agent_actions::recent_agent_actions;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::space_card::space_file_path;
	use std::sync::Arc;

	#[test]
	fn a_space_the_learner_asked_for_opens_one_made_by_the_agent_alone_does_not_and_a_check_s_is_marked_background() {
		let root = scratch_dir("space-actions-open");
		let app = test_app(&root);
		let send: SendFirstMessage = Arc::new(|_, _| Box::pin(async { Ok(()) }));
		for (name, mark, open, background) in [("Algebra", Mark::Started, Some(true), None), ("Biology", Mark::Asked, None, None), ("Chemistry", Mark::Background, None, Some(true))] {
			let made = space_actions(&app, Some("Teacher"), send.clone(), mark).create_space(&json!({ "name": name }));
			assert!(matches!(made, ToolOutcome::Ok { .. }));
			let action = recent_agent_actions(&app).into_iter().find(|a| a["label"].as_str() == Some(&format!("Creating {name}"))).unwrap();
			assert_eq!((action["open"].as_bool(), action["background"].as_bool()), (open, background), "{name}");
		}
	}

	#[tokio::test]
	async fn the_teacher_sets_up_an_interview_space() {
		let root = scratch_dir("space-actions-interview");
		let app = test_app(&root);
		let actions = actions(&app);
		let (made, _) = value(actions.create_space(&json!({ "name": "Larkspur onsite", "icon": "code" })));
		let space_id = made["space"]["id"].as_str().unwrap().to_owned();
		let write = |name: &str, text: &str, kind: &str| value(actions.add_space_file(&json!({ "space_id": space_id, "name": name, "text": text, "kind": kind })));
		let (about, rows) = write("What it's like", "Two coding rounds.", "info");
		assert_eq!((about["file"]["name"].clone(), rows[0].label.as_str()), (json!("What it's like.md"), "Adding What it's like.md"));
		let (guide, _) = write("Study guide.md", "## Rate limiting", "study");
		let (again, rows) = write("What it's like.md", "Two coding rounds and lunch.", "info");
		assert_eq!((again["file"]["id"].clone(), rows[0].label.as_str()), (about["file"]["id"].clone(), "Changing What it's like.md"), "the same name keeps its id");
		let saved = app.stores.spaces.get_space(&space_id).unwrap();
		assert_eq!(saved["files"].as_arr().unwrap().len(), 2);
		let path = space_file_path(&app, &saved, &saved["files"][0]).unwrap();
		assert_eq!(std::fs::read_to_string(path).unwrap(), "Two coding rounds and lunch.");
		assert!(matches!(actions.add_space_file(&json!({ "space_id": space_id, "kind": "info" })), ToolOutcome::Err(e) if e == "Give path, or name and text."));

		let interview = json!({ "kind": "interview", "name": "Onsite", "date": "2026-11-24", "time": "14:00", "file_ids": [guide["file"]["id"]], "about_file_id": about["file"]["id"] });
		let (added, rows) = value(actions.add_space_deadline(&json!({ "space_id": space_id, "deadlines": [interview] })));
		let deadline_id = added["deadlines"][0]["id"].as_str().unwrap().to_owned();
		assert_eq!(added["deadlines"][0]["aboutFileId"], about["file"]["id"]);
		assert_eq!(rows[0].page, format!("/space/deadline/{deadline_id}"), "the row opens the deadline's page");
		let (read, _) = value(actions.read_space(&json!({ "space_id": space_id })));
		assert_eq!(read["deadlines"][0]["about"], json!({ "id": about["file"]["id"], "name": "What it's like.md" }));
		let (cleared, _) = value(actions.update_space_deadline(&json!({ "space_id": space_id, "deadline_id": deadline_id, "about_file_id": null })));
		assert!(cleared["deadline"].get("aboutFileId").is_none());
	}
}
