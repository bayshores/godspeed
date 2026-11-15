//! A deadline request from the deadline page, end to end against a stand-in agent on the bridge:
//! it runs as one labelled background work item with the space tools, a change to the deadline
//! ends it quietly, and a run that changes nothing leaves the agent's last line on the page.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_core::spaces::deadline_requests::RequestKind;
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};
use gs_json::{Json, json, stringify};
use gs_services::App;
use gs_services::spaces::add_space_deadline;
use gs_services::spaces::deadline_requests::{deadline_request_view, request_deadline};

struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-deadline-request-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		Fixture { app, dir }
	}
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

/// A space with one exam; its id and the exam's.
fn exam(app: &Arc<App>) -> (String, String) {
	let space_id = app.stores.spaces.create_space(&json!({ "name": "Wave Optics" })).unwrap()["id"].as_str().unwrap().to_owned();
	let added = add_space_deadline(app, &space_id, &json!({ "kind": "exam", "name": "Midterm", "date": "2099-03-02" })).unwrap();
	(space_id, added["id"].as_str().unwrap().to_owned())
}

/// Answers the next background work item with `reply`; the item.
async fn answer(app: &App, reply: AgentReply) -> gs_engine::bridge::WorkView {
	let view = app.bridge.wait_for_work(10_000, WaitOptions { full: true, ..WaitOptions::default() }).await.expect("a work item");
	app.bridge.respond_to_work(&view.work_id, reply, 0).unwrap();
	view
}

async fn ended(app: &App, space_id: &str, deadline_id: &str) -> Json {
	for _ in 0..2000 {
		let view = deadline_request_view(app, space_id, deadline_id);
		if view["running"].is_null() {
			return view;
		}
		gs_base::clock::sleep(5).await;
	}
	panic!("the request never ended");
}

#[tokio::test]
async fn a_request_that_links_files_ends_quietly_and_one_that_changes_nothing_says_why() {
	let f = Fixture::new();
	let (space_id, deadline_id) = exam(&f.app);
	request_deadline(&f.app, &space_id, &deadline_id, RequestKind::Coverage).unwrap();
	assert_eq!(stringify(&deadline_request_view(&f.app, &space_id, &deadline_id)), r#"{"running":"coverage","failed":null}"#);
	assert!(request_deadline(&f.app, &space_id, &deadline_id, RequestKind::Guide).is_err(), "one request at a time");

	let change = ReplyCall { name: "update_space_deadline".to_owned(), arguments: json!({ "space_id": space_id, "deadline_id": deadline_id, "source": "Syllabus.pdf" }) };
	let first = answer(&f.app, AgentReply { text: None, tool_calls: vec![change] }).await;
	assert_eq!(first.label.as_deref(), Some("Deadline: Wave Optics Midterm"));
	let tools: Vec<&str> = first.tools.iter().flatten().filter_map(|t| t["name"].as_str()).collect();
	assert_eq!(tools, ["read_space", "search_space_files", "read_passage", "update_space_deadline"]);
	assert!(stringify(&Json::Arr(first.messages)).contains("Work out what this deadline covers from the space's own files"));
	answer(&f.app, AgentReply { text: Some("Linked it from the syllabus.".to_owned()), tool_calls: Vec::new() }).await;
	assert_eq!(stringify(&ended(&f.app, &space_id, &deadline_id).await), r#"{"running":null,"failed":null}"#);
	let saved = f.app.stores.spaces.get_space(&space_id).unwrap();
	assert_eq!(saved["deadlines"][0]["source"], json!("Syllabus.pdf"));
	let asked = std::fs::read_to_string(f.app.paths.data.join("deadline-requests.json")).unwrap();
	assert_eq!(asked, format!("{{\n\t\"version\": 1,\n\t\"asked\": [\n\t\t\"{deadline_id}\"\n\t]\n}}"));

	request_deadline(&f.app, &space_id, &deadline_id, RequestKind::About).unwrap();
	let about = answer(&f.app, AgentReply { text: Some("I read the files.\nThey don't say what the midterm is like.".to_owned()), tool_calls: Vec::new() }).await;
	assert!(about.tools.iter().flatten().any(|t| t["name"] == json!("add_space_file")));
	let view = ended(&f.app, &space_id, &deadline_id).await;
	assert_eq!(stringify(&view["failed"]), r#"{"kind":"about","said":"They don't say what the midterm is like."}"#);
}
