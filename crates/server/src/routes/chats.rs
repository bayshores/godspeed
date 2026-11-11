//! /api/chat, /api/chats, /api/chats/{id} and everything under it, /api/talk (package turns).

use std::convert::Infallible;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderName, HeaderValue, Uri, header};
use axum::response::Response;
use bytes::Bytes;
use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::text;
use gs_core::contracts::class::parse_class_scope;
use gs_core::graph::graph_deletion::ChatDeleteMode;
use gs_core::messages::input_events::{TurnInput, dismiss_appends, parse_chat_input, parse_dismiss_input, parse_user_steer_input};
use gs_core::messages::native_messages::new_user_steer;
use gs_core::session::jobs::set_steer_ui_inverted;
use gs_core::session::prices::session_cost;
use gs_core::session::session_markdown::session_markdown;
use gs_engine::turn::ui_stream::SSE_HEADERS;
use gs_json::{Json, Obj, json};
use gs_services::App;
use gs_services::classes::{move_chat_to_class, start_class_scanner};
use gs_services::jobs::steer_live_chat;
use gs_services::turns::chat_handler::{ChatReply, ReplyBody, handle_chat_input};
use gs_services::turns::chats::{delete_chat_session, session_coverage};
use gs_services::turns::compaction::compaction_in_flight;
use gs_services::turns::dismissal_park::park_dismissal;
use gs_services::turns::homework::create_homework;
use gs_services::turns::lessons::{CreateLessonInput, LessonStart, create_lesson};
use gs_services::turns::talk::{clear_talk, open_talk};
use gs_services::turns::turn_liveness::is_turn_running;
use gs_services::turns::turn_runs::{running_turn, settled_turn_frames, turn_failure};

use crate::http::paths::{param, search_params};
use crate::http::reply::{self, Unhandled, json_body};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/chat", ApiRoute::new().post(chat).into_route())
		.route("/api/chats", ApiRoute::new().get(list).post(create).into_route())
		.route("/api/chats/{id}", ApiRoute::new().get(read).put(rename).delete(remove).into_route())
		.route("/api/chats/{id}/artifact-ui", ApiRoute::new().post(artifact_ui).into_route())
		.route("/api/chats/{id}/class", ApiRoute::new().put(move_class).into_route())
		.route("/api/chats/{id}/dismiss", ApiRoute::new().post(dismiss).into_route())
		.route("/api/chats/{id}/markdown", ApiRoute::new().get(markdown).into_route())
		.route("/api/chats/{id}/steer", ApiRoute::new().post(steer).into_route())
		.route("/api/chats/{id}/stream", ApiRoute::new().get(stream).into_route())
		.route("/api/talk", ApiRoute::new().post(talk_open).delete(talk_clear).into_route())
}

fn error(status: u16, message: &str) -> Response {
	reply::json(status, &json!({ "error": message }))
}

fn coded(status: u16, message: &str, code: &str) -> Response {
	reply::json(status, &json!({ "error": message, "code": code }))
}

/// A body the TS reads with `.catch(() => fallback)`: a parse failure is the fallback, but a
/// `null` body throws at the first property read (an empty 500).
async fn object_body(body: Body, fallback: Json) -> Result<Json, Unhandled> {
	match json_body(body).await {
		None => Ok(fallback),
		Some(Json::Null) => Err(Unhandled),
		Some(value) => Ok(value),
	}
}

fn chat_reply(r: ChatReply) -> Response {
	match r.body {
		ReplyBody::Json(body) => reply::json(r.status, &body),
		ReplyBody::Text(text) => reply::text(r.status, text),
		ReplyBody::Empty => reply::empty(r.status),
	}
}

/// POST /api/chat: `{chatId, input}`, one input event, one turn. The POST only acknowledges;
/// views attach through the stream route.
async fn chat(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let Some(body) = json_body(body).await else { return Ok(error(400, "Invalid JSON body")) };
	if body.is_null() {
		return Err(Unhandled);
	}
	let Some(chat_id) = body["chatId"].as_str().filter(|id| !id.is_empty()) else { return Ok(error(404, "Unknown chat")) };
	let input = match parse_chat_input(&body["input"]) {
		Ok(input) => input,
		Err(err) => return Ok(error(400, &err.0)),
	};
	Ok(chat_reply(handle_chat_input(&app, chat_id, TurnInput::Chat(input)).await))
}

/// GET /api/chats[?class=<id|none>]: the session picker's list with liveness merged in.
async fn list(State(app): State<Arc<App>>, uri: Uri) -> Result<Response, Unhandled> {
	start_class_scanner(&app);
	let params = search_params(uri.query().unwrap_or_default());
	let scope = match param(&params, "class") {
		None => None,
		Some(raw) => match parse_class_scope(Some(raw)) {
			Some(scope) => Some(scope),
			None => return Ok(error(400, "bad class")),
		},
	};
	let chats: Vec<Json> = app
		.stores
		.chats
		.list_chats()
		.into_iter()
		.filter(|c| scope.as_ref().is_none_or(|s| c["classId"].as_str() == s.as_deref()))
		.map(|mut c| {
			let id = c["id"].as_str().unwrap_or_default().to_owned();
			if let Some(o) = c.as_obj_mut() {
				o.insert("busy", is_turn_running(&app, &id));
				o.insert("compacting", compaction_in_flight(&app, &id));
			}
			c
		})
		.collect();
	Ok(reply::json(200, &json!({ "chats": chats })))
}

/// POST /api/chats: a study session (typed, picked facts, topics or a deadline), or with
/// `homework: true` a homework session on the deadline.
async fn create(State(app): State<Arc<App>>, body: Body) -> Result<Response, Unhandled> {
	let body = object_body(body, json!({})).await?;
	let title = body["title"].as_str().unwrap_or_default();
	let Some(class_id) = parse_class_scope(body["classId"].as_str()) else { return Ok(error(400, "bad classId")) };
	let deadline_id = body["deadlineId"].as_str();
	if body["homework"] == Json::Bool(true) {
		let (Some(class_id), Some(deadline_id)) = (class_id.as_deref(), deadline_id) else { return Ok(error(400, "homework needs a classId and a deadlineId")) };
		return Ok(match create_homework(&app, class_id, deadline_id)? {
			Ok(created) => reply::json(200, &json!({ "id": created.chat["id"], "title": created.title })),
			Err(not_found) => coded(404, not_found.error, not_found.code),
		});
	}
	let start = match (deadline_id, body["topicIds"].as_arr()) {
		(Some(deadline_id), _) => LessonStart::Deadline(deadline_id.to_owned()),
		(None, Some(ids)) => LessonStart::Topics(ids.iter().filter_map(|id| id.as_str().map(str::to_owned)).collect()),
		(None, None) => LessonStart::Typed { title: title.to_owned(), picks: picks_of(&body["graphContext"]) },
	};
	Ok(match create_lesson(&app, CreateLessonInput { class_id, start })? {
		Ok(created) => reply::json(200, &json!({ "id": created.chat["id"], "title": created.title })),
		Err(not_found) => coded(404, not_found.error, not_found.code),
	})
}

/// The picked propositions that ride a typed start: objects with string id, name and statement.
fn picks_of(graph_context: &Json) -> Vec<Json> {
	let is_pick = |p: &&Json| matches!(p, Json::Obj(_)) && ["id", "name", "statement"].iter().all(|k| p[*k].as_str().is_some());
	graph_context["propositions"].as_arr().map_or_else(Vec::new, |picks| picks.iter().filter(is_pick).cloned().collect())
}

/// GET /api/chats/{id}: the record verbatim, with pricing, liveness and coverage.
async fn read(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	let Some(chat) = app.stores.chats.get_chat(&id) else { return Ok(error(404, "Not found")) };
	let mut out: Obj = chat.as_obj().cloned().unwrap_or_default();
	out.insert("messages", chat["messages"].clone());
	out.insert("pricing", session_cost(&chat));
	out.insert("turnInFlight", is_turn_running(&app, &id));
	if let Some(error) = turn_failure(&app, &id) {
		out.insert("turnError", error);
	}
	out.insert("compacting", compaction_in_flight(&app, &id));
	out.insert("coverage", session_coverage(&app, &chat)?);
	Ok(reply::json(200, &Json::Obj(out)))
}

/// PUT /api/chats/{id}: rename. `updatedAt` stays, so the sidebar order does not change.
async fn rename(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	if app.stores.chats.get_chat(&id).is_none() {
		return Ok(error(404, "Not found"));
	}
	let body = json_body(body).await.unwrap_or(Json::Null);
	let Some(title) = body["title"].as_str().map(text::trim).filter(|t| !t.is_empty()) else { return Ok(error(400, "title must be a non-empty string")) };
	let record = app.stores.chats.rename_chat(&id, title)?;
	Ok(reply::json(200, &json!({ "title": record["title"] })))
}

/// DELETE /api/chats/{id}?mode=preserve-graph|delete-nodes. The mode is required: the two differ
/// in what they destroy.
async fn remove(State(app): State<Arc<App>>, Path(id): Path<String>, uri: Uri) -> Result<Response, Unhandled> {
	let params = search_params(uri.query().unwrap_or_default());
	let (mode, name) = match param(&params, "mode") {
		Some("preserve-graph") => (ChatDeleteMode::PreserveGraph, "preserve-graph"),
		Some("delete-nodes") => (ChatDeleteMode::DeleteNodes, "delete-nodes"),
		_ => return Ok(coded(400, "mode is required and must be \"preserve-graph\" or \"delete-nodes\"", "bad_mode")),
	};
	Ok(match delete_chat_session(&app, &id, mode).await? {
		Err(refusal) => reply::json(refusal.status, &refusal.to_json()),
		Ok(deleted) => reply::json(200, &json!({ "ok": true, "mode": name, "stats": deleted.stats, "jobsRemoved": deleted.jobs_removed, "graphRevision": deleted.graph_revision })),
	})
}

/// POST /api/chats/{id}/artifact-ui: saves the learner's invert switch on a demo or figure
/// steer. Silent: no wake, no event.
async fn artifact_ui(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or(Json::Null);
	let _guard = app.locks.lock(LockKey::Chat(&id));
	let Some(chat) = app.stores.chats.get_chat(&id) else { return Ok(error(404, "Unknown chat")) };
	let input = &body["input"];
	let (Some(message_id), Some(inverted)) = (input["messageId"].as_str(), input["inverted"].as_bool()) else {
		return Ok(error(400, "input must be { messageId: string, inverted: boolean }"));
	};
	let messages = chat["messages"].as_arr().map_or(&[][..], Vec::as_slice);
	let target = messages.iter().find(|m| m["id"].as_str() == Some(message_id));
	if !target.is_some_and(|m| matches!(m["details"]["kind"].as_str(), Some("demo" | "visual"))) {
		return Ok(error(400, "No demo/figure steer with that message id"));
	}
	app.stores.chats.save_messages(&id, &set_steer_ui_inverted(messages, message_id, inverted))?;
	Ok(reply::json(200, &json!({ "ok": true })))
}

/// PUT /api/chats/{id}/class: moves a lesson to another class (`"none"`: no class).
async fn move_class(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = object_body(body, json!({})).await?;
	let target = parse_class_scope(body["classId"].as_str());
	let (Some(target), Some(_)) = (target, body.get("classId")) else { return Ok(error(400, "classId must be a class id or \"none\"")) };
	Ok(match move_chat_to_class(&app, &id, target.as_deref()).await {
		Err(failure) => coded(failure.status, &failure.error, &failure.code),
		Ok(class_id) => reply::json(200, &json!({ "ok": true, "classId": class_id })),
	})
}

/// POST /api/chats/{id}/dismiss: the learner discards a waiting question or problem. Silent: the
/// record is all that moves. A running turn parks it (202) and applies it at settle.
async fn dismiss(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Result<Response, Unhandled> {
	let body = json_body(body).await.unwrap_or(Json::Null);
	{
		let _guard = app.locks.lock(LockKey::Chat(&id));
		let Some(chat) = app.stores.chats.get_chat(&id) else { return Ok(error(404, "Unknown chat")) };
		let input = match parse_dismiss_input(&body["input"]) {
			Ok(input) => input,
			Err(err) => return Ok(error(400, &err.0)),
		};
		if is_turn_running(&app, &id) {
			park_dismissal(&app, &id, input);
			return Ok(reply::json(202, &json!({ "ok": true, "parked": true })));
		}
		let appends = match dismiss_appends(&chat, &input) {
			Ok(appends) => appends,
			Err(err) => return Ok(error(400, &err.0)),
		};
		let mut messages = chat["messages"].as_arr().cloned().unwrap_or_default();
		messages.extend(appends);
		app.stores.chats.save_messages(&id, &messages)?;
	}
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": id }));
	Ok(reply::json(200, &json!({ "ok": true })))
}

/// GET /api/chats/{id}/markdown: the whole session as one markdown download.
async fn markdown(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
	let Some(record) = app.stores.chats.get_chat(&id) else { return error(404, "Unknown chat") };
	let title = record["title"].as_str().unwrap_or_default();
	let mut res = Response::new(Body::from(session_markdown(record["messages"].as_arr().map_or(&[][..], Vec::as_slice), Some(title))));
	let headers = res.headers_mut();
	headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/markdown; charset=utf-8"));
	if let Ok(value) = HeaderValue::from_str(&format!("attachment; filename=\"{}.md\"", slugify(title))) {
		headers.insert(header::CONTENT_DISPOSITION, value);
	}
	res
}

/// POST /api/chats/{id}/steer: the learner's message for a running turn rides its steering queue.
/// No live turn: 409, and the client sends it as a plain message instead.
async fn steer(State(app): State<Arc<App>>, Path(id): Path<String>, body: Body) -> Response {
	if app.stores.chats.get_chat(&id).is_none() {
		return error(404, "unknown chat");
	}
	let Some(body) = json_body(body).await else { return error(400, "Invalid JSON body") };
	let input = match parse_user_steer_input(&body["input"]) {
		Ok(input) => input,
		Err(err) => return error(400, &err.0),
	};
	if !steer_live_chat(&app, &id, new_user_steer(&input.text, &input.id)) {
		return error(409, "no live turn to steer");
	}
	reply::json(200, &json!({ "ok": true }))
}

/// GET /api/chats/{id}/stream: the turn's SSE wire. A running turn replays its log, then goes
/// live until `[DONE]`; no running turn answers the cheap settled terminal.
async fn stream(State(app): State<Arc<App>>, Path(id): Path<String>) -> Response {
	if app.stores.chats.get_chat(&id).is_none() {
		return error(404, "Unknown chat");
	}
	let body = match running_turn(&app, &id) {
		None => Body::from(settled_turn_frames(&app, &id)),
		Some(handle) => {
			let frames = futures_util::stream::unfold(handle.subscribe(), |mut rx| async move { rx.recv().await.map(|frame| (Ok::<_, Infallible>(Bytes::from(frame)), rx)) });
			Body::from_stream(frames)
		}
	};
	let mut res = Response::new(body);
	for (name, value) in SSE_HEADERS {
		if let Ok(name) = HeaderName::from_bytes(name.as_bytes()) {
			res.headers_mut().insert(name, HeaderValue::from_static(value));
		}
	}
	res
}

/// POST /api/talk: the Talk chat, made on first use.
async fn talk_open(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(reply::json(200, &open_talk(&app)?))
}

/// DELETE /api/talk: Clear (409 while the teacher is replying).
async fn talk_clear(State(app): State<Arc<App>>) -> Result<Response, Unhandled> {
	Ok(match clear_talk(&app).await? {
		Ok(()) => reply::json(200, &json!({ "ok": true })),
		Err(refusal) => error(refusal.status, refusal.error),
	})
}

/// The download's file name from the title: lower case, NFKD, every run of other characters one
/// dash, no dash at the ends; "session" when nothing is left.
fn slugify(title: &str) -> String {
	let mut decomposed = String::new();
	for c in title.to_lowercase().chars() {
		match nfkd_alnum(c) {
			Some(parts) => decomposed.push_str(parts),
			None => decomposed.push(c),
		}
	}
	let mut slug = String::new();
	for c in decomposed.chars() {
		if c.is_ascii_lowercase() || c.is_ascii_digit() {
			slug.push(c);
		} else if !slug.ends_with('-') {
			slug.push('-');
		}
	}
	let slug = slug.trim_matches('-');
	if slug.is_empty() { "session".to_owned() } else { slug.to_owned() }
}

/// The letters and digits a character's NFKD form holds, with `-` for the rest (a combining
/// accent), for the Latin, super- and subscript, ligature and fullwidth blocks; None for any
/// other character, which counts as a separator either way. Generated from Unicode 15.1.
fn nfkd_alnum(c: char) -> Option<&'static str> {
	const LATIN: &str = "          a        2 3      1 o  1-4 1-2 3-4                                  a- a- a- a- a- a-  c- e- e- e- e- i- i- i- i-  n- o- o- o- o- o-   u- u- u- u- y-  y-  a-  a-  a-  c-  c-  c-  c-  d-    e-  e-  e-  e-  e-  g-  g-  g-  g-  h-    i-  i-  i-  i-    ij  j-  k-   l-  l-  l-  l-    n-  n-  n- -n    o-  o-  o-    r-  r-  r-  s-  s-  s-  s-  t-  t-    u-  u-  u-  u-  u-  u-  w-  y-   z-  z-  z- s                                  o-               u-                     -z- dz-  -j lj  -j nj  a-  i-  o-  u-  u-  u-  u-  u-   a-  a-      g-  k-  o-  o-   j-  -z dz  g-    n-  a-      a-  a-  e-  e-  i-  i-  o-  o-  r-  r-  u-  u-  s-  t-    h-        a-  e-  o-  o-  o-  o-  y-                            ";
	const LATIN_MORE: &str = " a-  b-  b-  b-  c-  d-  d-  d-  d-  d-  e-  e-  e-  e-  e-  f-  g-  h-  h-  h-  h-  h-  i-  i-  k-  k-  k-  l-  l-  l-  l-  m-  m-  m-  n-  n-  n-  n-  o-  o-  o-  o-  p-  p-  r-  r-  r-  r-  s-  s-  s-  s-  s-  t-  t-  t-  t-  u-  u-  u-  u-  u-  v-  v-  w-  w-  w-  w-  w-  x-  x-  y-  z-  z-  z- h- t- w- y- a- s-      a-  a-  a-  a-  a-  a-  a-  a-  a-  a-  a-  a-  e-  e-  e-  e-  e-  e-  e-  e-  i-  i-  o-  o-  o-  o-  o-  o-  o-  o-  o-  o-  o-  o-  u-  u-  u-  u-  u-  u-  u-  y-  y-  y-  y-      ";
	const SCRIPTS: &str = "0 i   4 5 6 7 8 9      n 0 1 2 3 4 5 6 7 8 9       a e o x  h k l m n p s t   ";
	const LIGATURES: &str = "ff fi fl ffi ffl st st";
	const FULLWIDTH: &str = "0123456789abcdefghijklmnopqrstuvwxyz";
	let cp = c as u32;
	let from = |table: &'static str, first: u32| table.split(' ').nth((cp - first) as usize).filter(|t| !t.is_empty());
	match cp {
		0xA0..=0x24F => from(LATIN, 0xA0),
		0x1E00..=0x1EFF => from(LATIN_MORE, 0x1E00),
		0x2070..=0x209F => from(SCRIPTS, 0x2070),
		0xFB00..=0xFB06 => from(LIGATURES, 0xFB00),
		0xFF10..=0xFF19 => Some(&FULLWIDTH[(cp - 0xFF10) as usize..][..1]),
		0xFF41..=0xFF5A => Some(&FULLWIDTH[(cp - 0xFF41 + 10) as usize..][..1]),
		_ => None,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn file_names_follow_the_typescript_slug() {
		assert_eq!(slugify("Café -- Naïve  Bayes: 100% (really)!"), "cafe-nai-ve-bayes-100-really");
		assert_eq!(slugify("日本語 🎓"), "session");
		assert_eq!(slugify("Work on HW5"), "work-on-hw5");
		assert_eq!(slugify("ﬁx Ａ½ x²"), "fix-a1-2-x2");
		assert_eq!(slugify("Tiếng Việt"), "tie-ng-vie-t");
	}
}
