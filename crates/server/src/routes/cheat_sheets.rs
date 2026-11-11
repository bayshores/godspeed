//! /api/classes/{id}/cheat-sheets and /api/classes/{id}/deadlines/{deadline_id}/cheat-sheet and everything under it (package cheat-sheets).

use std::sync::{Arc, LazyLock};

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, header};
use axum::response::Response;
use gs_base::re::Re;
use gs_core::contracts::class::is_class_id;
use gs_core::messages::input_events::parse_attachments;
use gs_core::study::cheat_sheet::{sheet_about_of, sheet_region_of};
use gs_json::{Json, json};
use gs_services::App;
use gs_services::cheat_sheets::{AskInput, Outcome, Stop, ask, cheat_sheet_file, cheat_sheet_pdf, cheat_sheet_view, class_sheets_view, remove_rule, retry, sheet_pdf_file, stop};

use crate::http::reply::{Unhandled, json, json_body};
use crate::http::route::ApiRoute;

const SHEET: &str = "/api/classes/{id}/deadlines/{deadline_id}/cheat-sheet";

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/classes/{id}/cheat-sheets", ApiRoute::new().get(get_class_sheets).into_route())
		.route(SHEET, ApiRoute::new().get(get_sheet).post(post_sheet).into_route())
		.route(&format!("{SHEET}/pdf/{{n}}"), ApiRoute::new().get(get_pdf).into_route())
		.route(&format!("{SHEET}/files/{{file}}"), ApiRoute::new().get(get_file).into_route())
}

fn error(status: u16, message: &str) -> Response {
	json(status, &json!({ "error": message }))
}

fn not_a_class() -> Response {
	error(404, "No such class")
}

/// A refusal answers with its status; a throw is the route's empty 500.
fn answer(outcome: Outcome<Json>) -> Result<Response, Unhandled> {
	match outcome {
		Ok(body) => Ok(json(200, &body)),
		Err(Stop::Refuse(status, message)) => Ok(error(status, &message)),
		Err(Stop::Throw(message)) => Err(Unhandled::from(message)),
	}
}

fn done(outcome: Outcome<()>) -> Result<Response, Unhandled> {
	answer(outcome.map(|()| json!({ "ok": true })))
}

/// A kept file never changes, so the browser may keep it.
fn kept(bytes: Vec<u8>, kind: &'static str) -> Response {
	let mut res = Response::new(Body::from(bytes));
	res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(kind));
	res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
	res
}

async fn get_class_sheets(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(not_a_class());
	}
	answer(class_sheets_view(&app, &id))
}

async fn get_sheet(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(not_a_class());
	}
	answer(cheat_sheet_view(&app, &id, &deadline_id).await)
}

async fn post_sheet(State(app): State<Arc<App>>, Path((id, deadline_id)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	if !is_class_id(&id) {
		return Ok(not_a_class());
	}
	let body = json_body(body).await.unwrap_or_else(|| json!({}));
	if body.is_null() {
		// `body.action` on null throws.
		return Err(Unhandled::from("Cannot read properties of null (reading 'action')"));
	}
	match body["action"].as_str() {
		Some("ask") => {
			let Some(text) = body["text"].as_str() else { return Ok(error(400, "Give text.")) };
			let attachments = match parse_attachments(body.get("attachments")) {
				Ok(attachments) => attachments,
				Err(refusal) => return Ok(error(400, &refusal.0)),
			};
			let region = body.get("region").map(sheet_region_of);
			let about = body.get("about").map(sheet_about_of);
			if region == Some(None) {
				return Ok(error(400, "Give the region as n, page, x, y, w and h."));
			}
			if about == Some(None) {
				return Ok(error(400, "Give about as kind, session and text."));
			}
			done(ask(&app, &id, &deadline_id, AskInput { text: text.to_owned(), attachments, region: region.flatten(), about: about.flatten() }))
		}
		Some("retry") => done(retry(&app, &id, &deadline_id)),
		Some("remove-rule") => match body["text"].as_str() {
			Some(text) => done(remove_rule(&app, &id, &deadline_id, text)),
			None => Ok(error(400, "Give text.")),
		},
		Some("file") => match body["n"].as_f64() {
			Some(n) => answer(sheet_pdf_file(&app, &id, &deadline_id, n).map(|path| json!({ "path": path }))),
			None => Ok(error(400, "Give n.")),
		},
		Some("stop") => {
			stop(&app, &deadline_id);
			Ok(json(200, &json!({ "ok": true })))
		}
		_ => Ok(error(400, "Unknown action.")),
	}
}

async fn get_pdf(State(app): State<Arc<App>>, Path((id, deadline_id, n)): Path<(String, String, String)>) -> Response {
	static VERSION: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[1-9]\d{0,8}$", ""));
	let pdf = if VERSION.test(&n) && is_class_id(&id) { cheat_sheet_pdf(&app, &id, &deadline_id, n.parse().unwrap_or(0.0)) } else { None };
	match pdf {
		Some(bytes) => kept(bytes, "application/pdf"),
		None => error(404, "No such cheat sheet"),
	}
}

async fn get_file(State(app): State<Arc<App>>, Path((id, deadline_id, file)): Path<(String, String, String)>) -> Response {
	match is_class_id(&id).then(|| cheat_sheet_file(&app, &id, &deadline_id, &file)).flatten() {
		Some((bytes, kind)) => kept(bytes, kind),
		None => error(404, "No such file"),
	}
}
