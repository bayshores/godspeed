//! The class tools' work (class-actions.ts), shared by the outside agent's MCP server and the
//! Talk chat: each checks its arguments, changes the class, records what it changed for the
//! teacher's panel, and returns what the agent sees. `caller` names the agent in the panel's rows;
//! `send` gives a new lesson its first message (the chat handler's input, passed in by the
//! caller).

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use gs_base::{clock, time};
use gs_core::classes::class_tools::{ClassChange, ToolOutcome};
use gs_core::classes::today_note::local_day;
use gs_core::contracts::class::{SIGNATURE_MAX, clean_signature, parse_class_scope};
use gs_json::{Json, Obj, json};
use gs_search::index::PassageRef;

use super::class_card::{class_file_path, class_topics};
use super::files::{file_in, files_of, str_of};
use super::{add_class_deadline, add_file_from_path, create_class, link_folder, remove_class_deadline, set_file_kind, update_class, update_class_deadline};
use crate::App;
use crate::app::agent_actions::note_agent_action;
use crate::app::agent_folder::shortcut_path_problem;
use crate::turns::lessons::{CreateLessonInput, LessonStart, create_lesson};

/// Study files are read by the agent itself, as background work items.
pub const READING_NOTE: &str = "The reading work comes to you through wait_for_work; it does not progress until you run the loop.";

/// Sends a lesson's first message (chat id, text); Err holds the refusal's body text.
pub type SendFirstMessage = Arc<dyn Fn(String, String) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

/// The class tools for one caller. `open_started`: the learner asked for the lesson in Talk, so
/// the window opens it even with Follow off.
pub fn class_actions(app: &Arc<App>, caller: Option<&str>, send: SendFirstMessage, open_started: bool) -> ClassActions {
	ClassActions { app: app.clone(), caller: caller.map(str::to_owned), send, open_started }
}

pub struct ClassActions {
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

fn no_class(class_id: &str) -> ToolOutcome {
	ToolOutcome::Err(format!("No class \"{class_id}\". Use list_classes."))
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

/// A change for the panel: `{ label, classId, target: { kind, id }, page }`.
fn change(label: String, class_id: &Json, kind: &str, id: &str, page: &str) -> Json {
	json!({ "label": label, "classId": class_id, "target": { "kind": kind, "id": id }, "page": page })
}

/// The signature argument cleaned: Ok(None) when not given, Err when given but not valid.
fn signature_arg(args: &Json) -> Result<Option<Json>, ()> {
	if !args["signature"].truthy() {
		return Ok(None);
	}
	clean_signature(&args["signature"]).map(Some).ok_or(())
}

impl ClassActions {
	fn class_exists(&self, class_id: &str) -> bool {
		self.app.stores.classes.get_class(class_id).is_some()
	}

	/// Each change is recorded for the panel and returned for the chat.
	fn done(&self, value: Json, changes: Vec<Json>) -> ToolOutcome {
		for change in &changes {
			note_agent_action(&self.app, self.caller.as_deref(), change);
		}
		let changes = changes.iter().map(|c| ClassChange { label: str_of(c, "label").to_owned(), page: str_of(c, "page").to_owned() }).collect();
		ToolOutcome::Ok { value, changes }
	}

	/// A class as agents see it: summary, file counts by status (and the files that could not be
	/// read, or every file with `with_files`), the graph's topics, deadlines, lessons. A linked
	/// folder can hold 500 files, so the full list comes only on request. Err when the class's
	/// graph cannot be read.
	fn class_view(&self, class_id: &str, with_files: bool) -> Result<Option<Json>, String> {
		let app = &self.app;
		let Some(record) = app.stores.classes.get_class(class_id) else { return Ok(None) };
		let files = files_of(&record);
		let sizes = if with_files { app.search.file_extents(class_id) } else { Obj::new() };
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
					entry.insert("path", class_file_path(app, &record, f).map_or(Json::Null, Json::from));
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
		view.insert("topics", class_topics(app, class_id)?);
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
				Json::Obj(entry)
			})
			.collect();
		view.insert("deadlines", deadlines);
		let lessons: Vec<Json> = app
			.stores
			.chats
			.list_chats()
			.iter()
			.filter(|c| c["classId"].as_str() == Some(class_id))
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

	pub fn list_classes(&self, _args: &Json) -> ToolOutcome {
		let lessons = self.app.stores.chats.list_chats();
		let classes: Vec<Json> = self
			.app
			.stores
			.classes
			.list_classes()
			.iter()
			.map(|c| {
				let in_class = lessons.iter().filter(|l| l["classId"].as_str().is_some_and(|id| Some(id) == c["id"].as_str())).count();
				json!({
					"id": c["id"],
					"name": c["name"],
					"description": c["description"],
					"icon": if c["icon"].is_null() { Json::Null } else { c["icon"].clone() },
					"archived": c["archived"],
					"linkedFolder": if c["linkedFolder"].is_null() { Json::Null } else { c["linkedFolder"].clone() },
					"files": c["fileCount"],
					"lessons": in_class,
				})
			})
			.collect();
		let no_class_lessons = lessons.iter().filter(|l| !l["classId"].truthy()).count();
		self.done(json!({ "classes": classes, "noClassLessons": no_class_lessons }), Vec::new())
	}

	pub fn read_class(&self, args: &Json) -> ToolOutcome {
		let class_id = str_of(args, "class_id");
		match self.class_view(class_id, args["files"].truthy()) {
			Ok(Some(view)) => self.done(view, Vec::new()),
			Ok(None) => no_class(class_id),
			Err(err) => ToolOutcome::Err(err),
		}
	}

	pub async fn search_class_files(&self, args: &Json) -> ToolOutcome {
		let class_id = str_of(args, "class_id");
		let Some(record) = self.app.stores.classes.get_class(class_id) else { return no_class(class_id) };
		let limit = args["limit"].as_f64().map_or(8, |l| l as usize);
		match self.app.search.search_class_files(class_id, files_of(&record), str_of(args, "query"), limit).await {
			Ok(found) => self.done(Json::from(found), Vec::new()),
			Err(err) => ToolOutcome::Err(err),
		}
	}

	pub fn read_passage(&self, args: &Json) -> ToolOutcome {
		let class_id = str_of(args, "class_id");
		let Some(record) = self.app.stores.classes.get_class(class_id) else { return no_class(class_id) };
		let at = if args["passage_id"].truthy() {
			PassageRef::Passage(str_of(args, "passage_id").to_owned())
		} else if args["file_id"].truthy() && args["range"].truthy() {
			PassageRef::Place { file_id: str_of(args, "file_id").to_owned(), range: str_of(args, "range").to_owned() }
		} else {
			return ToolOutcome::Err("Give passage_id, or file_id with range.".to_owned());
		};
		self.done(Json::from(self.app.search.read_passage(class_id, files_of(&record), &at)), Vec::new())
	}

	pub fn create_class(&self, args: &Json) -> ToolOutcome {
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
		let created = match create_class(&self.app, &Json::Obj(init)) {
			Ok(created) => created,
			Err(err) => return ToolOutcome::Err(err),
		};
		let id = str_of(&created, "id");
		let label = format!("Creating {}", str_of(&created, "name"));
		let view = match self.class_view(id, false) {
			Ok(view) => view,
			Err(err) => return ToolOutcome::Err(err),
		};
		self.done(json!({ "class": view }), vec![change(label, &created["id"], "class", id, "/class")])
	}

	pub fn update_class(&self, args: &Json) -> ToolOutcome {
		let class_id = str_of(args, "class_id");
		if !self.class_exists(class_id) {
			return no_class(class_id);
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
		let cls = match update_class(&self.app, class_id, &Json::Obj(patch)) {
			Ok(cls) => cls,
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
			if was_given && let Some(value) = cls.get(key) {
				changed.insert(key, value.clone());
			}
		}
		let label = format!("{verb} {}", str_of(&cls, "name"));
		self.done(json!({ "classId": class_id, "changed": Json::Obj(changed) }), vec![change(label, &Json::from(class_id), "class", class_id, "/class")])
	}

	pub fn add_class_file(&self, args: &Json) -> ToolOutcome {
		let (class_id, path, kind) = (str_of(args, "class_id"), str_of(args, "path"), str_of(args, "kind"));
		if !self.class_exists(class_id) {
			return no_class(class_id);
		}
		if let Some(problem) = shortcut_path_problem(&self.app, path) {
			return ToolOutcome::Err(problem);
		}
		let file = match add_file_from_path(&self.app, class_id, path, kind) {
			Ok(file) => file,
			Err(failure) => return ToolOutcome::Err(failure.error),
		};
		let note = if kind == "study" { format!("Added. {READING_NOTE}") } else { "Added.".to_owned() };
		let label = format!("Adding {}", str_of(&file, "name"));
		let change = change(label, &Json::from(class_id), "file", str_of(&file, "id"), "/class/files");
		self.done(json!({ "file": file, "note": note }), vec![change])
	}

	pub fn set_class_file_kind(&self, args: &Json) -> ToolOutcome {
		let (class_id, kind) = (str_of(args, "class_id"), str_of(args, "kind"));
		if !self.class_exists(class_id) {
			return no_class(class_id);
		}
		let (mut files, mut refused, mut changes) = (Vec::new(), Vec::new(), Vec::new());
		for file_id in args["file_ids"].as_arr().into_iter().flatten() {
			let file_id = file_id.as_str().unwrap_or("");
			let file = match set_file_kind(&self.app, class_id, file_id, kind) {
				Ok(file) => file,
				Err(failure) => {
					refused.push(json!({ "fileId": file_id, "error": failure.error }));
					continue;
				}
			};
			files.push(json!({ "id": file["id"], "name": file["name"], "kind": kind, "status": file["status"] }));
			let label = format!("Marking {} as {}", str_of(&file, "name"), if kind == "study" { "study material" } else { "course info" });
			changes.push(change(label, &Json::from(class_id), "file", str_of(&file, "id"), "/class/files"));
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

	pub fn add_class_deadline(&self, args: &Json) -> ToolOutcome {
		let class_id = str_of(args, "class_id");
		if !self.class_exists(class_id) {
			return no_class(class_id);
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
			match add_class_deadline(&self.app, class_id, &Json::Obj(init)) {
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
		let changes = added.iter().map(|d| change(format!("Adding {}", str_of(d, "name")), &Json::from(class_id), "deadline", str_of(d, "id"), "/")).collect();
		let mut value = json!({ "deadlines": added });
		if !refused.is_empty()
			&& let Some(obj) = value.as_obj_mut()
		{
			obj.insert("refused", refused);
		}
		self.done(value, changes)
	}

	pub fn update_class_deadline(&self, args: &Json) -> ToolOutcome {
		let (class_id, deadline_id) = (str_of(args, "class_id"), str_of(args, "deadline_id"));
		if !self.class_exists(class_id) {
			return no_class(class_id);
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
			("done", "done"),
		] {
			if given(args, arg) {
				patch.insert(key, args[arg].clone());
			}
		}
		let deadline = match update_class_deadline(&self.app, class_id, deadline_id, &Json::Obj(patch)) {
			Ok(deadline) => deadline,
			Err(failure) => return ToolOutcome::Err(failure.error),
		};
		let others = ["kind", "name", "file_ids", "left_out_ids", "source", "assignment_file_id", "done"];
		let moved = (given(args, "date") || given(args, "time")) && !others.iter().any(|k| given(args, k));
		let name = str_of(&deadline, "name");
		let label = match args["done"].as_bool() {
			Some(true) => format!("Marking {name} done"),
			Some(false) => format!("Marking {name} not done"),
			_ => format!("{} {name}", if moved { "Moving" } else { "Changing" }),
		};
		self.done(json!({ "deadline": deadline }), vec![change(label, &Json::from(class_id), "deadline", deadline_id, "/")])
	}

	pub fn remove_class_deadline(&self, args: &Json) -> ToolOutcome {
		let (class_id, deadline_id) = (str_of(args, "class_id"), str_of(args, "deadline_id"));
		let Some(record) = self.app.stores.classes.get_class(class_id) else { return no_class(class_id) };
		let removed_name = record["deadlines"].as_arr().into_iter().flatten().find(|d| d["id"].as_str() == Some(deadline_id)).and_then(|d| d["name"].as_str()).unwrap_or("a deadline").to_owned();
		if let Err(failure) = remove_class_deadline(&self.app, class_id, deadline_id) {
			return ToolOutcome::Err(failure.error);
		}
		let mut removed = change(format!("Removing {removed_name}"), &Json::from(class_id), "deadline", deadline_id, "/");
		if let Some(obj) = removed.as_obj_mut() {
			obj.insert("removed", true);
		}
		self.done(json!({ "removed": deadline_id }), vec![removed])
	}

	pub fn link_class_folder(&self, args: &Json) -> ToolOutcome {
		let (class_id, path) = (str_of(args, "class_id"), str_of(args, "path"));
		if !self.class_exists(class_id) {
			return no_class(class_id);
		}
		if let Some(problem) = shortcut_path_problem(&self.app, path) {
			return ToolOutcome::Err(problem);
		}
		if let Err(failure) = link_folder(&self.app, class_id, path) {
			return ToolOutcome::Err(failure.error);
		}
		let label = format!("Linking {}", folder_name(Some(path)));
		let view = match self.class_view(class_id, false) {
			Ok(view) => view,
			Err(err) => return ToolOutcome::Err(err),
		};
		self.done(json!({ "class": view, "note": format!("Linked. {READING_NOTE}") }), vec![change(label, &Json::from(class_id), "class", class_id, "/class/files")])
	}

	pub async fn start_lesson(&self, args: &Json) -> ToolOutcome {
		let topic = str_of(args, "topic");
		let raw = args["class_id"].as_str();
		let Some(scope) = parse_class_scope(raw) else {
			return ToolOutcome::Err(format!("\"{}\" is not a class id. Use list_classes.", template_text(args.get("class_id"))));
		};
		if let Some(id) = &scope {
			let Some(cls) = self.app.stores.classes.get_class(id) else { return no_class(id) };
			if cls["archived"].truthy() {
				return ToolOutcome::Err("This class is archived. Ask the learner to unarchive it in Edit class first.".to_owned());
			}
		}
		let input = CreateLessonInput { class_id: scope.clone(), start: LessonStart::Typed { title: topic.to_owned(), picks: Vec::new() } };
		let chat = match create_lesson(&self.app, input) {
			Ok(Ok(created)) => created.chat,
			Ok(Err(not_found)) => return ToolOutcome::Err(not_found.error.to_owned()),
			Err(err) => return ToolOutcome::Err(err),
		};
		let (chat_id, title) = (str_of(&chat, "id").to_owned(), str_of(&chat, "title").to_owned());
		if let Err(body) = (self.send)(chat_id.clone(), topic.to_owned()).await {
			return ToolOutcome::Err(format!("The lesson was created but could not start: {body}"));
		}
		let class_json = scope.map_or(Json::Null, Json::from);
		let mut started = change(format!("Starting {title}"), &class_json, "lesson", &chat_id, &format!("/chat/{chat_id}"));
		if self.open_started
			&& let Some(obj) = started.as_obj_mut()
		{
			obj.insert("open", true);
		}
		self.done(json!({ "status": "started", "lessonId": chat_id, "title": title }), vec![started])
	}

	/// Runs one class tool by name; None for a name that is not one.
	pub async fn run(&self, name: &str, args: &Json) -> Option<ToolOutcome> {
		Some(match name {
			"list_classes" => self.list_classes(args),
			"read_class" => self.read_class(args),
			"search_class_files" => self.search_class_files(args).await,
			"read_passage" => self.read_passage(args),
			"create_class" => self.create_class(args),
			"update_class" => self.update_class(args),
			"add_class_file" => self.add_class_file(args),
			"set_class_file_kind" => self.set_class_file_kind(args),
			"add_class_deadline" => self.add_class_deadline(args),
			"update_class_deadline" => self.update_class_deadline(args),
			"remove_class_deadline" => self.remove_class_deadline(args),
			"link_class_folder" => self.link_class_folder(args),
			"start_lesson" => self.start_lesson(args).await,
			_ => return None,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn folder_names_like_the_ts() {
		assert_eq!(folder_name(Some("/Users/me/Course Notes/")), "Course Notes");
		assert_eq!(folder_name(Some("C:\\a\\b\\\\")), "b");
		assert_eq!(folder_name(Some("/")), "a folder");
		assert_eq!(folder_name(Some("")), "a folder");
		assert_eq!(folder_name(None), "a folder");
	}
}
