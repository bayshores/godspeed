//! /api/vault (GET, PATCH), /api/vault/retry, /api/spaces/{id}/vault-notes and the lesson's
//! /api/chats/{id}/vault-notes and /vault-words.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::response::Response;
use gs_core::contracts::space::is_space_id;
use gs_services::App;
use gs_services::vault::{Ask, AskReply, answer_ask, change_vault, lesson_vault_notes, retry_vault, space_vault_notes, vault_status};

use crate::http::reply::{self, Unhandled, error, fields, json};
use crate::http::route::ApiRoute;

pub(crate) fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/vault", ApiRoute::new().get(get_vault).patch(patch_vault).into_route())
		.route("/api/vault/retry", ApiRoute::new().post(post_retry).into_route())
		.route("/api/spaces/{id}/vault-notes", ApiRoute::new().get(get_notes).into_route())
		.route("/api/chats/{id}/vault-notes", ApiRoute::new().get(get_lesson_notes).into_route())
		.route("/api/chats/{id}/vault-words", ApiRoute::new().post(post_words).into_route())
}

async fn get_vault(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(json(200, &vault_status(&app)?))
}

async fn patch_vault(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	Ok(match change_vault(&app, &body) {
		Ok(status) => json(200, &status),
		Err(why) => error(400, &why),
	})
}

async fn post_retry(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(json(200, &retry_vault(&app)?))
}

async fn get_notes(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(reply::no_such_space());
	}
	Ok(match space_vault_notes(&app, &id)? {
		Some(notes) => json(200, &notes),
		None => reply::no_such_space(),
	})
}

async fn get_lesson_notes(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	Ok(match lesson_vault_notes(&app, &id)? {
		Some(notes) => json(200, &notes),
		None => error(404, "Not found"),
	})
}

/// POST `{ topicId, words }` writes the learner's "My words"; `{ topicId, skip: true }` skips the ask.
async fn post_words(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = fields(body).await?;
	let Some(topic_id) = body["topicId"].as_str().filter(|t| !t.is_empty()) else { return Ok(error(400, "topicId is needed")) };
	let ask = match body["words"].as_str() {
		Some(words) => Ask::Words(words.to_owned()),
		None if body["skip"].as_bool() == Some(true) => Ask::Skip,
		None => return Ok(error(400, "Send words, or skip: true")),
	};
	Ok(match answer_ask(&app, &id, topic_id, ask)? {
		AskReply::Done => reply::ok(),
		AskReply::NotAsked => error(404, "No ask waits for that topic"),
		AskReply::Refused(why) => error(400, &why),
	})
}
