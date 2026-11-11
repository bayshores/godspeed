//! /api/classes, /api/classes/{id}, its files, folder and deadlines (not cheat sheets),
//! /api/deadlines and /api/deadlines/{id} (src/app/api/classes, src/app/api/deadlines).

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Uri, header};
use axum::response::Response;
use gs_base::text;
use gs_core::contracts::class::{SIGNATURE_MAX, clean_signature, is_class_icon, is_class_id};
use gs_json::{Json, Obj, json};
use gs_services::App;
use gs_services::app::agent_actions::record_deadline_change;
use gs_services::app::agent_folder::{class_shortcut_dir, shortcut_path_problem};
use gs_services::classes::{
	ClassFailure, add_class_deadline, add_copied_file, create_class, deadline_with_class, delete_class, folder_status_of, get_class, link_folder, list_class_deadlines, list_classes, list_open_deadlines,
	remove_class_deadline, remove_file, retry_file, scan_linked_folder, set_file_kind, start_class_scanner, unlink_folder, update_class, update_class_deadline,
};
use gs_services::classes::class_card::class_file_path;
use gs_services::turns::ask_about_new_deadlines;
use gs_services::turns::homework::homework_view;

use crate::http::form;
use crate::http::paths::{param, search_params};
use crate::http::reply::{self, Unhandled, json_body, read_body};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/classes", ApiRoute::new().get(list).post(create).into_route())
		.route("/api/classes/{id}", ApiRoute::new().get(read).put(edit).delete(remove).into_route())
		.route("/api/classes/{id}/files", ApiRoute::new().post(add_files).into_route())
		.route("/api/classes/{id}/files/{file_id}", ApiRoute::new().get(file_path).put(change_file).delete(remove_one_file).into_route())
		.route("/api/classes/{id}/folder", ApiRoute::new().put(link).delete(unlink).into_route())
		.route("/api/classes/{id}/deadlines", ApiRoute::new().get(deadlines).post(add_deadline).into_route())
		.route("/api/classes/{id}/deadlines/{deadline_id}", ApiRoute::new().put(change_deadline).delete(remove_deadline).into_route())
		.route("/api/classes/{id}/deadlines/{deadline_id}/homework", ApiRoute::new().get(homework).into_route())
		.route("/api/deadlines", ApiRoute::new().get(open_deadlines).into_route())
		.route("/api/deadlines/{id}", ApiRoute::new().get(deadline).into_route())
}

fn error(status: u16, message: &str) -> Response {
	reply::json(status, &json!({ "error": message }))
}

fn no_such_class() -> Response {
	error(404, "No such class")
}

/// A refused class action as `{ error, code }`; what the TS threw as an empty 500.
fn refused(failure: ClassFailure) -> Result<Response, Unhandled> {
	if failure.is_thrown() {
		return Err(Unhandled::from(failure.error));
	}
	Ok(reply::json(failure.status, &json!({ "error": failure.error, "code": failure.code })))
}

/// `(await req.json().catch(() => ({})))` read for its fields: `{}` when the body is not JSON, and
/// a throw (500) for `null`, whose fields cannot be read.
async fn fields(body: Body) -> Result<Json, Unhandled> {
	match json_body(body).await {
		None => Ok(json!({})),
		Some(Json::Null) => Err(Unhandled::from("body is null")),
		Some(body) => Ok(body),
	}
}

/// `body.key`, None where it is `undefined` (missing, or a body that is not an object).
fn field<'a>(body: &'a Json, key: &str) -> Option<&'a Json> {
	body.as_obj().and_then(|o| o.get(key))
}

/// GET /api/classes: every class, archived included (the switcher filters). Starts the folder
/// scanner.
async fn list(State(app): State<Arc<App>>) -> Response {
	start_class_scanner(&app);
	reply::json(200, &json!({ "classes": list_classes(&app) }))
}

/// POST /api/classes { name, description? }.
async fn create(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(name) = field(&body, "name").and_then(Json::as_str).filter(|n| !text::trim(n).is_empty()) else {
		return Ok(error(400, "A class needs a name"));
	};
	let mut init = Obj::new();
	init.insert("name", name);
	if let Some(description) = field(&body, "description").filter(|d| d.as_str().is_some()) {
		init.insert("description", description.clone());
	}
	let class = create_class(&app, &Json::Obj(init))?;
	Ok(reply::json(201, &json!({ "class": class })))
}

/// GET /api/classes/{id}: `{ class, folder, shortcuts }`; `?scan=1` rescans the linked folder
/// first (the switcher asks when you switch to the class).
async fn read(State(app): State<Arc<App>>, Path(id): Path<String>, uri: Uri) -> Response {
	if !is_class_id(&id) {
		return no_such_class();
	}
	if param(&search_params(uri.query().unwrap_or_default()), "scan") == Some("1") {
		scan_linked_folder(&app, &id, false);
	}
	let Some(record) = get_class(&app, &id) else { return no_such_class() };
	let shortcuts = class_shortcut_dir(&app, &id).map_or(Json::Null, Json::from);
	reply::json(200, &json!({ "class": record, "folder": folder_status_of(&app, &id), "shortcuts": shortcuts }))
}

/// PUT /api/classes/{id} { name?, description?, archived?, signature?, icon?, rules? } (a null
/// signature clears it).
async fn edit(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	let body = fields(body).await?;
	let name = field(&body, "name");
	if name.is_some_and(|n| n.as_str().is_none_or(|n| text::trim(n).is_empty())) {
		return Ok(error(400, "A class needs a name"));
	}
	let signature = match field(&body, "signature") {
		Some(Json::Null) => Some(Json::Null),
		Some(raw @ (Json::Obj(_) | Json::Arr(_))) => match clean_signature(raw) {
			Some(sig) => Some(sig),
			None => return Ok(error(400, &format!("A signature is one line of at most {SIGNATURE_MAX} characters"))),
		},
		_ => None,
	};
	let icon = field(&body, "icon");
	if icon.is_some_and(|i| !is_class_icon(i)) {
		return Ok(error(400, "Unknown class icon"));
	}
	let rules = field(&body, "rules");
	if rules.is_some_and(|r| r.as_arr().is_none_or(|list| list.iter().any(|r| r.as_str().is_none()))) {
		return Ok(error(400, "rules must be a list of strings"));
	}
	let mut patch = Obj::new();
	if let Some(name) = name {
		patch.insert("name", name.clone());
	}
	if let Some(description) = field(&body, "description").filter(|d| d.as_str().is_some()) {
		patch.insert("description", description.clone());
	}
	if let Some(archived) = field(&body, "archived").filter(|a| a.as_bool().is_some()) {
		patch.insert("archived", archived.clone());
	}
	if let Some(signature) = signature {
		patch.insert("signature", signature);
	}
	if let Some(icon) = icon {
		patch.insert("icon", icon.clone());
	}
	if let Some(rules) = rules {
		patch.insert("rules", rules.clone());
	}
	match update_class(&app, &id, &Json::Obj(patch)) {
		Ok(class) => Ok(reply::json(200, &json!({ "class": class }))),
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/classes/{id}: the class with its lessons, copied files and graph (a linked folder
/// is never touched); `lessonIds` names the removed lessons so the window can drop their drafts.
async fn remove(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	match delete_class(&app, &id).await {
		Ok(lesson_ids) => Ok(reply::json(200, &json!({ "ok": true, "lessonIds": lesson_ids }))),
		Err(failure) => refused(failure),
	}
}

/// POST /api/classes/{id}/files: multipart, field "kind" ("study" or "info") and one or more
/// "files".
async fn add_files(State(app): State<Arc<App>>, Path(id): Path<String>, headers: HeaderMap, body: Body) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
	let Some(entries) = form::parse(content_type, &read_body(body).await) else {
		return Ok(error(400, "Invalid form body"));
	};
	let kind = match entries.iter().find(|e| e.name == "kind").map(|e| (&e.file_name, e.text())) {
		Some((None, kind)) if kind == "info" || kind == "study" => kind,
		_ => return Ok(error(400, "kind must be \"study\" or \"info\"")),
	};
	let files: Vec<&form::Entry> = entries.iter().filter(|e| e.name == "files" && e.file_name.is_some()).collect();
	if files.is_empty() {
		return Ok(error(400, "no files"));
	}
	let mut results = Vec::new();
	for file in files {
		let name = file.file_name.clone().unwrap_or_default();
		match add_copied_file(&app, &id, &name, &file.value, &kind) {
			Ok(added) => results.push(json!({ "name": name, "ok": true, "file": added })),
			Err(failure) if failure.code == "not_found" => return Ok(error(404, &failure.error)),
			Err(failure) if failure.is_thrown() => return refused(failure),
			Err(failure) => results.push(json!({ "name": name, "ok": false, "error": failure.error })),
		}
	}
	Ok(reply::json(200, &json!({ "results": results })))
}

/// GET /api/classes/{id}/files/{file_id}: `{ path }`, the file's full path (Show in Finder).
async fn file_path(State(app): State<Arc<App>>, Path((id, file_id)): Path<(String, String)>) -> Response {
	let record = if is_class_id(&id) { get_class(&app, &id) } else { None };
	let found = record.as_ref().and_then(|r| {
		let file = r["files"].as_arr()?.iter().find(|f| f["id"].as_str() == Some(file_id.as_str()))?;
		class_file_path(&app, r, file)
	});
	match found {
		Some(path) => reply::json(200, &json!({ "path": path })),
		None => error(404, "No such file"),
	}
}

/// PUT /api/classes/{id}/files/{file_id}: `{ kind: "study" | "info" }`, or `{ retry: true }`.
async fn change_file(State(app): State<Arc<App>>, Path((id, file_id)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	let body = fields(body).await?;
	if field(&body, "retry") == Some(&Json::Bool(true)) {
		return match retry_file(&app, &id, &file_id) {
			Ok(()) => Ok(reply::json(200, &json!({ "ok": true }))),
			Err(failure) => refused(failure),
		};
	}
	let Some(kind) = field(&body, "kind").and_then(Json::as_str).filter(|k| *k == "study" || *k == "info") else {
		return Ok(error(400, "kind must be \"study\" or \"info\""));
	};
	match set_file_kind(&app, &id, &file_id, kind) {
		Ok(file) => Ok(reply::json(200, &json!({ "file": file }))),
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/classes/{id}/files/{file_id}: a copied file and its facts.
async fn remove_one_file(State(app): State<Arc<App>>, Path((id, file_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	match remove_file(&app, &id, &file_id) {
		Ok(()) => Ok(reply::json(200, &json!({ "ok": true }))),
		Err(failure) => refused(failure),
	}
}

/// PUT /api/classes/{id}/folder { path }: link (or re-link) a folder on this computer.
async fn link(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	let body = fields(body).await?;
	let Some(path) = field(&body, "path").and_then(Json::as_str).map(text::trim).filter(|p| !p.is_empty()) else {
		return Ok(error(400, "path is required"));
	};
	if let Some(problem) = shortcut_path_problem(&app, path) {
		return Ok(error(400, &problem));
	}
	match link_folder(&app, &id, path) {
		Ok(class) => Ok(reply::json(200, &json!({ "class": class }))),
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/classes/{id}/folder: unlink; the folder's files leave the class with their facts
/// (the folder itself is never touched).
async fn unlink(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	match unlink_folder(&app, &id) {
		Ok(class) => Ok(reply::json(200, &json!({ "class": class }))),
		Err(failure) => refused(failure),
	}
}

/// GET /api/classes/{id}/deadlines: soonest due first.
async fn deadlines(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	match list_class_deadlines(&app, &id) {
		Ok(deadlines) => Ok(reply::json(200, &json!({ "deadlines": deadlines }))),
		Err(failure) => refused(failure),
	}
}

/// POST /api/classes/{id}/deadlines { kind, name, date, time?, fileIds? }.
async fn add_deadline(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	let body = fields(body).await?;
	let mut init = Obj::new();
	for key in ["kind", "name", "date"] {
		if let Some(value) = field(&body, key) {
			init.insert(key, value.clone());
		}
	}
	if let Some(time) = field(&body, "time").filter(|t| !t.is_null()) {
		init.insert("time", time.clone());
	}
	if let Some(file_ids) = field(&body, "fileIds") {
		init.insert("fileIds", file_ids.clone());
	}
	let deadline = match add_class_deadline(&app, &id, &Json::Obj(init)) {
		Ok(deadline) => deadline,
		Err(failure) => return refused(failure),
	};
	record_deadline_change(&app, &id, &deadline, &Json::from("added"));
	// Nothing linked: the agent works out what it covers.
	if deadline["fileIds"].as_arr().is_none_or(Vec::is_empty) {
		ask_about_new_deadlines(&app);
	}
	Ok(reply::json(201, &json!({ "deadline": deadline })))
}

/// PUT /api/classes/{id}/deadlines/{deadline_id}: a patch of kind, name, date, time (null clears),
/// fileIds, leftOutIds, source (null clears), assignmentFileId (null clears) and done.
async fn change_deadline(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	let body = fields(body).await?;
	if field(&body, "done").is_some_and(|d| d.as_bool().is_none()) {
		return Ok(error(400, "done must be true or false"));
	}
	let mut patch = Obj::new();
	for key in ["kind", "name", "date", "time", "fileIds", "leftOutIds", "source", "assignmentFileId", "done"] {
		if let Some(value) = field(&body, key) {
			patch.insert(key, value.clone());
		}
	}
	let patch = Json::Obj(patch);
	match update_class_deadline(&app, &id, &deadline_id, &patch) {
		Ok(deadline) => {
			record_deadline_change(&app, &id, &deadline, &patch);
			Ok(reply::json(200, &json!({ "deadline": deadline })))
		}
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/classes/{id}/deadlines/{deadline_id}.
async fn remove_deadline(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(no_such_class());
	}
	match remove_class_deadline(&app, &id, &deadline_id) {
		Ok(()) => Ok(reply::json(200, &json!({ "ok": true }))),
		Err(failure) => refused(failure),
	}
}

/// GET /api/classes/{id}/deadlines/{deadline_id}/homework: what a homework lesson shows of its
/// deadline. 404 once the class or deadline is gone.
async fn homework(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Response {
	let view = if is_class_id(&id) { homework_view(&app, &id, &deadline_id) } else { None };
	match view {
		Some(homework) => reply::json(200, &json!({ "homework": homework })),
		None => error(404, "No such deadline"),
	}
}

/// GET /api/deadlines: every open deadline of every class not archived, soonest due first (Home).
async fn open_deadlines(State(app): State<Arc<App>>) -> Response {
	reply::json(200, &json!({ "deadlines": list_open_deadlines(&app) }))
}

/// GET /api/deadlines/{id}: one deadline with its class id. 404 once it is gone.
async fn deadline(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
	match deadline_with_class(&app, &id) {
		Some(owner) => reply::json(200, &owner),
		None => error(404, "No such deadline"),
	}
}
