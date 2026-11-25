//! A deadline request from the deadline page and godspeed's own space check, end to end against a
//! stand-in agent: each runs as one labelled background job with the space tools. A page request that changes the deadline ends quietly, and one that changes nothing
//! leaves the agent's last line on the page. A check that changes something is announced with its
//! lines and can be undone.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;
use gs_core::spaces::deadline_requests::RequestKind;
use gs_json::{Json, json, stringify};
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_services::App;
use gs_services::app::agents::pick_stand_in;
use gs_services::spaces::add_space_deadline;
use gs_services::spaces::deadline_requests::{deadline_request_rows, deadline_request_view, request_deadline};
use gs_services::spaces::space_checks::{check_spaces, check_spaces_now, undo_check};

struct Fixture {
	app: Arc<App>,
	agent: FakeAgent,
	dir: PathBuf,
}

impl Fixture {
	fn new() -> Fixture {
		let dir = std::env::temp_dir().join(format!("gs-deadline-request-{}", ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(dir.join(name)).unwrap();
		}
		let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None);
		let agent = FakeAgent::default();
		pick_stand_in(&app, agent.runtime());
		Fixture { app, agent, dir }
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

fn call(name: &str, args: Json) -> (String, Json) {
	(name.to_owned(), args)
}

fn says(text: &str) -> FakeStep {
	FakeStep::Text(text.to_owned())
}

/// The newest job's tools and what it asked the agent.
fn last_job(agent: &FakeAgent) -> (Vec<String>, String) {
	let sent = agent.sent();
	let open = sent.iter().rev().find(|m| m["type"].as_str() == Some("open")).expect("a job opened a session");
	let tools = open["tools"].items().iter().filter_map(|t| t["name"].as_str().map(str::to_owned)).collect();
	let asked = sent.iter().rev().find(|m| m["type"].as_str() == Some("send") && m["session"] == open["session"]).map(|m| m["content"][0]["text"].str_or_empty().to_owned());
	(tools, asked.unwrap_or_default())
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
	let change = call("update_space_deadline", json!({ "space_id": space_id, "deadline_id": deadline_id, "source": "Syllabus.pdf" }));
	f.agent.push(vec![FakeStep::Calls(vec![change]), says("Linked it from the syllabus.")]);
	request_deadline(&f.app, &space_id, &deadline_id, RequestKind::Coverage).unwrap();
	assert_eq!(stringify(&deadline_request_view(&f.app, &space_id, &deadline_id)), r#"{"running":"coverage","failed":null}"#);
	assert!(request_deadline(&f.app, &space_id, &deadline_id, RequestKind::Guide).is_err(), "one request at a time");
	assert_eq!(deadline_request_rows(&f.app)[0]["title"], json!("Deadline: Wave Optics Midterm"));
	assert_eq!(stringify(&ended(&f.app, &space_id, &deadline_id).await), r#"{"running":null,"failed":null}"#);
	let (tools, asked) = last_job(&f.agent);
	assert_eq!(tools, ["read_space", "search_space_files", "read_passage", "update_space_deadline"]);
	assert!(asked.contains("Work out what this deadline covers from the space's own files"), "{asked}");
	let saved = f.app.stores.spaces.get_space(&space_id).unwrap();
	assert_eq!(saved["deadlines"][0]["source"], json!("Syllabus.pdf"));
	let asked = gs_json::parse(&std::fs::read_to_string(f.app.paths.data.join("deadline-requests.json")).unwrap()).unwrap();
	assert_eq!(stringify(&asked), format!(r#"{{"version":2,"asked":["{deadline_id}"],"checkedInfo":[],"weighed":[],"pathAsked":[],"overdueAsked":[],"gapAsked":[]}}"#));

	f.agent.push(vec![says("I read the files.\nThey don't say what the midterm is like.")]);
	request_deadline(&f.app, &space_id, &deadline_id, RequestKind::About).unwrap();
	let view = ended(&f.app, &space_id, &deadline_id).await;
	assert!(last_job(&f.agent).0.iter().any(|t| t == "add_space_file"));
	assert_eq!(stringify(&view["failed"]), r#"{"kind":"about","said":"They don't say what the midterm is like."}"#);
}

#[tokio::test]
async fn a_check_adds_and_links_in_one_run_and_undo_puts_both_back() {
	let f = Fixture::new();
	let (space_id, exam) = exam(&f.app);
	let file = |id: &str, name: &str, kind: &str, at: &str| json!({ "id": id, "origin": "copied", "name": name, "path": format!("{id}/{name}"), "kind": kind, "contentFp": format!("fp_{id}"), "status": "ready", "addedAt": at });
	f.app.stores.spaces.save_files(&space_id, vec![file("f_w1", "Week 1.md", "study", "2026-11-01T10:00:00.000Z")], &[]).unwrap();
	f.app.stores.spaces.update_deadline(&space_id, &exam, &json!({ "fileIds": ["f_w1"] })).unwrap();
	check_spaces(&f.app, gs_base::clock::now_ms());
	assert!(deadline_request_rows(&f.app).is_empty(), "files from before the first check are never checked");

	let now = gs_base::time::iso_now();
	let mut files = f.app.stores.spaces.get_space(&space_id).unwrap()["files"].as_arr().unwrap().clone();
	files.extend([file("f_hw5", "HW5.md", "info", &now), file("f_w7", "Week 7.md", "study", &now)]);
	f.app.stores.spaces.save_files(&space_id, files, &[]).unwrap();
	let mut events = f.app.events.subscribe();
	let add = call("add_space_deadline", json!({ "space_id": space_id, "deadlines": [{ "kind": "homework", "name": "HW 5", "date": "2099-01-20", "time": "23:59" }] }));
	let link = call("update_space_deadline", json!({ "space_id": space_id, "deadline_id": exam, "file_ids": ["f_w1", "f_w7"] }));
	f.agent.push(vec![FakeStep::Calls(vec![add, link]), says("Added HW 5 and linked Week 7 to the midterm.")]);
	check_spaces_now(&f.app, gs_base::clock::now_ms());
	assert_eq!(deadline_request_rows(&f.app)[0]["title"], json!("Check: Wave Optics"));

	let mut checked = None;
	for _ in 0..2000 {
		while let Ok(event) = events.try_recv() {
			if event.kind == gs_base::events::EventKind::SpaceChecked {
				checked = Some(event.payload);
			}
		}
		if checked.is_some() {
			break;
		}
		gs_base::clock::sleep(5).await;
	}
	let checked = checked.expect("the check is announced");
	let (tools, prompt) = last_job(&f.agent);
	assert_eq!(tools, ["read_space", "search_space_files", "read_passage", "add_space_deadline", "update_space_deadline"]);
	assert!(prompt.contains("Info file HW5.md (file_id f_hw5)") && prompt.contains("New study files for Midterm (deadline_id"), "{prompt}");
	assert_eq!(checked["lines"], json!(["Added HW 5, due Tue Jan 20 11:59 PM", "Linked Week 7.md to Midterm"]));
	assert_eq!(checked["said"], json!("Added HW 5 and linked Week 7 to the midterm."));
	let undone = undo_check(&f.app, &space_id, checked["run"].str_or_empty()).unwrap();
	assert_eq!(undone["undone"], json!(2));
	let saved = f.app.stores.spaces.get_space(&space_id).unwrap();
	assert_eq!(saved["deadlines"].items().len(), 1);
	assert_eq!(saved["deadlines"][0]["fileIds"], json!(["f_w1"]));
}
