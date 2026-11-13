//! /api/boot, /api/settings, /api/settings/{section}, /api/settings/prompts, /api/settings/prompts/{*segment}, /api/agent-folder, /api/agent-notes, /api/agent-actions, /api/rules, /api/reading, /api/cited/{file_id}, /api/cited/{file_id}/page/{n}.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderValue, Uri, header};
use axum::response::Response;
use gs_core::records::agent_rules::parse_where;
use gs_json::{Json, json};
use gs_services::App;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_services::app::agent_folder::{SetUpError, agent_folder_view, dismiss_folder_notice, set_start_command, set_up_agent_folder};
use gs_services::app::agent_memory::agent_notes_view;
use gs_services::app::agent_rules::{RuleFailure, agent_saved_rules, edit_rule, remove_rule};
use gs_services::app::boot::boot_info;
use gs_services::app::old_setup::remove_old_setup;
use gs_services::app::prompt_segments::{prompt_segments, reset_prompt_segment, save_prompt_segment};
use gs_services::app::reading_pages::{ReadingError, parse_page, reading_document, reading_pdf_page};
use gs_services::app::{agent_actions::recent_agent_actions, put_settings_section};
use gs_services::spaces::citations::{cited_page, cited_passage};

use crate::http::paths::{param, search_params};
use crate::http::reply::{self, Unhandled, error, fields, json_body};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/boot", ApiRoute::new().get(boot).into_route())
		.route("/api/settings", ApiRoute::new().get(settings).into_route())
		.route("/api/settings/prompts", ApiRoute::new().get(prompts).into_route())
		.route("/api/settings/prompts/{*segment}", ApiRoute::new().put(save_prompt).delete(reset_prompt).into_route())
		.route("/api/settings/{section}", ApiRoute::new().put(put_section).into_route())
		.route("/api/agent-folder", ApiRoute::new().get(agent_folder).post(change_agent_folder).into_route())
		.route("/api/agent-notes", ApiRoute::new().get(notes).delete(remove_note).into_route())
		.route("/api/agent-actions", ApiRoute::new().get(actions).into_route())
		.route("/api/rules", ApiRoute::new().get(rules).post(change_rule).into_route())
		.route("/api/reading", ApiRoute::new().get(reading).into_route())
		.route("/api/cited/{file_id}", ApiRoute::new().get(cited).into_route())
		.route("/api/cited/{file_id}/page/{n}", ApiRoute::new().get(cited_page_png).into_route())
}

async fn boot(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &boot_info(&app))
}

async fn settings(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	let record = app.stores.settings.read_settings()?.unwrap_or(Json::Null);
	Ok(reply::json(200, &json!({ "settings": record })))
}

async fn put_section(State(app): State<Arc<App>>, Path(section): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or(Json::Null);
	let (status, answer) = put_settings_section(&app, &section, &body)?;
	Ok(reply::json(status, &answer))
}

async fn prompts(State(app): State<Arc<App>>) -> Response {
	reply::json(200, &prompt_segments(&app))
}

async fn save_prompt(State(app): State<Arc<App>>, Path(segment): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or(Json::Null);
	let (status, answer) = save_prompt_segment(&app, &segment, &body)?;
	Ok(reply::json(status, &answer))
}

async fn reset_prompt(State(app): State<Arc<App>>, Path(segment): Path<String>) -> Response {
	let (status, answer) = reset_prompt_segment(&app, &segment);
	reply::json(status, &answer)
}

async fn agent_folder(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &agent_folder_view(&app))
}

async fn change_agent_folder(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	match body["action"].as_str() {
		Some("dismiss-notice") => {
			dismiss_folder_notice(&app)?;
			Ok(reply::json_no_store(200, &json!({ "ok": true })))
		}
		Some("remove-old-setup") => Ok(match remove_old_setup(&app) {
			Ok(()) => reply::json_no_store(200, &agent_folder_view(&app)),
			Err(message) => error(500, &format!("Couldn't remove it: {message}")),
		}),
		Some("set-start-command") => {
			let agent = match body["agent"].as_str() {
				Some("claude") => Some(FolderAgent::Claude),
				Some("codex") => Some(FolderAgent::Codex),
				_ => None,
			};
			match (agent, body["command"].as_str()) {
				(Some(agent), Some(command)) => changed(set_start_command(&app, agent, command)),
				_ => Ok(error(400, "agent must be \"claude\" or \"codex\", and command a string")),
			}
		}
		Some("setup") => {
			let folder = match &body["folder"] {
				Json::Str(folder) => Some(folder.as_str()),
				folder if body.as_obj().is_some_and(|o| o.contains_key("folder")) && !matches!(folder, Json::Str(_)) => return Ok(error(400, "folder must be a string")),
				_ => None,
			};
			changed(set_up_agent_folder(&app, folder))
		}
		_ => Ok(error(400, "action must be \"setup\", \"set-start-command\", \"dismiss-notice\" or \"remove-old-setup\"")),
	}
}

/// The folder after a change, or why it couldn't be made.
fn changed(result: Result<Json, SetUpError>) -> Result<Response, Unhandled> {
	match result {
		Ok(view) => Ok(reply::json_no_store(200, &view)),
		Err(SetUpError::Folder(message)) => Ok(error(400, &message)),
		Err(SetUpError::Disk(message)) => Err(Unhandled::from(message)),
	}
}

async fn notes(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &json!({ "notes": agent_notes_view(&app) }))
}

async fn remove_note(State(app): State<Arc<App>>, uri: Uri) -> Result<Response, Unhandled> {
	let params = search_params(uri.query().unwrap_or_default());
	let removed = match param(&params, "id").filter(|id| !id.is_empty()) {
		Some(id) => app.stores.agent_notes.remove_agent_note(id)?,
		None => false,
	};
	if !removed {
		return Ok(reply::no_store(error(404, "No such note.")));
	}
	Ok(reply::json_no_store(200, &json!({ "notes": agent_notes_view(&app) })))
}

async fn actions(State(app): State<Arc<App>>) -> Response {
	reply::json_no_store(200, &json!({ "actions": recent_agent_actions(&app) }))
}

async fn rules(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(reply::json_no_store(200, &json!({ "rules": agent_saved_rules(&app)? })))
}

async fn change_rule(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let (Some(place), Some(text)) = (parse_where(&body["where"]), body["text"].as_str()) else { return Ok(error(400, "where and text are required")) };
	match (body["action"].as_str(), body["newText"].as_str()) {
		(Some("remove"), _) => Ok(if remove_rule(&app, &place, text)? { reply::json_no_store(200, &json!({ "ok": true })) } else { error(404, "That rule was already removed.") }),
		(Some("edit"), Some(new_text)) => match edit_rule(&app, &place, text, new_text) {
			Ok(edited) => Ok(reply::json_no_store(200, &edited)),
			Err(RuleFailure::Disk(message)) => Err(Unhandled::from(message)),
			Err(failure) => {
				let status = match failure {
					RuleFailure::NotFound => 404,
					RuleFailure::Conflict => 409,
					_ => 400,
				};
				Ok(error(status, failure.message()))
			}
		},
		_ => Ok(error(400, "action must be \"remove\", or \"edit\" with newText")),
	}
}

async fn reading(State(app): State<Arc<App>>, uri: Uri) -> Result<Response, Unhandled> {
	let params = search_params(uri.query().unwrap_or_default());
	let Some(path) = param(&params, "path").filter(|path| !path.is_empty()) else { return Ok(error(400, "path is required")) };
	let Some(page) = param(&params, "page") else {
		return match reading_document(&app, path).await {
			Ok(document) => Ok(reply::json_no_store(200, &document)),
			Err(ReadingError::Refused(status, message)) => Ok(error(status, message)),
			Err(ReadingError::Failed(message)) => Err(Unhandled::from(message)),
		};
	};
	let Some(page) = parse_page(page) else { return Ok(error(400, "page must be a whole number from 1")) };
	page_png(reading_pdf_page(&app, path, page).await)
}

/// A PDF page as a PNG the window may keep for five minutes, or why there is none.
fn page_png(outcome: Result<Arc<Vec<u8>>, ReadingError>) -> Result<Response, Unhandled> {
	match outcome {
		Ok(png) => {
			let mut res = Response::new(Body::from(png.as_ref().clone()));
			res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
			res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=300"));
			Ok(res)
		}
		Err(ReadingError::Refused(status, message)) => Ok(error(status, message)),
		Err(ReadingError::Failed(message)) => Err(Unhandled::from(message)),
	}
}

/// What a space file source in a teacher message shows: `{ name, range, page, text }`.
async fn cited(State(app): State<Arc<App>>, Path(file_id): Path<String>, uri: Uri) -> Result<Response, Unhandled> {
	let params = search_params(uri.query().unwrap_or_default());
	let Some(range) = param(&params, "range").filter(|range| !range.is_empty()) else { return Ok(error(400, "range is required")) };
	let quote = param(&params, "quote").filter(|quote| !quote.is_empty());
	match cited_passage(&app, &file_id, range, quote).await {
		Ok(passage) => Ok(reply::json_no_store(200, &passage)),
		Err(ReadingError::Refused(status, message)) => Ok(error(status, message)),
		Err(ReadingError::Failed(message)) => Err(Unhandled::from(message)),
	}
}

async fn cited_page_png(State(app): State<Arc<App>>, Path((file_id, n)): Path<(String, String)>) -> Result<Response, Unhandled> {
	page_png(cited_page(&app, &file_id, &n).await)
}
