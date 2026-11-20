//! /api/spaces, /api/spaces/{id}, its files, folder and deadlines (not cheat sheets or mocks),
//! /api/deadlines and /api/deadlines/{id}.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Uri, header};
use axum::response::Response;
use gs_base::{clock, text};
use gs_core::contracts::space::{FILE_KIND_PROBLEM, SIGNATURE_MAX, clean_signature, is_space_color, is_space_icon, is_space_id};
use gs_core::spaces::file_state::FileKind;
use gs_core::spaces::problem_list::with_problem_lists;
use gs_core::spaces::today_note::local_day;
use gs_json::{Json, Obj, json};
use gs_services::App;
use gs_services::app::agent_actions::record_deadline_change;
use gs_services::app::agent_folder::{space_shortcut_dir, shortcut_path_problem};
use gs_services::spaces::{
	SpaceFailure, add_copied_file, add_space_deadline, close_space_work, deadline_with_space, delete_space, folder_status_of, link_folder, list_deadlines_done_on,
	deadline_about, list_open_deadlines, list_space_deadlines, remove_file, remove_space_deadline, retry_file, scan_linked_folder, set_file_kind, start_space_scanner, unlink_folder,
	update_space, update_space_deadline,
};
use gs_services::spaces::deadline_requests::overdue_asked;
use gs_services::spaces::space_card::space_file_path;
use gs_services::turns::ask_about_new_deadlines;
use gs_services::turns::homework::homework_view;

use crate::http::form;
use crate::http::paths::{param, query};
use crate::http::reply::{self, Unhandled, error, fields, read_body};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/spaces", ApiRoute::new().get(list).post(create).into_route())
		.route("/api/spaces/{id}", ApiRoute::new().get(read).put(edit).delete(remove).into_route())
		.route("/api/spaces/{id}/work", ApiRoute::new().delete(close_work).into_route())
		.route("/api/spaces/{id}/files", ApiRoute::new().post(add_files).into_route())
		.route("/api/spaces/{id}/files/{file_id}", ApiRoute::new().get(file_path).put(change_file).delete(remove_one_file).into_route())
		.route("/api/spaces/{id}/folder", ApiRoute::new().put(link).delete(unlink).into_route())
		.route("/api/spaces/{id}/deadlines", ApiRoute::new().get(deadlines).post(add_deadline).into_route())
		.route("/api/spaces/{id}/deadlines/{deadline_id}", ApiRoute::new().put(change_deadline).delete(remove_deadline).into_route())
		.route("/api/spaces/{id}/deadlines/{deadline_id}/homework", ApiRoute::new().get(homework).into_route())
		.route("/api/spaces/{id}/deadlines/{deadline_id}/about", ApiRoute::new().get(about).into_route())
		.route("/api/deadlines", ApiRoute::new().get(open_deadlines).into_route())
		.route("/api/deadlines/{id}", ApiRoute::new().get(deadline).into_route())
}

/// Copies each of `keys` the body gives (even as null) into `into`, in `keys` order.
fn copy_given(body: &Json, keys: &[&str], into: &mut Obj) {
	for &key in keys {
		if let Some(value) = body.get(key) {
			into.insert(key, value.clone());
		}
	}
}

/// A refused space action as `{ error, code }`; what the TS threw as an empty 500.
fn refused(failure: SpaceFailure) -> Result<Response, Unhandled> {
	if failure.is_thrown() {
		return Err(Unhandled::from(failure.error));
	}
	Ok(reply::coded(failure.status, &failure.error, &failure.code))
}

/// GET /api/spaces: every space, closed ones included (the switcher filters). Starts the folder
/// scanner.
async fn list(State(app): State<Arc<App>>) -> Response {
	start_space_scanner(&app);
	reply::json(200, &json!({ "spaces": app.stores.spaces.list_spaces() }))
}

/// POST /api/spaces { name, description? }.
async fn create(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(name) = body.get("name").and_then(Json::as_str).filter(|n| !text::trim(n).is_empty()) else {
		return Ok(error(400, "A space needs a name"));
	};
	let mut init = Obj::new();
	init.insert("name", name);
	if let Some(description) = body.get("description").filter(|d| d.as_str().is_some()) {
		init.insert("description", description.clone());
	}
	let space = app.stores.spaces.create_space(&Json::Obj(init))?;
	Ok(reply::json(201, &json!({ "space": space })))
}

/// GET /api/spaces/{id}: `{ space, folder, shortcuts }`; `?scan=1` rescans the linked folder
/// first (the switcher asks when you switch to the space).
async fn read(State(app): State<Arc<App>>, Path(id): Path<String>, uri: Uri) -> Response {
	if !is_space_id(&id) {
		return reply::no_such_space();
	}
	if param(&query(&uri), "scan") == Some("1") {
		scan_linked_folder(&app, &id, false);
	}
	let Some(record) = app.stores.spaces.get_space(&id) else { return reply::no_such_space() };
	let shortcuts = space_shortcut_dir(&app, &id).map_or(Json::Null, Json::from);
	reply::json(200, &json!({ "space": with_problem_lists(&record), "folder": folder_status_of(&app, &id), "shortcuts": shortcuts }))
}

/// PUT /api/spaces/{id} { name?, description?, closed?, signature?, icon?, color?, rules? } (a
/// null signature clears it).
async fn edit(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	let body = fields(body).await?;
	let name = body.get("name");
	if name.is_some_and(|n| n.as_str().is_none_or(|n| text::trim(n).is_empty())) {
		return Ok(error(400, "A space needs a name"));
	}
	let signature = match body.get("signature") {
		Some(Json::Null) => Some(Json::Null),
		Some(raw @ (Json::Obj(_) | Json::Arr(_))) => match clean_signature(raw) {
			Some(sig) => Some(sig),
			None => return Ok(error(400, &format!("A signature is one line of at most {SIGNATURE_MAX} characters"))),
		},
		_ => None,
	};
	let icon = body.get("icon");
	if icon.is_some_and(|i| !is_space_icon(i)) {
		return Ok(error(400, "Unknown space icon"));
	}
	let color = body.get("color");
	if color.is_some_and(|c| !is_space_color(c)) {
		return Ok(error(400, "Unknown space color"));
	}
	let rules = body.get("rules");
	if rules.is_some_and(|r| r.as_arr().is_none_or(|list| list.iter().any(|r| r.as_str().is_none()))) {
		return Ok(error(400, "rules must be a list of strings"));
	}
	let mut patch = Obj::new();
	if let Some(name) = name {
		patch.insert("name", name.clone());
	}
	if let Some(description) = body.get("description").filter(|d| d.as_str().is_some()) {
		patch.insert("description", description.clone());
	}
	if let Some(closed) = body.get("closed").filter(|c| c.as_bool().is_some()) {
		patch.insert("closed", closed.clone());
	}
	if let Some(signature) = signature {
		patch.insert("signature", signature);
	}
	if let Some(icon) = icon {
		patch.insert("icon", icon.clone());
	}
	if let Some(color) = color {
		patch.insert("color", color.clone());
	}
	if let Some(rules) = rules {
		patch.insert("rules", rules.clone());
	}
	match update_space(&app, &id, &Json::Obj(patch)) {
		Ok(space) => Ok(reply::json(200, &json!({ "space": space }))),
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/spaces/{id}: the space with its lessons, copied files and graph (a linked folder
/// is never touched); `lessonIds` names the removed lessons so the window can drop their drafts.
async fn remove(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	match delete_space(&app, &id).await {
		Ok(lesson_ids) => Ok(reply::json(200, &json!({ "ok": true, "lessonIds": lesson_ids }))),
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/spaces/{id}/work: closes the summary of the teacher's last round of work on the
/// space (nothing happens while a round is still going).
async fn close_work(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	close_space_work(&app, &id)?;
	Ok(reply::ok())
}

/// POST /api/spaces/{id}/files: multipart, one or more "files", added as the learner's own.
async fn add_files(State(app): State<Arc<App>>, Path(id): Path<String>, headers: HeaderMap, body: Body) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
	let Some(entries) = form::parse(content_type, &read_body(body).await) else {
		return Ok(error(400, "Invalid form body"));
	};
	let files: Vec<&form::Entry> = entries.iter().filter(|e| e.name == "files" && e.file_name.is_some()).collect();
	if files.is_empty() {
		return Ok(error(400, "no files"));
	}
	let mut results = Vec::new();
	for file in files {
		let name = file.file_name.clone().unwrap_or_default();
		match add_copied_file(&app, &id, &name, &file.value) {
			Ok(added) => results.push(json!({ "name": name, "ok": true, "file": added })),
			Err(failure) if failure.code == "not_found" => return Ok(error(404, &failure.error)),
			Err(failure) if failure.is_thrown() => return refused(failure),
			Err(failure) => results.push(json!({ "name": name, "ok": false, "error": failure.error })),
		}
	}
	Ok(reply::json(200, &json!({ "results": results })))
}

/// GET /api/spaces/{id}/files/{file_id}: `{ path }`, the file's full path (Show in Finder).
async fn file_path(State(app): State<Arc<App>>, Path((id, file_id)): Path<(String, String)>) -> Response {
	let record = if is_space_id(&id) { app.stores.spaces.get_space(&id) } else { None };
	let found = record.as_ref().and_then(|r| {
		let file = r["files"].as_arr()?.iter().find(|f| f["id"].as_str() == Some(file_id.as_str()))?;
		space_file_path(&app, r, file)
	});
	match found {
		Some(path) => reply::json(200, &json!({ "path": path })),
		None => error(404, "No such file"),
	}
}

/// PUT /api/spaces/{id}/files/{file_id}: `{ kind: "study" | "info" }`, or `{ retry: true }`.
async fn change_file(State(app): State<Arc<App>>, Path((id, file_id)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	let body = fields(body).await?;
	if body.get("retry") == Some(&Json::Bool(true)) {
		return match retry_file(&app, &id, &file_id) {
			Ok(()) => Ok(reply::ok()),
			Err(failure) => refused(failure),
		};
	}
	let Some(kind) = body.get("kind").and_then(Json::as_str).and_then(FileKind::parse) else {
		return Ok(error(400, FILE_KIND_PROBLEM));
	};
	match set_file_kind(&app, &id, &file_id, kind) {
		Ok(file) => Ok(reply::json(200, &json!({ "file": file }))),
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/spaces/{id}/files/{file_id}: a copied file and its facts.
async fn remove_one_file(State(app): State<Arc<App>>, Path((id, file_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	match remove_file(&app, &id, &file_id) {
		Ok(()) => Ok(reply::ok()),
		Err(failure) => refused(failure),
	}
}

/// PUT /api/spaces/{id}/folder { path }: link (or re-link) a folder on this computer.
async fn link(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	let body = fields(body).await?;
	let Some(path) = body.get("path").and_then(Json::as_str).map(text::trim).filter(|p| !p.is_empty()) else {
		return Ok(error(400, "path is required"));
	};
	if let Some(problem) = shortcut_path_problem(&app, path) {
		return Ok(error(400, &problem));
	}
	match link_folder(&app, &id, path) {
		Ok(space) => Ok(reply::json(200, &json!({ "space": space }))),
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/spaces/{id}/folder: unlink; the folder's files leave the space with their facts
/// (the folder itself is never touched).
async fn unlink(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	match unlink_folder(&app, &id) {
		Ok(space) => Ok(reply::json(200, &json!({ "space": space }))),
		Err(failure) => refused(failure),
	}
}

/// GET /api/spaces/{id}/deadlines: soonest due first.
async fn deadlines(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	match list_space_deadlines(&app, &id) {
		Ok(deadlines) => Ok(reply::json(200, &json!({ "deadlines": deadlines }))),
		Err(failure) => refused(failure),
	}
}

/// POST /api/spaces/{id}/deadlines { kind, name, date, time?, fileIds?, aboutFileId?, id? } (`id`
/// only as the space's waiting deadline's, which it then replaces).
async fn add_deadline(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	let body = fields(body).await?;
	let mut init = Obj::new();
	copy_given(&body, &["id", "kind", "name", "date"], &mut init);
	if let Some(time) = body.get("time").filter(|t| !t.is_null()) {
		init.insert("time", time.clone());
	}
	copy_given(&body, &["fileIds", "aboutFileId"], &mut init);
	let deadline = match add_space_deadline(&app, &id, &Json::Obj(init)) {
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

/// PUT /api/spaces/{id}/deadlines/{deadline_id}: a patch of kind, name, date, time (null clears),
/// fileIds, leftOutIds, source (null clears), assignmentFileId and aboutFileId (null clears) and
/// done.
async fn change_deadline(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	let body = fields(body).await?;
	if body.get("done").is_some_and(|d| d.as_bool().is_none()) {
		return Ok(error(400, "done must be true or false"));
	}
	let mut patch = Obj::new();
	copy_given(&body, &["kind", "name", "date", "time", "fileIds", "leftOutIds", "source", "assignmentFileId", "aboutFileId", "done"], &mut patch);
	let patch = Json::Obj(patch);
	match update_space_deadline(&app, &id, &deadline_id, &patch) {
		Ok(deadline) => {
			record_deadline_change(&app, &id, &deadline, &patch);
			Ok(reply::json(200, &json!({ "deadline": deadline })))
		}
		Err(failure) => refused(failure),
	}
}

/// DELETE /api/spaces/{id}/deadlines/{deadline_id}: `{ ok, mocksRemoved }`, its mocks go with it.
async fn remove_deadline(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	match remove_space_deadline(&app, &id, &deadline_id) {
		Ok(removed) => Ok(reply::json(200, &json!({ "ok": true, "mocksRemoved": removed }))),
		Err(failure) => refused(failure),
	}
}

/// GET /api/spaces/{id}/deadlines/{deadline_id}/homework: what a homework lesson shows of its
/// deadline. 404 once the space or deadline is gone.
async fn homework(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Response {
	let view = if is_space_id(&id) { homework_view(&app, &id, &deadline_id) } else { None };
	match view {
		Some(homework) => reply::json(200, &json!({ "homework": homework })),
		None => error(404, "No such deadline"),
	}
}

/// GET /api/spaces/{id}/deadlines/{deadline_id}/about: `{ fileId, name, text }` of the file on what
/// the deadline is like. 404 when it has none.
async fn about(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Response {
	match if is_space_id(&id) { deadline_about(&app, &id, &deadline_id) } else { None } {
		Some(about) => reply::json(200, &about),
		None => error(404, "No such file"),
	}
}

/// GET /api/deadlines: from every space that is not closed, soonest due first, `deadlines` not
/// yet done and `doneToday` ticked done today (Today), and `overdueAsked`, the ids the learner
/// said Not yet to.
async fn open_deadlines(State(app): State<Arc<App>>) -> Response {
	let today = local_day(clock::now_ms());
	reply::json(200, &json!({ "deadlines": list_open_deadlines(&app), "doneToday": list_deadlines_done_on(&app, &today), "overdueAsked": overdue_asked(&app) }))
}

/// GET /api/deadlines/{id}: one deadline with its space id. 404 once it is gone.
async fn deadline(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
	match deadline_with_space(&app, &id) {
		Some(owner) => reply::json(200, &owner),
		None => error(404, "No such deadline"),
	}
}
