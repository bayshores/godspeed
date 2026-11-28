//! /api/graph (the graph view), /api/graph/costs (what building it took), /api/graph/coverage/extract (a
//! lesson's manual extraction), /api/graph/import (No space's Add files), /api/graph/nodes/{id}
//! (single-node deletion) and /api/progress (the Overview and topic Graph payload).

use std::collections::VecDeque;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, Uri, header};
use axum::response::Response;
use futures_util::StreamExt;
use gs_base::tasks::detach;
use gs_core::contracts::space::is_calendar_date;
use gs_json::{Json, Obj, json};
use gs_services::App;
use gs_services::spaces::request_space_scope;
use gs_services::graph::extraction::{NotesImportInput, extraction};
use gs_services::graph::extraction_runs::extraction_statuses;
use gs_services::graph::graph::{delete_graph_node, graph_costs, graph_view};
use gs_services::graph::progress::progress_for;

use crate::http::form;
use crate::http::paths::{param, query};
use crate::http::reply::{self, Unhandled, body_text, error, json, json_body, read_body};
use crate::http::route::ApiRoute;

pub(crate) fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/graph", ApiRoute::new().get(get_graph).into_route())
		.route("/api/graph/costs", ApiRoute::new().get(get_costs).into_route())
		.route("/api/graph/coverage/extract", ApiRoute::new().post(post_extract).into_route())
		.route("/api/graph/import", ApiRoute::new().post(post_import).into_route())
		.route("/api/graph/nodes/{id}", ApiRoute::new().delete(delete_node).into_route())
		.route("/api/progress", ApiRoute::new().get(get_progress).into_route())
}

/// `?space=<id|none>` (absent is No space); None for a malformed or unknown space.
fn scope_of(app: &App, params: &[(String, String)]) -> Option<Option<String>> {
	request_space_scope(app, param(params, "space"))
}

async fn get_graph(State(app): State<Arc<App>>, uri: Uri) -> Result<Response, Unhandled> {
	let Some(scope) = scope_of(&app, &query(&uri)) else { return Ok(reply::no_such_space()) };
	Ok(json(200, &graph_view(&app, scope.as_deref())?))
}

async fn get_costs(State(app): State<Arc<App>>, uri: Uri) -> Result<Response, Unhandled> {
	let Some(scope) = scope_of(&app, &query(&uri)) else { return Ok(reply::no_such_space()) };
	Ok(json(200, &graph_costs(&app, scope.as_deref())?))
}

/// `?today=YYYY-MM-DD` sets the deadlines' days left; absent is this computer's day.
async fn get_progress(State(app): State<Arc<App>>, uri: Uri) -> Result<Response, Unhandled> {
	let params = query(&uri);
	let Some(scope) = scope_of(&app, &params) else { return Ok(reply::no_such_space()) };
	let today = param(&params, "today");
	if today.is_some_and(|day| !is_calendar_date(&Json::from(day))) {
		return Ok(error(400, "today must be YYYY-MM-DD"));
	}
	match progress_for(&app, scope.as_deref(), today)? {
		Some(payload) => Ok(json(200, &payload)),
		None => Ok(reply::no_such_space()),
	}
}

/// Runs the pipeline over one lesson's uncovered content, whatever its size, in the background.
async fn post_extract(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let Some(body) = json_body(body).await else { return Ok(error(400, "Invalid JSON body")) };
	if body.is_null() {
		return Err(Unhandled::from("Cannot read properties of null (reading 'chatId')"));
	}
	let Some(chat_id) = body["chatId"].as_str().filter(|id| !id.is_empty()).map(str::to_owned) else {
		return Ok(error(400, "Body must be {chatId: string}"));
	};
	if app.stores.chats.get_chat(&chat_id).is_none() {
		return Ok(error(404, "Not found"));
	}
	if extraction_statuses(&app).iter().any(|run| run["kind"].as_str() == Some("chat") && run["chatId"].as_str() == Some(&chat_id)) {
		return Ok(error(409, "Godspeed is already adding this lesson to your graph."));
	}
	detach("chat", async move {
		if let Err(err) = extraction(&app).run_extraction(&chat_id).await {
			eprintln!("[chat {chat_id}] manual extraction failed: {err}");
		}
	});
	Ok(json(202, &json!({ "started": true })))
}

/// Raw notes files (multipart field "files") in, one extraction run per file, three at a time.
/// The answer lists each file's outcome in the order they finished.
async fn post_import(State(app): State<Arc<App>>, headers: HeaderMap, body: Body) -> Response {
	let content_type = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or_default().to_owned();
	let Some(entries) = form::parse(&content_type, &read_body(body).await) else {
		return json(400, &json!({ "results": [], "error": "Invalid form body" }));
	};
	let files: VecDeque<(usize, String, String)> =
		entries.into_iter().filter(|e| e.name == "files").filter_map(|e| Some((e.file_name?, body_text(&e.value)))).enumerate().map(|(i, (name, text))| (i, name, text)).collect();
	if files.is_empty() {
		return json(400, &json!({ "results": [], "error": "no files" }));
	}
	// Node runs a route to the end after its client leaves, so the imports outlive the request.
	let imports = gs_base::tasks::spawn("graph", import_files(app, files));
	match imports.await {
		Ok(results) => json(200, &json!({ "results": results })),
		Err(_) => reply::empty(500),
	}
}

/// One notes import per file, three at a time; results in the order they end.
async fn import_files(app: Arc<App>, files: VecDeque<(usize, String, String)>) -> Vec<Json> {
	futures_util::stream::iter(files).map(|(request_index, file_path, text)| import_file(&app, request_index, file_path, text)).buffer_unordered(3).collect().await
}

async fn import_file(app: &Arc<App>, request_index: usize, file_path: String, text: String) -> Json {
	let input = NotesImportInput { file_path: file_path.clone(), text, scope: None, source_id: None, may_be_space_info: false };
	let mut result = Obj::new();
	result.insert("filePath", file_path);
	result.insert("requestIndex", request_index);
	match extraction(app).import_notes(input).await {
		Ok(stats) => {
			result.insert("outcome", "completed");
			result.insert("ok", true);
			result.insert("stats", stats);
		}
		Err(err) => {
			result.insert("ok", false);
			result.insert("outcome", err.outcome.as_str());
			result.insert("stats", err.partial_stats);
			result.insert("error", err.message);
		}
	}
	Json::Obj(result)
}

/// Deletes one node and every chain naming it ("full death"); refused while extraction runs.
async fn delete_node(State(app): State<Arc<App>>, Path(id): Path<String>, uri: Uri) -> Result<Response, Unhandled> {
	let Some(scope) = scope_of(&app, &query(&uri)) else { return Ok(reply::no_such_space()) };
	Ok(match delete_graph_node(&app, &id, scope.as_deref())? {
		Ok(deleted) => json(200, &deleted),
		Err(refusal) => reply::coded(refusal.status, refusal.error, refusal.code),
	})
}
