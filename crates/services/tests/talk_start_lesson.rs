//! start_lesson as the teacher panel's chat calls it: a lesson for a topic, a deadline's study or
//! homework, or a set of files, started or continued, and opened in the window even with Follow
//! off, since the learner asked in godspeed itself.

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, ids};
use gs_json::{Json, json};
use gs_runtime::fake::FakeAgent;
use gs_services::App;
use gs_services::app::agent_actions::recent_agent_actions;
use gs_services::app::agents::use_runtime;
use gs_services::talk::tools::{ToolCall, checked_arguments, run_tool};

fn app() -> Arc<App> {
	let root = std::env::temp_dir().join(format!("gs-talk-start-{}", ids::uuid()));
	for name in ["data", "home", "tmp", "res"] {
		std::fs::create_dir_all(root.join(name)).unwrap();
	}
	let app = App::new(Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
	// A lesson start_lesson opens plays an empty turn, never the learner's real agent.
	use_runtime(&app, FakeAgent::default().runtime());
	app
}

/// The tool's answer text, as the agent reads it.
async fn call(app: &Arc<App>, tool: &str, args: Json) -> String {
	let answer = match checked_arguments(tool, &args) {
		Err(refused) => refused,
		Ok(args) => run_tool(&ToolCall { app, caller: Some("Claude Code") }, tool, &args).await,
	};
	answer["content"][0]["text"].str_or_empty().to_owned()
}

async fn start(app: &Arc<App>, args: Json) -> String {
	call(app, "start_lesson", args).await
}

async fn started(app: &Arc<App>, args: Json) -> Json {
	gs_json::parse(&start(app, args).await).unwrap()
}

/// Whether the window opened the agent's change, as Follow does.
fn opened(app: &App, label: &str) -> bool {
	recent_agent_actions(app).iter().find(|a| a["label"].as_str() == Some(label)).unwrap()["open"] == Json::Bool(true)
}

#[tokio::test]
async fn what_the_learner_asks_for_in_the_chat_opens() {
	let app = app();
	call(&app, "create_space", json!({ "name": "Biology", "icon": "dna" })).await;
	assert!(opened(&app, "Creating Biology"));
	let lesson = started(&app, json!({ "topic": "Cells" })).await;
	assert_eq!(lesson["note"].as_str(), Some("The lesson is in the godspeed window."), "{lesson:?}");
	assert!(opened(&app, "Starting Cells"));
}

#[tokio::test]
async fn start_lesson_starts_or_continues_a_deadlines_study_or_homework() {
	let app = app();
	let space_id = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap()["id"].str_or_empty().to_owned();
	let exam = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
	let homework = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();

	let study = started(&app, json!({ "deadline_id": exam })).await;
	assert_eq!((study["status"].as_str(), study["title"].as_str()), (Some("started"), Some("Study for Midterm")));
	assert_eq!(study["note"].as_str(), Some("The lesson is in the godspeed window."), "{study:?}");
	let messages = app.stores.chats.get_chat(study["lessonId"].str_or_empty()).unwrap()["messages"].items().to_vec();
	assert!(messages.iter().any(|m| m["role"].as_str() == Some("user")), "the title went as the first message");
	let again = started(&app, json!({ "deadline_id": exam, "space_id": space_id })).await;
	assert_eq!((again["status"].as_str(), &again["lessonId"]), (Some("continued"), &study["lessonId"]));
	assert_eq!(again["note"].as_str(), Some("The lesson is in the godspeed window. The learner continues where they left off."), "{again:?}");

	let work = started(&app, json!({ "deadline_id": homework, "homework": true })).await;
	assert_eq!((work["status"].as_str(), work["title"].as_str()), (Some("started"), Some("Work on HW6")));
	let more = started(&app, json!({ "deadline_id": homework, "homework": true })).await;
	assert_eq!((more["status"].as_str(), &more["lessonId"]), (Some("continued"), &work["lessonId"]));

	// A later clock tick than the Study session's last message.
	clock::advance(5);
	let practice = started(&app, json!({ "topic": "Practice test", "deadline_id": exam })).await;
	assert_eq!((practice["status"].as_str(), practice["title"].as_str()), (Some("started"), Some("Practice test")));
	let made = app.stores.chats.get_chat(practice["lessonId"].str_or_empty()).unwrap();
	assert_eq!((made["deadlineId"].as_str(), made["spaceId"].as_str()), (Some(exam.as_str()), Some(space_id.as_str())), "a topic lesson for the deadline, in its space");
	let back = started(&app, json!({ "deadline_id": exam })).await;
	assert_eq!((back["status"].as_str(), &back["lessonId"]), (Some("continued"), &practice["lessonId"]), "Study continues the lesson worked in last");

	assert_eq!(start(&app, json!({})).await, "Give topic, deadline_id or file_ids.");
	assert_eq!(start(&app, json!({ "topic": "Sums", "homework": true })).await, "homework takes deadline_id alone, not a topic (\"Sums\").");
	assert_eq!(start(&app, json!({ "topic": "Sums", "deadline_id": exam, "homework": true })).await, "homework takes deadline_id alone, not a topic (\"Sums\").");
	assert_eq!(start(&app, json!({ "topic": "Sums", "deadline_id": exam, "space_id": "spc_other" })).await, format!("No deadline \"{exam}\". Use read_space."));
	assert_eq!(start(&app, json!({ "deadline_id": "ddl_gone" })).await, "No deadline \"ddl_gone\". Use read_space.");
	assert_eq!(start(&app, json!({ "deadline_id": exam, "space_id": "spc_other" })).await, format!("No deadline \"{exam}\". Use read_space."));
	assert_eq!(start(&app, json!({ "deadline_id": exam, "homework": true })).await, "Midterm is not homework or a project, so it has no problems to work on. Leave homework out to study for it.");
	app.stores.spaces.update_space(&space_id, &json!({ "closed": true })).unwrap();
	assert_eq!(start(&app, json!({ "deadline_id": exam })).await, "This space is closed. Ask the learner to reopen it first.");
}

#[tokio::test]
async fn start_lesson_starts_or_continues_a_lesson_on_files() {
	let app = app();
	let space_id = app.stores.spaces.create_space(&json!({ "name": "Calculus" })).unwrap()["id"].str_or_empty().to_owned();
	let file = |id: &str, name: &str| json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" });
	app.stores.spaces.save_files(&space_id, vec![file("f_test", "Practice midterm.pdf"), file("f_key", "Key.pdf")], &[]).unwrap();
	let exam = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();

	let made = started(&app, json!({ "file_ids": ["f_test", "f_key"], "deadline_id": exam })).await;
	assert_eq!((made["status"].as_str(), made["title"].as_str()), (Some("started"), Some("Practice midterm")), "{made:?}");
	let chat = app.stores.chats.get_chat(made["lessonId"].str_or_empty()).unwrap();
	assert_eq!((chat["fileIds"].clone(), chat["deadlineId"].as_str(), chat["spaceId"].as_str()), (json!(["f_test", "f_key"]), Some(exam.as_str()), Some(space_id.as_str())));
	let again = started(&app, json!({ "file_ids": ["f_test"] })).await;
	assert_eq!((again["status"].as_str(), &again["lessonId"]), (Some("continued"), &made["lessonId"]));

	assert_eq!(start(&app, json!({ "file_ids": ["f_test"], "topic": "Limits" })).await, "file_ids takes no topic and no homework: the first file names the lesson.");
	assert_eq!(start(&app, json!({ "file_ids": ["f_test"], "deadline_id": exam, "homework": true })).await, "file_ids takes no topic and no homework: the first file names the lesson.");
	assert_eq!(start(&app, json!({ "file_ids": ["f_gone"] })).await, "No file \"f_gone\". Use read_space with files: true.");
	assert!(start(&app, json!({ "file_ids": ["a", "b", "c", "d", "e", "f", "g", "h", "i"] })).await.contains("file_ids"), "more than 8 fails the schema");
}
