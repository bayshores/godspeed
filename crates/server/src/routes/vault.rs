//! /api/vault (GET, PATCH), /api/vault/retry and /api/spaces/{id}/vault-notes.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::response::Response;
use gs_core::contracts::space::is_space_id;
use gs_services::App;
use gs_services::vault::{change_vault, retry_vault, space_vault_notes, vault_status};

use crate::http::reply::{self, Unhandled, error, fields, json};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/vault", ApiRoute::new().get(get_vault).patch(patch_vault).into_route())
		.route("/api/vault/retry", ApiRoute::new().post(post_retry).into_route())
		.route("/api/spaces/{id}/vault-notes", ApiRoute::new().get(get_notes).into_route())
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
