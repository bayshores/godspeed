//! Preps end to end against a stand-in agent on the bridge: making one saves the learner's words
//! and attached files and asks for the sheet, the sheet lands on the space with a short name, a bad
//! sheet is sent back, a failed write can be tried again keeping topic ids, and the learner's own
//! changes.

use gs_base::clock;
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};

use super::*;
use crate::app::test_support::{scratch_dir, test_app};

fn sheet() -> Json {
	json!({
		"name": "Acme junior web test",
		"about": "Four coding questions in 70 minutes.",
		"sources": [{ "title": "Acme test guide", "url": "https://example.com/guide" }],
		"topics": [{ "name": "Arrays and strings", "why": "Questions 1 and 2" }, { "name": "Hash maps" }],
		"mock": { "questions": 4, "minutes": 70 },
	})
}

fn with(base: Json, key: &str, value: Json) -> Json {
	let mut out = base;
	out.as_obj_mut().unwrap().insert(key, value);
	out
}

/// Answers the next work item with one write_prep_sheet call (or words only); what it was asked
/// and the label it carried.
async fn agent(app: &App, sheet: Option<Json>) -> (String, String) {
	let view = app.bridge.wait_for_work(10_000, WaitOptions::default()).await.expect("a work item");
	let reply = match sheet {
		Some(arguments) => AgentReply { text: None, tool_calls: vec![ReplyCall { name: "write_prep_sheet".to_owned(), arguments }] },
		None => AgentReply { text: Some("I could not find anything.".to_owned()), tool_calls: Vec::new() },
	};
	app.bridge.respond_to_work(&view.work_id, reply, 0).unwrap();
	let asked = view.messages.iter().map(|m| m["text"].as_str().unwrap_or("").to_owned()).collect::<Vec<_>>().join("\n");
	(asked, view.label.unwrap_or_default())
}

fn view(app: &Arc<App>, space_id: &str) -> Json {
	prep_view(app, space_id).unwrap()
}

async fn settled(app: &Arc<App>, space_id: &str) {
	for _ in 0..2000 {
		if !view(app, space_id)["writing"].truthy() {
			return;
		}
		clock::sleep(5).await;
	}
	panic!("the request never ended");
}

fn names(view: &Json) -> Vec<String> {
	items(&view["topics"]).iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect()
}

fn file(name: &str, bytes: &[u8]) -> NewFile {
	NewFile { name: name.to_owned(), bytes: bytes.to_vec() }
}

#[tokio::test]
async fn a_prep_is_made_from_the_learners_words_and_the_teachers_sheet_lands_on_it() {
	let root = scratch_dir("preps-made");
	let app = test_app(&root);
	let mut events = app.events.subscribe();
	let posting = file("posting.txt", b"Junior web role, React.");
	let refused = create_prep(&app, "Acme", None, &[file("posting.txt", b"x"), file("photo.heic", &[0, 1, 2])]);
	assert!(matches!(refused, Err(Stop::Refuse(400, ref e)) if e.starts_with("photo.heic: unsupported file type")));
	assert!(app.stores.spaces.list_spaces().is_empty(), "nothing is made when a file can't be read");

	let space_id = create_prep(&app, " Acme online test for a junior web role ", Some("2026-11-20"), &[posting]).unwrap();
	let before = view(&app, &space_id);
	assert_eq!(before["writing"], Json::from(true));
	assert_eq!(before["name"], Json::from("Acme online test for a junior web role"), "named by the learner's words until the sheet is in");
	let (asked, label) = agent(&app, Some(sheet())).await;
	settled(&app, &space_id).await;
	assert_eq!(label, "Prep sheet: Acme online test for a junior web role");
	assert!(asked.contains("They are preparing for: Acme online test for a junior web role\nToday is "));
	assert!(asked.contains("It is on 2026-11-20."));
	assert!(asked.contains("They attached these files. Read them first:\n- posting.txt: ") && asked.contains(&format!("{}posting.txt", std::path::MAIN_SEPARATOR)), "the attached file, with where to read it");

	let after = view(&app, &space_id);
	assert_eq!(after["name"], Json::from("Acme junior web test"));
	assert_eq!(after["prep"]["about"], Json::from("Four coding questions in 70 minutes."));
	assert_eq!(after["prep"]["date"], Json::from("2026-11-20"));
	assert_eq!(gs_json::stringify(&after["prep"]["mock"]), r#"{"questions":4,"minutes":70}"#);
	assert_eq!(names(&after), ["Arrays and strings", "Hash maps"]);
	assert!(items(&after["topics"]).iter().all(|t| t["status"] == Json::from("untested")));
	assert!(gs_base::re::Re::new(r"^pt_[a-f0-9]{8}$", "").test(after["topics"][0]["id"].as_str().unwrap()));
	let record = app.stores.spaces.get_space(&space_id).unwrap();
	assert_eq!((record["files"][0]["name"].clone(), record["files"][0]["kind"].clone()), (Json::from("posting.txt"), Json::from("info")));

	let mut prep_events = 0;
	while let Ok(event) = events.try_recv() {
		if event.kind == EventKind::PrepChanged {
			assert_eq!(event.payload, json!({ "spaceId": space_id }));
			prep_events += 1;
		}
	}
	assert!(prep_events >= 2, "announced when it started and when it ended");
}

#[tokio::test]
async fn a_long_goal_names_the_prep_by_its_first_words_and_is_kept_whole() {
	let root = scratch_dir("preps-long-goal");
	let app = test_app(&root);
	let goal = "Second round with the platform team at Acme, two hours of system design and one of code";
	let space_id = create_prep(&app, goal, None, &[]).unwrap();
	let before = view(&app, &space_id);
	assert_eq!((before["name"].as_str().unwrap(), before["prep"]["goal"].as_str().unwrap()), ("Second round with the platform team at…", goal));
	agent(&app, Some(sheet())).await;
	settled(&app, &space_id).await;
}

#[tokio::test]
async fn a_sheet_that_cant_be_kept_is_sent_back_and_the_next_one_kept() {
	let root = scratch_dir("preps-sent-back");
	let app = test_app(&root);
	let space_id = create_prep(&app, "Bank interview", None, &[]).unwrap();
	agent(&app, Some(with(sheet(), "about", json!("  ")))).await;
	let (asked, _) = agent(&app, Some(sheet())).await;
	settled(&app, &space_id).await;
	assert!(asked.contains("about is empty: say what it is like."));
	assert_eq!(view(&app, &space_id)["prep"]["about"], Json::from("Four coding questions in 70 minutes."));
}

#[tokio::test]
async fn a_failed_write_says_why_and_writing_again_keeps_topic_ids() {
	let root = scratch_dir("preps-again");
	let app = test_app(&root);
	let space_id = create_prep(&app, "Driving theory test", None, &[]).unwrap();
	agent(&app, None).await;
	settled(&app, &space_id).await;
	assert_eq!(view(&app, &space_id)["error"], Json::from("the agent never sent the sheet"));
	assert!(items(&view(&app, &space_id)["prep"]["topics"]).is_empty());

	start_write(&app, &space_id).unwrap();
	assert_eq!(start_write(&app, &space_id), fail(409, "Your agent is still writing this sheet."), "one request at a time");
	agent(&app, Some(sheet())).await;
	settled(&app, &space_id).await;
	assert!(view(&app, &space_id).get("error").is_none());
	let first: Vec<Json> = items(&view(&app, &space_id)["topics"]).iter().map(|t| t["id"].clone()).collect();

	start_write(&app, &space_id).unwrap();
	let (asked, _) = agent(&app, Some(with(sheet(), "topics", json!([{ "name": "Recursion" }, { "name": "hash maps" }])))).await;
	settled(&app, &space_id).await;
	assert!(asked.contains("The sheet's topics now (keep a name where it still fits):\n- Arrays and strings\n- Hash maps"));
	let again = view(&app, &space_id);
	assert_eq!(names(&again), ["Recursion", "hash maps"]);
	assert_eq!(again["topics"][1]["id"], first[1], "the same topic keeps its id");
}

#[tokio::test]
async fn the_learners_own_changes_wait_for_the_sheet_and_are_checked() {
	let root = scratch_dir("preps-changes");
	let app = test_app(&root);
	let space_id = create_prep(&app, "Initech phone screen", None, &[]).unwrap();
	let graphs = json!({ "addTopics": [{ "name": "Graphs" }] });
	assert_eq!(change_prep(&app, &space_id, &graphs), fail(409, "Your agent is still writing this sheet. Change it once it is done."));
	agent(&app, Some(sheet())).await;
	settled(&app, &space_id).await;

	let mut events = app.events.subscribe();
	change_prep(&app, &space_id, &graphs).unwrap();
	let kinds: Vec<EventKind> = std::iter::from_fn(|| events.try_recv().ok()).map(|e| e.kind).collect();
	assert_eq!(kinds, [EventKind::SpacesChanged, EventKind::PrepChanged]);
	assert_eq!(change_prep(&app, &space_id, &json!({ "addTopics": [{ "name": "graphs" }] })), fail(400, "\"graphs\" is already on the sheet."));
	let added = items(&view(&app, &space_id)["topics"]).last().unwrap().clone();
	assert_eq!(added["name"], Json::from("Graphs"));
	change_prep(&app, &space_id, &json!({ "removeTopicIds": [added["id"]] })).unwrap();
	assert_eq!(names(&view(&app, &space_id)), ["Arrays and strings", "Hash maps"]);
	change_prep(&app, &space_id, &json!({ "date": "2026-12-01" })).unwrap();
	assert_eq!(view(&app, &space_id)["prep"]["date"], Json::from("2026-12-01"));
	change_prep(&app, &space_id, &json!({ "date": null })).unwrap();
	assert!(view(&app, &space_id)["prep"].get("date").is_none());
}

#[tokio::test]
async fn an_empty_goal_and_a_space_that_is_no_prep_are_refused() {
	let root = scratch_dir("preps-refused");
	let app = test_app(&root);
	assert_eq!(create_prep(&app, "   ", None, &[]), fail(400, "Say what you are preparing for."));
	let plain = app.stores.spaces.create_space(&json!({ "name": "Plain space" })).unwrap()["id"].as_str().unwrap().to_owned();
	assert_eq!(prep_view(&app, &plain), fail(404, "No such prep"));
	assert_eq!(start_write(&app, &plain), fail(404, "No such prep"));
}
