//! The space tools' work (space-actions.ts), shared by the outside agent's MCP server and the
//! Talk chat: each checks its arguments, changes the space, records what it changed for the
//! teacher's panel, and returns what the agent sees. `caller` names the agent in the panel's rows;
//! `send` gives a new lesson its first message (the chat handler's input, passed in by the
//! caller).

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use gs_base::{clock, time};
use gs_core::spaces::space_tools::{SpaceChange, ToolOutcome};
use gs_core::spaces::today_note::local_day;
use gs_core::contracts::space::{SIGNATURE_MAX, clean_signature, parse_space_scope, safe_name};
use gs_json::{Json, Obj, json};
use gs_search::index::PassageRef;

use super::space_card::{space_file_path, space_topics};
use super::files::{add_written_file, file_in, files_of, str_of};
use super::{add_file_from_path, add_space_deadline, link_folder, remove_space_deadline, replace_copied_file, set_file_kind, update_space, update_space_deadline};
use crate::App;
use crate::app::agent_actions::note_agent_action;
use crate::app::agent_folder::shortcut_path_problem;
use crate::turns::lessons::{CreateLessonInput, LessonStart, create_lesson};

/// Study files are read by the agent itself, as background work items.
pub const READING_NOTE: &str = "The reading work comes to you through wait_for_work; it does not progress until you run the loop.";

/// Sends a lesson's first message (chat id, text); Err holds the refusal's body text.
pub type SendFirstMessage = Arc<dyn Fn(String, String) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

/// The space tools for one caller. `open_started`: the learner asked for the lesson or the space in
/// Talk, so the window opens it even with Follow off.
pub fn space_actions(app: &Arc<App>, caller: Option<&str>, send: SendFirstMessage, open_started: bool) -> SpaceActions {
	SpaceActions { app: app.clone(), caller: caller.map(str::to_owned), send, open_started }
}

pub struct SpaceActions {
	app: Arc<App>,
	caller: Option<String>,
	send: SendFirstMessage,
	open_started: bool,
}

/// The last part of a folder path, or "a folder".
pub fn folder_name(path: Option<&str>) -> String {
	let trimmed = path.unwrap_or("").trim_end_matches(['/', '\\']);
	trimmed.rsplit(['/', '\\']).next().filter(|n| !n.is_empty()).unwrap_or("a folder").to_owned()
}

/// This computer's date and time, "YYYY-MM-DD HH:MM" (deadlines are in the same local wall clock).
fn local_now() -> String {
	let now = clock::now_ms();
	let local = time::local(now);
	format!("{} {:02}:{:02}", local_day(now), local.hour(), local.minute())
}

fn no_space(space_id: &str) -> ToolOutcome {
	ToolOutcome::Err(format!("No space \"{space_id}\". Use list_spaces."))
}

fn bad_signature() -> ToolOutcome {
	ToolOutcome::Err(format!("A signature is one line of at most {SIGNATURE_MAX} characters."))
}

/// `${v}` for an argument the schema makes a string (None is `undefined`).
fn template_text(v: Option<&Json>) -> String {
	match v {
		None => "undefined".to_owned(),
		Some(Json::Str(s)) => s.clone(),
		Some(other) => gs_json::stringify(other),
	}
}

/// `args[key]` as JS sees `args.key !== undefined`.
fn given(args: &Json, key: &str) -> bool {
	args.get(key).is_some()
}

/// A change for the panel: `{ label, spaceId, target: { kind, id }, page }`.
fn change(label: String, space_id: &Json, kind: &str, id: &str, page: &str) -> Json {
	json!({ "label": label, "spaceId": space_id, "target": { "kind": kind, "id": id }, "page": page })
}

/// A deadline's page in the window.
fn deadline_page(deadline_id: &str) -> String {
	format!("/space/deadline/{deadline_id}")
}

/// A written file's name as stored: Markdown unless it says it is plain text.
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

/// The signature argument cleaned: Ok(None) when not given, Err when given but not valid.
fn signature_arg(args: &Json) -> Result<Option<Json>, ()> {
	if !args["signature"].truthy() {
		return Ok(None);
	}
	clean_signature(&args["signature"]).map(Some).ok_or(())
}

impl SpaceActions {
	/// The change marked `open` when the learner asked for it in Talk.
	fn opened(&self, mut change: Json) -> Json {
		if self.open_started
			&& let Some(obj) = change.as_obj_mut()
		{
			obj.insert("open", true);
		}
		change
	}

	fn space_exists(&self, space_id: &str) -> bool {
		self.app.stores.spaces.get_space(space_id).is_some()
	}

	/// Each change is recorded for the panel and returned for the chat.
	fn done(&self, value: Json, changes: Vec<Json>) -> ToolOutcome {
		for change in &changes {
			note_agent_action(&self.app, self.caller.as_deref(), change);
		}
		let changes = changes.iter().map(|c| SpaceChange { label: str_of(c, "label").to_owned(), page: str_of(c, "page").to_owned() }).collect();
		ToolOutcome::Ok { value, changes }
	}

	/// A space as agents see it: summary, file counts by status (and the files that could not be
	/// read, or every file with `with_files`), the graph's topics, deadlines and lessons. A linked
	/// folder can hold 500 files, so the full list comes only on request. Err when the space's
	/// graph cannot be read.
	fn space_view(&self, space_id: &str, with_files: bool) -> Result<Option<Json>, String> {
		let app = &self.app;
		let Some(record) = app.stores.spaces.get_space(space_id) else { return Ok(None) };
		let files = files_of(&record);
		let sizes = if with_files { app.search.file_extents(space_id) } else { Obj::new() };
		let mut counts = Obj::new();
		for f in files {
			let status = str_of(f, "status");
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
		view.insert("archived", record["archived"].clone());
		view.insert("linkedFolder", or_null("linkedFolder"));
		view.insert("fileCounts", counts);
		if let Some(name) = record["waitingDeadline"]["name"].as_str() {
			view.insert("waitingDeadline", format!("{name}: an interview with no date yet. The next interview you add becomes it."));
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
					if let Some(size) = sizes.get(str_of(f, "id")).filter(|s| s.truthy()) {
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
				.filter(|f| matches!(str_of(f, "status"), "failed" | "needs-whisper"))
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
			.list_chats()
			.iter()
			.filter(|c| c["spaceId"].as_str() == Some(space_id))
			.map(|c| {
				let mut entry = Obj::new();
				for key in ["id", "title", "kind", "updatedAt"] {
					if let Some(v) = c.get(key) {
						entry.insert(key, v.clone());
					}
				}
				Json::Obj(entry)
			})
			.collect();
		view.insert("lessons", lessons);
		Ok(Some(Json::Obj(view)))
	}

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
					"archived": c["archived"],
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
		let space_id = str_of(args, "space_id");
		match self.space_view(space_id, args["files"].truthy()) {
			Ok(Some(view)) => self.done(view, Vec::new()),
			Ok(None) => no_space(space_id),
			Err(err) => ToolOutcome::Err(err),
		}
	}

	pub async fn search_space_files(&self, args: &Json) -> ToolOutcome {
		let space_id = str_of(args, "space_id");
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let limit = args["limit"].as_f64().map_or(8, |l| l as usize);
		match self.app.search.search_space_files(space_id, files_of(&record), str_of(args, "query"), limit).await {
			Ok(found) => self.done(Json::from(found), Vec::new()),
			Err(err) => ToolOutcome::Err(err),
		}
	}

	pub fn read_passage(&self, args: &Json) -> ToolOutcome {
		let space_id = str_of(args, "space_id");
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let at = if args["passage_id"].truthy() {
			PassageRef::Passage(str_of(args, "passage_id").to_owned())
		} else if args["file_id"].truthy() && args["range"].truthy() {
			PassageRef::Place { file_id: str_of(args, "file_id").to_owned(), range: str_of(args, "range").to_owned() }
		} else {
			return ToolOutcome::Err("Give passage_id, or file_id with range.".to_owned());
		};
		self.done(Json::from(self.app.search.read_passage(space_id, files_of(&record), &at)), Vec::new())
	}

	pub fn create_space(&self, args: &Json) -> ToolOutcome {
		let Ok(sig) = signature_arg(args) else { return bad_signature() };
		let mut init = Obj::new();
		for key in ["name", "description", "icon"] {
			if given(args, key) {
				init.insert(key, args[key].clone());
			}
		}
		if let Some(sig) = sig {
			init.insert("signature", sig);
		}
		let created = match self.app.stores.spaces.create_space(&Json::Obj(init)) {
			Ok(created) => created,
			Err(err) => return ToolOutcome::Err(err),
		};
		let id = str_of(&created, "id");
		let label = format!("Creating {}", str_of(&created, "name"));
		let view = match self.space_view(id, false) {
			Ok(view) => view,
			Err(err) => return ToolOutcome::Err(err),
		};
		self.done(json!({ "space": view }), vec![self.opened(change(label, &created["id"], "space", id, "/space"))])
	}

	pub fn update_space(&self, args: &Json) -> ToolOutcome {
		let space_id = str_of(args, "space_id");
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		let Ok(sig) = signature_arg(args) else { return bad_signature() };
		let mut patch = Obj::new();
		for key in ["name", "description", "archived"] {
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
		let space = match update_space(&self.app, space_id, &Json::Obj(patch)) {
			Ok(space) => space,
			Err(failure) => return ToolOutcome::Err(failure.error),
		};
		let verb = match args["archived"].as_bool() {
			Some(true) => "Archiving",
			Some(false) => "Unarchiving",
			None => "Updating",
		};
		let mut changed = Obj::new();
		for key in ["name", "description", "signature", "icon", "archived"] {
			let was_given = if key == "signature" { sig.is_some() } else { given(args, key) };
			if was_given && let Some(value) = space.get(key) {
				changed.insert(key, value.clone());
			}
		}
		let label = format!("{verb} {}", str_of(&space, "name"));
		self.done(json!({ "spaceId": space_id, "changed": Json::Obj(changed) }), vec![change(label, &Json::from(space_id), "space", space_id, "/space")])
	}

	pub fn add_space_file(&self, args: &Json) -> ToolOutcome {
		let (space_id, path, kind) = (str_of(args, "space_id"), str_of(args, "path"), str_of(args, "kind"));
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let (file, verb) = if args["name"].truthy() && args.get("text").is_some_and(|t| t.as_str().is_some()) {
			match self.write_space_file(&record, str_of(args, "name"), str_of(args, "text"), kind) {
				Ok(written) => written,
				Err(error) => return ToolOutcome::Err(error),
			}
		} else if !path.is_empty() {
			if let Some(problem) = shortcut_path_problem(&self.app, path) {
				return ToolOutcome::Err(problem);
			}
			match add_file_from_path(&self.app, space_id, path, kind) {
				Ok(file) => (file, "Adding"),
				Err(failure) => return ToolOutcome::Err(failure.error),
			}
		} else {
			return ToolOutcome::Err("Give path, or name and text.".to_owned());
		};
		let note = if kind == "study" { format!("Added. {READING_NOTE}") } else { "Added.".to_owned() };
		let label = format!("{verb} {}", str_of(&file, "name"));
		let change = change(label, &Json::from(space_id), "file", str_of(&file, "id"), "/space/files");
		self.done(json!({ "file": file, "note": note }), vec![change])
	}

	/// Writes a file from text: one it wrote before by that name is replaced and keeps its id; the
	/// learner's own file by that name is never written over.
	fn write_space_file(&self, record: &Json, name: &str, text: &str, kind: &str) -> Result<(Json, &'static str), String> {
		let Some(file_name) = written_file_name(name) else { return Err("Give a plain file name like \"Study guide.md\", with no folders or control characters.".to_owned()) };
		if text.trim().is_empty() {
			return Err("The text is empty.".to_owned());
		}
		if text.chars().count() > WRITTEN_TEXT_MAX {
			return Err("The text is longer than 20,000 characters. Shorten it or split it into two files.".to_owned());
		}
		let space_id = str_of(record, "id");
		let bytes = gs_base::text::utf8_bytes(text);
		let same = record["files"].as_arr().into_iter().flatten().find(|f| str_of(f, "name") == file_name);
		let written = match same {
			Some(file) if file["written"] == Json::Bool(true) => replace_copied_file(&self.app, space_id, str_of(file, "id"), &bytes, kind).map(|f| (f, "Changing")),
			Some(_) => return Err(format!("This space already has a file named {file_name} that you didn't write. Pick another name.")),
			None => add_written_file(&self.app, space_id, &file_name, &bytes, kind).map(|f| (f, "Adding")),
		};
		written.map_err(|failure| failure.error)
	}

	pub fn set_space_file_kind(&self, args: &Json) -> ToolOutcome {
		let (space_id, kind) = (str_of(args, "space_id"), str_of(args, "kind"));
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		let (mut files, mut refused, mut changes) = (Vec::new(), Vec::new(), Vec::new());
		for file_id in args["file_ids"].as_arr().into_iter().flatten() {
			let file_id = file_id.as_str().unwrap_or("");
			let file = match set_file_kind(&self.app, space_id, file_id, kind) {
				Ok(file) => file,
				Err(failure) => {
					refused.push(json!({ "fileId": file_id, "error": failure.error }));
					continue;
				}
			};
			files.push(json!({ "id": file["id"], "name": file["name"], "kind": kind, "status": file["status"] }));
			let label = format!("Marking {} as {}", str_of(&file, "name"), if kind == "study" { "study material" } else { "space info" });
			changes.push(change(label, &Json::from(space_id), "file", str_of(&file, "id"), "/space/files"));
		}
		if files.is_empty() {
			return ToolOutcome::Err(refused.iter().map(|r| format!("{}: {}", str_of(r, "fileId"), str_of(r, "error"))).collect::<Vec<_>>().join("\n"));
		}
		let mut value = json!({ "files": files });
		if !refused.is_empty()
			&& let Some(obj) = value.as_obj_mut()
		{
			obj.insert("refused", refused);
		}
		self.done(value, changes)
	}

	pub fn add_space_deadline(&self, args: &Json) -> ToolOutcome {
		let space_id = str_of(args, "space_id");
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		let (mut added, mut refused) = (Vec::new(), Vec::new());
		for d in args["deadlines"].as_arr().into_iter().flatten() {
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
					if let Some(name) = d.get("name") {
						entry.insert("name", name.clone());
					}
					entry.insert("error", failure.error);
					refused.push(Json::Obj(entry));
				},
			}
		}
		if added.is_empty() {
			return ToolOutcome::Err(refused.iter().map(|r| format!("{}: {}", template_text(r.get("name")), str_of(r, "error"))).collect::<Vec<_>>().join("\n"));
		}
		let changes = added.iter().map(|d| change(format!("Adding {}", str_of(d, "name")), &Json::from(space_id), "deadline", str_of(d, "id"), &deadline_page(str_of(d, "id")))).collect();
		let mut value = json!({ "deadlines": added });
		if !refused.is_empty()
			&& let Some(obj) = value.as_obj_mut()
		{
			obj.insert("refused", refused);
		}
		self.done(value, changes)
	}

	pub fn update_space_deadline(&self, args: &Json) -> ToolOutcome {
		let (space_id, deadline_id) = (str_of(args, "space_id"), str_of(args, "deadline_id"));
		if !self.space_exists(space_id) {
			return no_space(space_id);
		}
		let mut patch = Obj::new();
		for (arg, key) in [
			("kind", "kind"),
			("name", "name"),
			("date", "date"),
			("time", "time"),
			("file_ids", "fileIds"),
			("left_out_ids", "leftOutIds"),
			("source", "source"),
			("assignment_file_id", "assignmentFileId"),
			("about_file_id", "aboutFileId"),
			("done", "done"),
		] {
			if given(args, arg) {
				patch.insert(key, args[arg].clone());
			}
		}
		let deadline = match update_space_deadline(&self.app, space_id, deadline_id, &Json::Obj(patch)) {
			Ok(deadline) => deadline,
			Err(failure) => return ToolOutcome::Err(failure.error),
		};
		let others = ["kind", "name", "file_ids", "left_out_ids", "source", "assignment_file_id", "about_file_id", "done"];
		let moved = (given(args, "date") || given(args, "time")) && !others.iter().any(|k| given(args, k));
		let name = str_of(&deadline, "name");
		let label = match args["done"].as_bool() {
			Some(true) => format!("Marking {name} done"),
			Some(false) => format!("Marking {name} not done"),
			_ => format!("{} {name}", if moved { "Moving" } else { "Changing" }),
		};
		self.done(json!({ "deadline": deadline }), vec![change(label, &Json::from(space_id), "deadline", deadline_id, &deadline_page(deadline_id))])
	}

	pub fn remove_space_deadline(&self, args: &Json) -> ToolOutcome {
		let (space_id, deadline_id) = (str_of(args, "space_id"), str_of(args, "deadline_id"));
		let Some(record) = self.app.stores.spaces.get_space(space_id) else { return no_space(space_id) };
		let removed_name = record["deadlines"].as_arr().into_iter().flatten().find(|d| d["id"].as_str() == Some(deadline_id)).and_then(|d| d["name"].as_str()).unwrap_or("a deadline").to_owned();
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

	pub fn link_space_folder(&self, args: &Json) -> ToolOutcome {
		let (space_id, path) = (str_of(args, "space_id"), str_of(args, "path"));
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
		self.done(json!({ "space": view, "note": format!("Linked. {READING_NOTE}") }), vec![change(label, &Json::from(space_id), "space", space_id, "/space/files")])
	}

	pub async fn start_lesson(&self, args: &Json) -> ToolOutcome {
		let topic = str_of(args, "topic");
		let raw = args["space_id"].as_str();
		let Some(scope) = parse_space_scope(raw) else {
			return ToolOutcome::Err(format!("\"{}\" is not a space id. Use list_spaces.", template_text(args.get("space_id"))));
		};
		let space = match &scope {
			Some(id) => match self.app.stores.spaces.get_space(id) {
				Some(space) => Some(space),
				None => return no_space(id),
			},
			None => None,
		};
		if space.as_ref().is_some_and(|s| s["archived"].truthy()) {
			return ToolOutcome::Err("This space is archived. Ask the learner to unarchive it in Edit space first.".to_owned());
		}
		let input = CreateLessonInput { space_id: scope.clone(), start: LessonStart::Typed { title: topic.to_owned(), picks: Vec::new() } };
		let chat = match create_lesson(&self.app, input) {
			Ok(Ok(created)) => created.chat,
			Ok(Err(not_found)) => return ToolOutcome::Err(not_found.error.to_owned()),
			Err(err) => return ToolOutcome::Err(err),
		};
		let (chat_id, title) = (str_of(&chat, "id").to_owned(), str_of(&chat, "title").to_owned());
		if let Err(body) = (self.send)(chat_id.clone(), topic.to_owned()).await {
			return ToolOutcome::Err(format!("The lesson was created but could not start: {body}"));
		}
		let space_json = scope.map_or(Json::Null, Json::from);
		let started = self.opened(change(format!("Starting {title}"), &space_json, "lesson", &chat_id, &format!("/chat/{chat_id}")));
		self.done(json!({ "status": "started", "lessonId": chat_id, "title": title }), vec![started])
	}

	/// Runs one space tool by name; None for a name that is not one.
	pub async fn run(&self, name: &str, args: &Json) -> Option<ToolOutcome> {
		Some(match name {
			"list_spaces" => self.list_spaces(args),
			"read_space" => self.read_space(args),
			"search_space_files" => self.search_space_files(args).await,
			"read_passage" => self.read_passage(args),
			"create_space" => self.create_space(args),
			"update_space" => self.update_space(args),
			"add_space_file" => self.add_space_file(args),
			"set_space_file_kind" => self.set_space_file_kind(args),
			"add_space_deadline" => self.add_space_deadline(args),
			"update_space_deadline" => self.update_space_deadline(args),
			"remove_space_deadline" => self.remove_space_deadline(args),
			"link_space_folder" => self.link_space_folder(args),
			"start_lesson" => self.start_lesson(args).await,
			_ => return None,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::agent_actions::recent_agent_actions;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_space_made_from_talk_opens_and_one_made_by_the_agent_alone_does_not() {
		let root = scratch_dir("space-actions-open");
		let app = test_app(&root);
		let send: SendFirstMessage = Arc::new(|_, _| Box::pin(async { Ok(()) }));
		for (name, open_started) in [("Algebra", true), ("Biology", false)] {
			let made = space_actions(&app, Some("Teacher"), send.clone(), open_started).create_space(&json!({ "name": name }));
			assert!(matches!(made, ToolOutcome::Ok { .. }));
			let action = recent_agent_actions(&app).into_iter().find(|a| a["label"].as_str() == Some(&format!("Creating {name}"))).unwrap();
			assert_eq!(action["open"].as_bool(), open_started.then_some(true));
		}
	}

	fn actions(app: &Arc<App>) -> SpaceActions {
		let send: SendFirstMessage = Arc::new(|_, _| Box::pin(async { Ok(()) }));
		space_actions(app, Some("Teacher"), send, true)
	}

	fn value(outcome: ToolOutcome) -> (Json, Vec<SpaceChange>) {
		match outcome {
			ToolOutcome::Ok { value, changes } => (value, changes),
			ToolOutcome::Err(error) => panic!("{error}"),
		}
	}

	#[tokio::test]
	async fn the_teacher_sets_up_an_interview_space_from_talk() {
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

	#[tokio::test]
	async fn the_agent_writes_over_only_files_it_wrote_and_only_plain_names_and_short_texts() {
		let root = scratch_dir("space-actions-written");
		let app = test_app(&root);
		let actions = actions(&app);
		let (made, _) = value(actions.create_space(&json!({ "name": "Algebra" })));
		let space_id = made["space"]["id"].as_str().unwrap().to_owned();
		let own = crate::spaces::add_copied_file(&app, &space_id, "notes.md", b"My own notes.", "study").unwrap();
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
		assert_eq!(write("notes", "Overwritten."), Err("This space already has a file named notes.md that you didn't write. Pick another name.".to_owned()));
		assert_eq!(write("Syllabus.md", "Overwritten."), Err("This space already has a file named Syllabus.md that you didn't write. Pick another name.".to_owned()));
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
	fn folder_names_like_the_ts() {
		assert_eq!(folder_name(Some("/Users/me/Course Notes/")), "Course Notes");
		assert_eq!(folder_name(Some("C:\\a\\b\\\\")), "b");
		assert_eq!(folder_name(Some("/")), "a folder");
		assert_eq!(folder_name(Some("")), "a folder");
		assert_eq!(folder_name(None), "a folder");
	}
}
