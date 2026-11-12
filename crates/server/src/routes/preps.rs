//! POST /api/preps and /api/spaces/{id}/prep (src/app/api/preps, src/app/api/spaces/[id]/prep):
//! making a prep, its view, and the learner's changes to its sheet.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, header};
use axum::response::Response;
use gs_core::contracts::space::{is_calendar_date, is_space_id};
use gs_json::json;
use gs_services::App;
use gs_services::preps::preps::{NewFile, Outcome, Stop, change_prep, create_prep, prep_view, start_write};

use crate::http::form;
use crate::http::reply::{self, Unhandled, error, fields, read_body};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/preps", ApiRoute::new().post(create).into_route())
		.route("/api/spaces/{id}/prep", ApiRoute::new().get(view).post(act).into_route())
}

/// A refusal as `{ error }` with its status; a throw as the empty 500.
fn answer<T>(outcome: Outcome<T>, ok: impl FnOnce(T) -> Response) -> Result<Response, Unhandled> {
	match outcome {
		Ok(value) => Ok(ok(value)),
		Err(Stop::Refuse(status, message)) => Ok(error(status, &message)),
		Err(Stop::Throw(message)) => Err(Unhandled::from(message)),
	}
}

/// POST /api/preps: multipart "goal" (what the learner is preparing for), "date" (YYYY-MM-DD,
/// optional) and "files" (the job posting, the email, a resume; optional) → 201 `{ spaceId }`. A
/// file godspeed can't read is a 400.
async fn create(State(app): State<Arc<App>>, headers: HeaderMap, body: Body) -> Result<Response, Unhandled> {
	let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
	let Some(entries) = form::parse(content_type, &read_body(body).await) else {
		return Ok(error(400, "Invalid form body"));
	};
	// `form.get(name)`: the first entry, and a string only when it is not a file.
	let text = |name: &str| entries.iter().find(|e| e.name == name).filter(|e| e.file_name.is_none()).map(form::Entry::text);
	let Some(goal) = text("goal") else { return Ok(error(400, "Say what you are preparing for.")) };
	let date = text("date").filter(|d| !d.is_empty());
	let files: Vec<NewFile> = entries.iter().filter(|e| e.name == "files").filter_map(|e| Some(NewFile { name: e.file_name.clone()?, bytes: e.value.clone() })).collect();
	answer(create_prep(&app, &goal, date.as_deref(), &files), |space_id| reply::json(201, &json!({ "spaceId": space_id })))
}

fn no_such_prep() -> Response {
	error(404, "No such prep")
}

/// GET /api/spaces/{id}/prep: the prep's view.
async fn view(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(no_such_prep());
	}
	answer(prep_view(&app, &id), |view| reply::json(200, &view))
}

/// POST /api/spaces/{id}/prep, one action: `{action: "write"}` asks the teacher to write the sheet
/// again, `{action: "add-topic", name}` adds one at the end, `{action: "remove-topic", topicId}`,
/// `{action: "date", date}` with YYYY-MM-DD or null for no date.
async fn act(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(no_such_prep());
	}
	let body = fields(body).await?;
	let ok = |()| reply::json(200, &json!({ "ok": true }));
	let given = |key: &str| body.as_obj().and_then(|o| o.get(key));
	match body["action"].as_str() {
		Some("write") => answer(start_write(&app, &id), ok),
		Some("add-topic") => match body["name"].as_str() {
			Some(name) => answer(change_prep(&app, &id, &json!({ "addTopics": [{ "name": name }] })), ok),
			None => Ok(error(400, "Give name.")),
		},
		Some("remove-topic") => match body["topicId"].as_str() {
			Some(topic_id) => answer(change_prep(&app, &id, &json!({ "removeTopicIds": [topic_id] })), ok),
			None => Ok(error(400, "Give topicId.")),
		},
		Some("date") => match given("date") {
			Some(date) if date.is_null() || is_calendar_date(date) => answer(change_prep(&app, &id, &json!({ "date": date.clone() })), ok),
			_ => Ok(error(400, "Give date as YYYY-MM-DD, or null.")),
		},
		_ => Ok(error(400, "Unknown action.")),
	}
}

