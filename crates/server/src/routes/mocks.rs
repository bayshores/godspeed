//! /api/spaces/{id}/mocks and /api/spaces/{id}/mocks/{mock_id}:
//! making a prep's next mock, its view, what the learner does on its page, and removing it.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::response::Response;
use gs_base::text::len16;
use gs_core::contracts::space::is_space_id;
use gs_core::mocks::mock::{ANSWER_MAX, MockLanguage, is_mock_id, parse_mock_code};
use gs_json::{Json, Obj, json};
use gs_services::App;
use gs_services::mocks::mocks::{MockAction, change_mock, create_mock, delete_mock, mock_view, run_mock_examples};
use gs_services::mocks::preps::{Outcome, Stop};

use crate::http::reply::{self, Unhandled, error, fields};
use crate::http::route::ApiRoute;

pub fn routes() -> Router<Arc<App>> {
	Router::new()
		.route("/api/spaces/{id}/mocks", ApiRoute::new().post(create).into_route())
		.route("/api/spaces/{id}/mocks/{mock_id}", ApiRoute::new().get(view).post(act).delete(remove).into_route())
}

/// A refusal as `{ error }` with its status; a throw as the empty 500.
fn answer<T>(outcome: Outcome<T>, ok: impl FnOnce(T) -> Response) -> Result<Response, Unhandled> {
	match outcome {
		Ok(value) => Ok(ok(value)),
		Err(Stop::Refuse(status, message)) => Ok(error(status, &message)),
		Err(Stop::Throw(message)) => Err(Unhandled::from(message)),
	}
}

fn ok(_: ()) -> Response {
	reply::json(200, &json!({ "ok": true }))
}

fn no_such_mock() -> Response {
	error(404, "No such mock")
}

fn known(id: &str, mock_id: &str) -> bool {
	is_space_id(id) && is_mock_id(mock_id)
}

/// POST /api/spaces/{id}/mocks: makes the prep's next mock and asks the teacher for its
/// questions → 201 `{ mockId }`; a 409 while another mock is unfinished.
async fn create(State(app): State<Arc<App>>, Path(id): Path<String>) -> Result<Response, Unhandled> {
	if !is_space_id(&id) {
		return Ok(error(404, "No such prep"));
	}
	answer(create_mock(&app, &id), |mock_id| reply::json(201, &json!({ "mockId": mock_id })))
}

/// GET: the mock's view (core `MockView`).
async fn view(State(app): State<Arc<App>>, Path((id, mock_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	if !known(&id, &mock_id) {
		return Ok(no_such_mock());
	}
	answer(mock_view(&app, &id, &mock_id), |view| reply::json(200, &view))
}

/// POST, one action: `{action: "start"}` starts the clock; `{action: "answer", questionId, text,
/// language?, code?, seconds, submitted}` saves an answer (`code` is a code question's code by
/// language; its text is the picked one's); `{action: "run", questionId, code, language}` runs the
/// examples → a run outcome; `{action: "end"}` ends it and asks for grades; `{action: "retry"}`
/// asks the teacher again.
async fn act(State(app): State<Arc<App>>, Path((id, mock_id)): Path<(String, String)>, body: Body) -> Result<Response, Unhandled> {
	if !known(&id, &mock_id) {
		return Ok(no_such_mock());
	}
	let body = fields(body).await?;
	let change = |action: MockAction| answer(change_mock(&app, &id, &mock_id, action), ok);
	match body["action"].as_str() {
		Some("start") => change(MockAction::Start),
		Some("end") => change(MockAction::End),
		Some("retry") => change(MockAction::Retry),
		Some("answer") => {
			let (Some(question_id), Some(text), Some(seconds)) = (body["questionId"].as_str(), body["text"].as_str(), body["seconds"].as_f64()) else {
				return Ok(error(400, "Give questionId, text and seconds."));
			};
			let mut answer = Obj::new();
			answer.insert("text", text);
			if let Some(language) = MockLanguage::parse(&body["language"]) {
				answer.insert("language", language.as_str());
			}
			answer.insert("code", parse_mock_code(&body["code"]));
			answer.insert("seconds", seconds);
			answer.insert("submitted", body["submitted"] == Json::Bool(true));
			change(MockAction::Answer { question_id: question_id.to_owned(), answer: Json::Obj(answer) })
		}
		Some("run") => {
			let (Some(question_id), Some(code)) = (body["questionId"].as_str(), body["code"].as_str().filter(|c| len16(c) <= ANSWER_MAX)) else {
				return Ok(error(400, "Give questionId and code."));
			};
			// The run stops when this request goes away, as the handler is dropped.
			answer(run_mock_examples(&app, &id, &mock_id, question_id, code, &body["language"]).await, |run| reply::json(200, &run))
		}
		_ => Ok(error(400, "Unknown action.")),
	}
}

/// DELETE: removes the mock.
async fn remove(State(app): State<Arc<App>>, Path((id, mock_id)): Path<(String, String)>) -> Result<Response, Unhandled> {
	if !known(&id, &mock_id) {
		return Ok(no_such_mock());
	}
	answer(delete_mock(&app, &id, &mock_id), ok)
}

#[cfg(test)]
mod tests {
	use http_body_util::BodyExt;

	use super::*;

	async fn read(res: Result<Response, Unhandled>) -> (u16, String) {
		let Ok(res) = res else { return (500, String::new()) };
		let status = res.status().as_u16();
		(status, String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap())
	}

	fn ids(space: &str, mock: &str) -> Path<(String, String)> {
		Path((space.to_owned(), mock.to_owned()))
	}

	#[tokio::test]
	async fn ids_and_actions_it_doesnt_know_are_refused() {
		let root = std::env::temp_dir().join(format!("gs-mock-routes-{}", gs_base::ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
		let prep = json!({ "goal": "A test", "about": "", "sources": [], "topics": [], "mock": { "questions": 1, "minutes": 30 } });
		let space = app.stores.spaces.create_space(&json!({ "name": "Prep", "prep": prep })).unwrap();
		let plain = app.stores.spaces.create_space(&json!({ "name": "Plain space" })).unwrap();
		let id = space["id"].str_or_empty().to_owned();
		let post = |space: &str, mock: &str, body: &str| act(State(app.clone()), ids(space, mock), Body::from(body.to_owned()));
		let no_mock = (404, r#"{"error":"No such mock"}"#.to_owned());
		assert_eq!(read(view(State(app.clone()), ids(&id, "nope")).await).await, no_mock);
		assert_eq!(read(view(State(app.clone()), ids(&id, "mock_00000000")).await).await, no_mock);
		assert_eq!(read(remove(State(app.clone()), ids(&id, "mock_00000000")).await).await, no_mock);
		assert_eq!(read(post("nope", "mock_00000000", r#"{"action":"start"}"#).await).await, no_mock);
		assert_eq!(read(post(&id, "mock_00000000", r#"{"action":"end"}"#).await).await, no_mock);
		assert_eq!(read(post(&id, "mock_00000000", r#"{"action":"nope"}"#).await).await, (400, r#"{"error":"Unknown action."}"#.to_owned()));
		assert_eq!(read(post(&id, "mock_00000000", "not json").await).await.0, 400);
		assert_eq!(read(post(&id, "mock_00000000", "null").await).await.0, 500);
		assert_eq!(read(post(&id, "mock_00000000", r#"{"action":"answer","questionId":"q1"}"#).await).await, (400, r#"{"error":"Give questionId, text and seconds."}"#.to_owned()));
		let long = format!(r#"{{"action":"run","questionId":"q1","code":"{}"}}"#, "x".repeat(ANSWER_MAX + 1));
		assert_eq!(read(post(&id, "mock_00000000", &long).await).await, (400, r#"{"error":"Give questionId and code."}"#.to_owned()));
		let no_prep = (404, r#"{"error":"No such prep"}"#.to_owned());
		assert_eq!(read(create(State(app.clone()), Path(plain["id"].str_or_empty().to_owned())).await).await, no_prep);
		assert_eq!(read(create(State(app.clone()), Path("nope".to_owned())).await).await, no_prep);
		let (status, made) = read(create(State(app.clone()), Path(id.clone())).await).await;
		assert_eq!(status, 201);
		assert!(gs_base::re::Re::new(r#"^\{"mockId":"mock_[0-9a-f]{8}"\}$"#, "").test(&made), "{made}");
		std::fs::remove_dir_all(&root).unwrap();
	}
}
