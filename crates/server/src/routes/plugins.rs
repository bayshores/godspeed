//! /api/plugins, /api/plugins/{id}, /api/plugins/{id}/storage/{key} and /api/plugins/{id}/ask.
//! Only the window calls these: a plugin's frame has no way in (it reaches godspeed by messages to
//! the window, which calls here for it).

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::response::Response;
use gs_json::{Json, Obj, json};
use gs_services::App;
use gs_services::outcome::Outcome;
use gs_services::plugins::{ask_agent, install_from_folder, install_from_github, installed_manifest, list_plugins, plugin_view, remove_plugin, set_state, storage_get, storage_set};

use crate::http::reply::{self, Unhandled, error, json, json_body};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/plugins", ApiRoute::new().get(list).post(install).into_route())
		.route("/api/plugins/{id}", ApiRoute::new().put(change).delete(remove).into_route())
		.route("/api/plugins/{id}/storage/{key}", ApiRoute::new().get(get_stored).put(put_stored).into_route())
		.route("/api/plugins/{id}/ask", ApiRoute::new().post(ask).into_route())
}

fn answer(outcome: Outcome<Json>, key: &str) -> Result<Response, Unhandled> {
	reply::answer(outcome, |value| {
		let mut body = Obj::new();
		body.insert(key, value);
		json(200, &Json::Obj(body))
	})
}

/// `{ plugins: [{ id, folder, manifest, enabled, values } | { id, folder, error }] }`.
async fn list(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(json(200, &json!({ "plugins": list_plugins(&app)? })))
}

/// `{ from: "folder", folder }` or `{ from: "github", owner, repo, tag }`: `{ plugin }`.
async fn install(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or(Json::Null);
	let text = |key: &str| body[key].as_str().unwrap_or_default().to_owned();
	let installed = match body["from"].as_str() {
		Some("folder") => install_from_folder(&app, &text("folder")),
		Some("github") => install_from_github(&app, &text("owner"), &text("repo"), &text("tag")).await,
		_ => return Ok(error(400, "Say where the plugin comes from: folder or github.")),
	};
	answer(installed, "plugin")
}

/// `{ enabled?, values? }`: `{ plugin }`.
async fn change(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or(Json::Null);
	let changed = installed_manifest(&app, &id).and_then(|manifest| {
		set_state(&app, &id, &manifest, &body)?;
		Ok(plugin_view(&app, &manifest)?)
	});
	answer(changed, "plugin")
}

async fn remove(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	reply::answer(remove_plugin(&app, &id), |()| reply::ok())
}

/// `{ value }`, null when nothing is stored.
async fn get_stored(State(app): State<Arc<App>>, Path((id, key)): Path<(String, String)>) -> Result<Response, Unhandled> {
	answer(storage_get(&app, &id, &key), "value")
}

/// `{ value }`: `{ ok: true }`.
async fn put_stored(State(app): State<Arc<App>>, Path((id, key)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	let Some(value) = json_body(body).await.and_then(|b| b.get("value").cloned()) else { return Ok(error(400, "Send { value }.")) };
	reply::answer(storage_set(&app, &id, &key, &value), |()| reply::ok())
}

/// `{ prompt, schema }`: `{ answer }` once the agent sent it.
async fn ask(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or(Json::Null);
	let Some(prompt) = body["prompt"].as_str() else { return Ok(error(400, "Send { prompt, schema }.")) };
	answer(ask_agent(&app, &id, prompt, &body["schema"]).await, "answer")
}

#[cfg(test)]
mod tests {
	use http_body_util::BodyExt;

	use super::*;

	async fn read(res: Result<Response, Unhandled>) -> (u16, Json) {
		let Ok(res) = res else { return (500, Json::Null) };
		let status = res.status().as_u16();
		let bytes = res.into_body().collect().await.unwrap().to_bytes();
		(status, gs_json::parse(std::str::from_utf8(&bytes).unwrap()).unwrap())
	}

	#[tokio::test]
	async fn install_change_store_and_remove_through_the_routes() {
		let root = std::env::temp_dir().join(format!("gs-plugin-routes-{}", gs_base::ids::uuid()));
		for name in ["data", "home", "tmp", "res", "src"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
		let manifest = json!({ "id": "quiz", "name": "Quiz", "version": "1.0.0", "description": "Quick quiz.", "author": "me", "entry": "index.html", "space": { "label": "Quiz" }, "settings": [{ "key": "hard", "label": "Hard", "kind": "toggle", "default": false }] });
		gs_base::fsx::write_json_atomic(&root.join("src/manifest.json"), &manifest).unwrap();
		gs_base::fsx::write_text_atomic(&root.join("src/index.html"), "<!doctype html>").unwrap();
		let body = |v: Json| Body::from(gs_json::stringify(&v));

		let (status, out) = read(install(State(app.clone()), body(json!({ "from": "folder", "folder": root.join("src").to_str().unwrap() }))).await).await;
		assert_eq!((status, out["plugin"]["values"].clone()), (200, json!({ "hard": false })));
		assert_eq!(read(install(State(app.clone()), body(json!({ "from": "disk" }))).await).await.0, 400);
		let (_, out) = read(change(State(app.clone()), Path("quiz".to_owned()), body(json!({ "enabled": false, "values": { "hard": true } }))).await).await;
		assert_eq!((out["plugin"]["enabled"].clone(), out["plugin"]["values"]["hard"].clone()), (json!(false), json!(true)));
		let key = || Path(("quiz".to_owned(), "best".to_owned()));
		assert_eq!(read(put_stored(State(app.clone()), key(), body(json!({ "value": [1, 2] }))).await).await.0, 200);
		assert_eq!(read(get_stored(State(app.clone()), key()).await).await.1, json!({ "value": [1, 2] }));
		assert_eq!(read(put_stored(State(app.clone()), key(), body(json!(5))).await).await.0, 400);
		let (status, out) = read(ask(State(app.clone()), Path("quiz".to_owned()), body(json!({ "prompt": "hi", "schema": {} }))).await).await;
		assert_eq!((status, out), (403, json!({ "error": "This plugin doesn't say it uses the agent." })));
		assert_eq!(read(list(State(app.clone())).await).await.1["plugins"].items().len(), 1);
		assert_eq!(read(remove(State(app.clone()), Path("quiz".to_owned())).await).await.0, 200);
		assert_eq!(read(change(State(app.clone()), Path("quiz".to_owned()), body(json!({}))).await).await.0, 404);
		let _ = std::fs::remove_dir_all(root);
	}
}
