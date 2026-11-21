//! The tools that add a written file to a space and set a file's kind.

use gs_core::contracts::space::{FILE_KIND_PROBLEM, safe_name};
use gs_core::spaces::file_state::FileKind;
use gs_core::spaces::space_tools::ToolOutcome;
use gs_json::{Json, json};

use crate::spaces::{add_file_from_path, add_made_file, set_file_kind, tie_file_to_lesson, write_agent_file};
use crate::app::agent_folder::{made_path, shortcut_path_problem};
use super::{READING_NOTE, SpaceActions, change, no_space};

/// The longest text add_space_file writes.
const WRITTEN_TEXT_MAX: usize = 20_000;

/// A written file's name: a plain name ending in .md, or None when it has folders or control
/// characters (a right-to-left override among them, which can make a name look like another).
fn written_file_name(name: &str) -> Option<String> {
	let bidi = |c: char| matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}');
	if name.contains(['/', '\\']) || name.chars().any(|c| c.is_control() || bidi(c)) {
		return None;
	}
	let clean = safe_name(name);
	Some(if clean.to_lowercase().ends_with(".md") { clean } else { format!("{clean}.md") })
}

/// The activity verb for a file the agent wrote or built.
fn changing(replaced: bool) -> &'static str {
	if replaced { "Changing" } else { "Adding" }
}

impl SpaceActions {
	pub fn add_space_file(&self, args: &Json) -> ToolOutcome {
		let (space_id, path) = (args["space_id"].str_or_empty(), args["path"].str_or_empty());
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let Some(kind) = args["kind"].as_str().and_then(FileKind::parse) else { return ToolOutcome::Err(FILE_KIND_PROBLEM.to_owned()) };
		let lesson_id = args["lesson_id"].as_str();
		if let Some(lesson) = lesson_id
			&& self.app.stores.chats.get_chat(lesson).is_none_or(|chat| chat["spaceId"].as_str() != Some(space_id))
		{
			return ToolOutcome::Err(format!("No lesson \"{lesson}\" in this space. Use list_lessons."));
		}
		let (file, verb) = if args["name"].truthy() && args.get("text").is_some_and(|t| t.as_str().is_some()) {
			match self.write_space_file(&record, args["name"].str_or_empty(), args["text"].str_or_empty(), kind) {
				Ok(written) => written,
				Err(error) => return ToolOutcome::Err(error),
			}
		} else if !path.is_empty() {
			if let Some(problem) = shortcut_path_problem(&self.app, path) {
				return ToolOutcome::Err(problem);
			}
			// A file built in the godspeed folder's made/ is the agent's own: its next build replaces it.
			let added = match made_path(&self.app, path) {
				Some(made_from) => add_made_file(&self.app, space_id, path, &made_from, kind).map(|(file, replaced)| (file, changing(replaced))),
				None => add_file_from_path(&self.app, space_id, path, kind).map(|file| (file, "Adding")).map_err(|failure| failure.error),
			};
			match added {
				Ok(added) => added,
				Err(error) => return ToolOutcome::Err(error),
			}
		} else {
			return ToolOutcome::Err("Give path, or name and text.".to_owned());
		};
		let file = lesson_id.and_then(|lesson| tie_file_to_lesson(&self.app, space_id, file["id"].str_or_empty(), lesson)).unwrap_or(file);
		let note = if kind == FileKind::Study { format!("Added. {READING_NOTE}") } else { "Added.".to_owned() };
		let label = format!("{verb} {}", file["name"].str_or_empty());
		let change = change(label, &Json::from(space_id), "file", file["id"].str_or_empty(), "/space/files");
		self.done(json!({ "file": file, "note": note }), vec![change])
	}

	/// Writes a file from text: one it wrote before by that name is replaced and keeps its id; the
	/// learner's own file by that name is never written over.
	fn write_space_file(&self, record: &Json, name: &str, text: &str, kind: FileKind) -> Result<(Json, &'static str), String> {
		let Some(file_name) = written_file_name(name) else { return Err("Give a plain file name like \"Study guide.md\", with no folders or control characters.".to_owned()) };
		if text.trim().is_empty() {
			return Err("The text is empty.".to_owned());
		}
		if text.chars().count() > WRITTEN_TEXT_MAX {
			return Err("The text is longer than 20,000 characters. Shorten it or split it into two files.".to_owned());
		}
		let (file, replaced) = write_agent_file(&self.app, record["id"].str_or_empty(), &file_name, &gs_base::text::utf8_bytes(text), kind)?;
		Ok((file, changing(replaced)))
	}

	pub fn set_space_file_kind(&self, args: &Json) -> ToolOutcome {
		let space_id = args["space_id"].str_or_empty();
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		let Some(kind) = args["kind"].as_str().and_then(FileKind::parse) else { return ToolOutcome::Err(FILE_KIND_PROBLEM.to_owned()) };
		let (mut files, mut refused, mut changes) = (Vec::new(), Vec::new(), Vec::new());
		for file_id in args["file_ids"].items().iter() {
			let file_id = file_id.str_or_empty();
			let file = match set_file_kind(&self.app, space_id, file_id, kind) {
				Ok(file) => file,
				Err(failure) => {
					refused.push(json!({ "fileId": file_id, "error": failure.error }));
					continue;
				}
			};
			files.push(json!({ "id": file["id"], "name": file["name"], "kind": kind.as_str(), "status": file["status"] }));
			let label = format!("Marking {} as {}", file["name"].str_or_empty(), if kind == FileKind::Study { "study material" } else { "space info" });
			changes.push(change(label, &Json::from(space_id), "file", file["id"].str_or_empty(), "/space/files"));
		}
		if files.is_empty() {
			return ToolOutcome::Err(refused.iter().map(|r| format!("{}: {}", r["fileId"].str_or_empty(), r["error"].str_or_empty())).collect::<Vec<_>>().join("\n"));
		}
		let mut value = json!({ "files": files });
		if !refused.is_empty()
			&& let Some(obj) = value.as_obj_mut()
		{
			obj.insert("refused", refused);
		}
		self.done(value, changes)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use super::super::tests::{actions, value};
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::space_card::space_file_path;

	#[tokio::test]
	async fn the_agent_writes_over_only_files_it_wrote_and_only_plain_names_and_short_texts() {
		let root = scratch_dir("space-actions-written");
		let app = test_app(&root);
		let actions = actions(&app);
		let (made, _) = value(actions.create_space(&json!({ "name": "Algebra" })));
		let space_id = made["space"]["id"].as_str().unwrap().to_owned();
		let own = crate::spaces::add_copied_file(&app, &space_id, "notes.md", b"My own notes.").unwrap();
		app.stores.spaces.rewrite_space(&space_id, |r| {
			let mut next = r.clone();
			let linked = json!({ "id": "f_linked", "origin": "linked", "name": "Syllabus.md", "path": "/tmp/Syllabus.md", "kind": "info", "contentFp": "", "status": "ready", "addedAt": "t" });
			next.as_obj_mut().unwrap().get_mut("files").unwrap().as_arr_mut().unwrap().push(linked);
			next
		}).unwrap();
		let write = |name: &str, text: &str| match actions.add_space_file(&json!({ "space_id": space_id, "name": name, "text": text, "kind": "study" })) {
			ToolOutcome::Ok { value, .. } => Ok(value["file"]["name"].as_str().unwrap().to_owned()),
			ToolOutcome::Err(error) => Err(error),
		};
		assert_eq!(write("notes", "Overwritten."), Err("This space already has a file named notes.md that this tool can't replace. Pick another name, or ask the learner to remove the old one.".to_owned()));
		assert_eq!(write("Syllabus.md", "Overwritten."), Err("This space already has a file named Syllabus.md that this tool can't replace. Pick another name, or ask the learner to remove the old one.".to_owned()));
		let path = space_file_path(&app, &app.stores.spaces.get_space(&space_id).unwrap(), &own).unwrap();
		assert_eq!(std::fs::read_to_string(path).unwrap(), "My own notes.");
		let plain = Err("Give a plain file name like \"Study guide.md\", with no folders or control characters.".to_owned());
		for name in ["week1/plan.md", "..\\plan.md", "plan\u{7f}.md", "plan\u{202e}dm.exe"] {
			assert_eq!(write(name, "Plan."), plain, "{name:?}");
		}
		assert_eq!(write("Plan", " \n"), Err("The text is empty.".to_owned()));
		assert_eq!(write("Plan", &"x".repeat(20_001)), Err("The text is longer than 20,000 characters. Shorten it or split it into two files.".to_owned()));
		assert_eq!(write("Plan.txt", &"x".repeat(20_000)), Ok("Plan.txt.md".to_owned()));
		assert_eq!(write("Plan.txt.md", "Shorter."), Ok("Plan.txt.md".to_owned()), "its own file is changed");
		assert_eq!(app.stores.spaces.get_space(&space_id).unwrap()["files"].as_arr().unwrap().len(), 3);
	}

	#[tokio::test]
	async fn a_file_built_in_made_is_replaced_by_its_next_build_and_listed_with_its_lesson() {
		let root = scratch_dir("space-actions-made");
		let app = test_app(&root);
		let actions = actions(&app);
		let (made, _) = value(actions.create_space(&json!({ "name": "Algebra" })));
		let space_id = made["space"]["id"].as_str().unwrap().to_owned();
		let lesson = app.stores.chats.create_chat("Review", Some("study"), Some(&space_id), None, &[]).unwrap()["id"].str_or_empty().to_owned();
		let folder = std::path::PathBuf::from(crate::app::agent_folder::agent_folder(&app)).join("made/Algebra");
		std::fs::create_dir_all(&folder).unwrap();
		let add = |path: &std::path::Path, lesson_id: &str| actions.add_space_file(&json!({ "space_id": space_id, "path": path.to_string_lossy(), "kind": "info", "lesson_id": lesson_id }));
		let built = folder.join("Practice test.md");
		std::fs::write(&built, "Problem 1.").unwrap();
		let (first, changes) = value(add(&built, &lesson));
		assert_eq!(changes[0].label, "Adding Practice test.md");
		assert_eq!(first["file"]["madeFrom"], json!("made/Algebra/Practice test.md"));
		assert_eq!(first["file"]["lessonId"], json!(lesson));
		std::fs::write(&built, "Problem 1, fixed.").unwrap();
		let (second, changes) = value(add(&built, &lesson));
		assert_eq!(changes[0].label, "Changing Practice test.md");
		assert_eq!(second["file"]["id"], first["file"]["id"], "the next build keeps the file's id");
		let record = app.stores.spaces.get_space(&space_id).unwrap();
		assert_eq!(record["files"].as_arr().unwrap().len(), 1);
		assert_eq!(std::fs::read_to_string(space_file_path(&app, &record, &second["file"]).unwrap()).unwrap(), "Problem 1, fixed.");
		let (view, _) = value(actions.read_space(&json!({ "space_id": space_id, "files": true })));
		assert_eq!(json!([view["files"][0]["madeFrom"], view["files"][0]["lessonId"]]), json!(["made/Algebra/Practice test.md", lesson]));
		assert!(crate::app::agent_memory::current_agent_briefing(&app, 4000).contains(&format!("lesson_id \"{lesson}\", its files: Practice test.md")));

		// A file from anywhere else is the learner's: a second copy, never replaced.
		let own = root.join("Notes.md");
		std::fs::write(&own, "Mine.").unwrap();
		for _ in 0..2 {
			let (copied, _) = value(actions.add_space_file(&json!({ "space_id": space_id, "path": own.to_string_lossy(), "kind": "study" })));
			assert_eq!(copied["file"].get("madeFrom"), None);
		}
		assert_eq!(app.stores.spaces.get_space(&space_id).unwrap()["files"].as_arr().unwrap().len(), 3);
		match add(&built, "chat_none") {
			ToolOutcome::Err(error) => assert_eq!(error, "No lesson \"chat_none\" in this space. Use list_lessons."),
			ToolOutcome::Ok { .. } => panic!("a lesson that is not in the space was taken"),
		}
	}
}
