//! An agent started in one of the app's terminals sends that terminal's id. Once the shell says
//! the terminal ended, its requests are refused and a wait it had open ends with the same words.

use std::sync::Arc;

use gs_services::App;

mod common;
use common::{TERMINAL, app, call, own_tool, round, send, work_id};

const CLOSED: &str = "This terminal was closed in godspeed.";

/// A wait_for_work call as the waiter sends it, from `terminal` when given.
async fn wait(app: &Arc<App>, terminal: Option<&str>) -> (u16, String) {
	call(app, terminal, None, "wait_for_work", r#"{"timeout_seconds":1}"#).await
}

/// The same from a Claude Code session the folder's waiter wakes, as its connector sends it.
async fn woken(app: &Arc<App>, terminal: Option<&str>, agent: &str, tool: &str, arguments: &str) -> (u16, String) {
	send(app, terminal, Some(format!(r#""godspeed/agent":"{agent}","godspeed/wakes":true"#)), tool, arguments).await
}

#[tokio::test]
async fn an_ended_terminals_agent_is_refused_at_the_door_and_in_its_wait() {
	let app = app();
	let (status, body) = wait(&app, Some(TERMINAL)).await;
	assert_eq!((status, body.as_str()), (403, r#"{"error":"This terminal was closed in godspeed."}"#), "no live terminal has this id");
	for odd in ["ABCDEF0123456789ABCDEF0123456789", "0123", "not an id at all, 32 chars long!"] {
		assert_eq!(wait(&app, Some(odd)).await.0, 403, "{odd}");
	}
	let (status, body) = wait(&app, None).await;
	assert_eq!(status, 200, "an outside agent is served as before: {body}");
	assert!(!body.contains(CLOSED));

	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	let open = gs_base::tasks::spawn("test", {
		let app = app.clone();
		async move { wait(&app, Some(TERMINAL)).await }
	});
	gs_base::clock::sleep(50).await;
	let access = gs_server::mcp::mcp_access_status(&app).unwrap();
	assert_eq!(access["terminals"], gs_json::json!([{ "id": TERMINAL, "here": true }]));
	assert_eq!(access["outsideHere"], gs_json::Json::Bool(true));
	app.bridge.set_live_terminals(Vec::new(), None);
	let (status, body) = open.await.unwrap();
	assert_eq!(status, 200);
	assert!(body.contains(r#""isError":true"#) && body.contains(CLOSED), "{body}");
}

#[tokio::test]
async fn typing_in_the_terminal_ends_its_wait_with_a_note() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	let open = gs_base::tasks::spawn("test", {
		let app = app.clone();
		async move { wait(&app, Some(TERMINAL)).await }
	});
	gs_base::clock::sleep(50).await;
	app.bridge.typed(TERMINAL, gs_base::clock::now_ms());
	let (status, body) = open.await.unwrap();
	assert_eq!(status, 200);
	let note = r#"{\"status\":\"idle\",\"note\":\"The learner typed to you in your terminal. Answer them there, then call wait_for_work again.\"}"#;
	assert!(body.contains(note) && !body.contains(r#""isError":true"#), "{body}");
	let (_, body) = wait(&app, Some(TERMINAL)).await;
	assert!(body.contains("Nothing to do right now."), "read once: {body}");
}

#[tokio::test]
async fn a_tool_call_after_the_typing_shows_the_agent_already_read_it() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	app.bridge.typed(TERMINAL, gs_base::clock::now_ms());
	let (status, body) = call(&app, Some(TERMINAL), None, "list_spaces", "{}").await;
	assert_eq!(status, 200, "{body}");
	let (_, body) = wait(&app, Some(TERMINAL)).await;
	assert!(body.contains("Nothing to do right now.") && !body.contains("typed to you"), "{body}");
}

/// Whether the window opened the agent's last change, as Follow does.
fn opened(app: &App, label: &str) -> bool {
	let actions = gs_services::app::agent_actions::recent_agent_actions(app);
	actions.iter().find(|a| a["label"].as_str() == Some(label)).unwrap()["open"] == gs_json::Json::Bool(true)
}

#[tokio::test]
async fn what_the_teacher_terminal_starts_opens_and_a_woken_session_ends_its_turn_for_its_turns() {
	let app = app();
	let helper = "f".repeat(32);
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned(), helper.clone()], Some(TERMINAL.to_owned()));
	call(&app, None, None, "create_space", r#"{"name":"Algebra","icon":"sigma"}"#).await;
	assert!(!opened(&app, "Creating Algebra"), "an agent outside the app changes things on its own");
	call(&app, Some(&helper), None, "create_space", r#"{"name":"Chemistry","icon":"sigma"}"#).await;
	assert!(!opened(&app, "Creating Chemistry"), "the helper's terminal is not where the learner asks");
	call(&app, Some(TERMINAL), None, "create_space", r#"{"name":"Biology","icon":"dna"}"#).await;
	assert!(opened(&app, "Creating Biology"), "the learner asked in the teacher's terminal");

	let (_, body) = woken(&app, Some(TERMINAL), "sess-1", "start_lesson", r#"{"topic":"Cells"}"#).await;
	assert!(body.contains("The lesson is in the godspeed window. Tell the user so in one short line, then end your turn; godspeed wakes you when work arrives."), "{body}");
	assert!(opened(&app, "Starting Cells"));
	let (_, body) = call(&app, None, Some("sess-2"), "start_lesson", r#"{"topic":"Mitosis"}"#).await;
	assert!(body.contains("The lesson is in the godspeed window. Call wait_for_work with lesson_id"), "nothing wakes an agent started some other way: {body}");
}

#[tokio::test]
async fn a_woken_session_that_waits_itself_is_answered_at_once() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	let before = std::time::Instant::now();
	let (_, body) = woken(&app, Some(TERMINAL), "sess-1", "wait_for_work", r#"{"timeout_seconds":45}"#).await;
	assert!(before.elapsed() < std::time::Duration::from_secs(5), "its waiter does the waiting");
	assert!(body.contains(r#"Nothing to do right now. End your turn with only the word \\\"Waiting.\\\"; godspeed wakes you when work arrives."#), "{body}");
}

#[tokio::test]
async fn typing_while_respond_waits_for_a_follow_up_ends_the_step_with_a_note() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	// Background work, asked, so the teacher takes it at once rather than after the helper's grace.
	app.bridge.mark_asked("job_ask");
	let engine = gs_engine::turn::models::agent_engine(&app.bridge);
	let job = gs_base::tasks::spawn("test", async move {
		let ask = vec![gs_json::json!({ "role": "user", "content": "what does HW6 cover", "timestamp": 1 })];
		gs_engine::turn::faux::stream(&engine, ask, Some("job_ask".to_owned()), &gs_engine::turn::abort::Abort::new(), &mut |_| {}).await
	});
	gs_base::clock::sleep(20).await;
	let (_, body) = call(&app, Some(TERMINAL), Some("sess-1"), "wait_for_work", r#"{"timeout_seconds":5}"#).await;
	let work_id = work_id(&body);
	let responding = gs_base::tasks::spawn("test", {
		let app = app.clone();
		async move { woken(&app, Some(TERMINAL), "sess-1", "respond", &format!(r#"{{"work_id":"{work_id}","text":"Limits.","wait_seconds":5}}"#)).await }
	});
	gs_base::clock::sleep(50).await;
	app.bridge.typed(TERMINAL, gs_base::clock::now_ms());
	let (status, body) = responding.await.unwrap();
	assert_eq!(status, 200);
	assert!(body.contains(r#"{\"status\":\"turn_complete\",\"note\":\"Task step done. The learner typed to you in your terminal. Answer them there, then end your turn; godspeed wakes you when work arrives.\"}"#), "{body}");
	job.await.unwrap();
}

/// The text of a tool result.
fn text(body: &str) -> String {
	let reply = gs_json::parse(body).unwrap();
	reply["result"]["content"][0]["text"].str_or_empty().to_owned()
}

#[tokio::test]
async fn start_lesson_starts_or_continues_a_deadlines_study_or_homework() {
	let app = app();
	let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Algebra" })).unwrap()["id"].str_or_empty().to_owned();
	let exam = app.stores.spaces.add_deadline(&space_id, &gs_json::json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
	let homework = app.stores.spaces.add_deadline(&space_id, &gs_json::json!({ "name": "HW6", "kind": "homework", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
	let start = |args: String| {
		let app = app.clone();
		async move { text(&call(&app, None, None, "start_lesson", &args).await.1) }
	};

	let study = gs_json::parse(&start(format!(r#"{{"deadline_id":"{exam}"}}"#)).await).unwrap();
	assert_eq!((study["status"].as_str(), study["title"].as_str()), (Some("started"), Some("Study for Midterm")));
	assert!(study["note"].str_or_empty().ends_with("to begin teaching."), "{study:?}");
	let messages = app.stores.chats.get_chat(study["lessonId"].str_or_empty()).unwrap()["messages"].items().to_vec();
	assert!(messages.iter().any(|m| m["role"].as_str() == Some("user")), "the title went as the first message");
	let again = gs_json::parse(&start(format!(r#"{{"deadline_id":"{exam}","space_id":"{space_id}"}}"#)).await).unwrap();
	assert_eq!((again["status"].as_str(), &again["lessonId"]), (Some("continued"), &study["lessonId"]));
	assert!(again["note"].str_or_empty().contains("The learner continues where they left off.") && !again["note"].str_or_empty().contains("to begin teaching"), "{again:?}");

	let work = gs_json::parse(&start(format!(r#"{{"deadline_id":"{homework}","homework":true}}"#)).await).unwrap();
	assert_eq!((work["status"].as_str(), work["title"].as_str()), (Some("started"), Some("Work on HW6")));
	let more = gs_json::parse(&start(format!(r#"{{"deadline_id":"{homework}","homework":true}}"#)).await).unwrap();
	assert_eq!((more["status"].as_str(), &more["lessonId"]), (Some("continued"), &work["lessonId"]));

	// A later clock tick than the Study session's last message.
	gs_base::clock::advance(5);
	let practice = gs_json::parse(&start(format!(r#"{{"topic":"Practice test","deadline_id":"{exam}"}}"#)).await).unwrap();
	assert_eq!((practice["status"].as_str(), practice["title"].as_str()), (Some("started"), Some("Practice test")));
	let made = app.stores.chats.get_chat(practice["lessonId"].str_or_empty()).unwrap();
	assert_eq!((made["deadlineId"].as_str(), made["spaceId"].as_str()), (Some(exam.as_str()), Some(space_id.as_str())), "a topic lesson for the deadline, in its space");
	let back = gs_json::parse(&start(format!(r#"{{"deadline_id":"{exam}"}}"#)).await).unwrap();
	assert_eq!((back["status"].as_str(), &back["lessonId"]), (Some("continued"), &practice["lessonId"]), "Study continues the lesson worked in last");

	assert_eq!(start("{}".to_owned()).await, "Give topic, deadline_id or file_ids.");
	assert_eq!(start(r#"{"topic":"Sums","homework":true}"#.to_owned()).await, "homework takes deadline_id alone, not a topic (\"Sums\").");
	assert_eq!(start(format!(r#"{{"topic":"Sums","deadline_id":"{exam}","homework":true}}"#)).await, "homework takes deadline_id alone, not a topic (\"Sums\").");
	assert_eq!(start(format!(r#"{{"topic":"Sums","deadline_id":"{exam}","space_id":"spc_other"}}"#)).await, format!("No deadline \"{exam}\". Use read_space."));
	assert_eq!(start(r#"{"deadline_id":"ddl_gone"}"#.to_owned()).await, "No deadline \"ddl_gone\". Use read_space.");
	assert_eq!(start(format!(r#"{{"deadline_id":"{exam}","space_id":"spc_other"}}"#)).await, format!("No deadline \"{exam}\". Use read_space."));
	assert_eq!(start(format!(r#"{{"deadline_id":"{exam}","homework":true}}"#)).await, "Midterm is not homework or a project, so it has no problems to work on. Leave homework out to study for it.");
	app.stores.spaces.update_space(&space_id, &gs_json::json!({ "closed": true })).unwrap();
	assert_eq!(start(format!(r#"{{"deadline_id":"{exam}"}}"#)).await, "This space is closed. Ask the learner to reopen it first.");
}

#[tokio::test]
async fn start_lesson_starts_or_continues_a_lesson_on_files() {
	let app = app();
	let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Calculus" })).unwrap()["id"].str_or_empty().to_owned();
	let file = |id: &str, name: &str| gs_json::json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "info", "contentFp": "x", "status": "ready", "addedAt": "t" });
	app.stores.spaces.save_files(&space_id, vec![file("f_test", "Practice midterm.pdf"), file("f_key", "Key.pdf")], &[]).unwrap();
	let exam = app.stores.spaces.add_deadline(&space_id, &gs_json::json!({ "name": "Midterm", "kind": "exam", "date": "2099-01-15" })).unwrap()["id"].str_or_empty().to_owned();
	let start = |args: String| {
		let app = app.clone();
		async move { text(&call(&app, None, None, "start_lesson", &args).await.1) }
	};

	let made = gs_json::parse(&start(format!(r#"{{"file_ids":["f_test","f_key"],"deadline_id":"{exam}"}}"#)).await).unwrap();
	assert_eq!((made["status"].as_str(), made["title"].as_str()), (Some("started"), Some("Practice midterm")), "{made:?}");
	let chat = app.stores.chats.get_chat(made["lessonId"].str_or_empty()).unwrap();
	assert_eq!((chat["fileIds"].clone(), chat["deadlineId"].as_str(), chat["spaceId"].as_str()), (gs_json::json!(["f_test", "f_key"]), Some(exam.as_str()), Some(space_id.as_str())));
	let again = gs_json::parse(&start(r#"{"file_ids":["f_test"]}"#.to_owned()).await).unwrap();
	assert_eq!((again["status"].as_str(), &again["lessonId"]), (Some("continued"), &made["lessonId"]));

	assert_eq!(start(r#"{"file_ids":["f_test"],"topic":"Limits"}"#.to_owned()).await, "file_ids takes no topic and no homework: the first file names the lesson.");
	assert_eq!(start(format!(r#"{{"file_ids":["f_test"],"deadline_id":"{exam}","homework":true}}"#)).await, "file_ids takes no topic and no homework: the first file names the lesson.");
	assert_eq!(start(r#"{"file_ids":["f_gone"]}"#.to_owned()).await, "No file \"f_gone\". Use read_space with files: true.");
	assert!(start(r#"{"file_ids":["a","b","c","d","e","f","g","h","i"]}"#.to_owned()).await.contains("file_ids"), "more than 8 fails the schema");
}

#[tokio::test]
async fn open_page_opens_from_any_terminal_every_time_it_is_asked() {
	let app = app();
	let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Algebra" })).unwrap()["id"].str_or_empty().to_owned();
	let args = format!(r#"{{"page":"files","space_id":"{space_id}"}}"#);
	let (_, body) = call(&app, None, None, "open_page", &args).await;
	assert!(text(&body).contains("Sent to the godspeed window"), "{body}");
	call(&app, None, None, "open_page", &args).await;
	let opens = gs_services::app::agent_actions::recent_agent_actions(&app).into_iter().filter(|a| a["label"].as_str() == Some("Opening Algebra's Files")).count();
	assert_eq!(opens, 2, "asked twice, it opens twice");
	assert!(opened(&app, "Opening Algebra's Files"), "an agent outside the app opens it too");
	let (_, body) = call(&app, None, None, "open_page", r#"{"page":"files"}"#).await;
	assert!(body.contains(r#""isError":true"#) && text(&body) == "Files needs a space_id.", "{body}");
	let (_, body) = call(&app, None, None, "open_page", r#"{"page":"inbox"}"#).await;
	assert!(body.contains(r#""isError":true"#), "{body}");
}

#[tokio::test]
async fn the_teacher_terminal_s_reads_are_its_round_s_steps_and_only_its_own_wait_ends_it() {
	let app = app();
	let helper = "f".repeat(32);
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned(), helper.clone()], Some(TERMINAL.to_owned()));
	let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "CSE 21" })).unwrap()["id"].str_or_empty().to_owned();
	let space = format!(r#"{{"space_id":"{space_id}"}}"#);
	call(&app, Some(TERMINAL), None, "read_space", &space).await;
	assert_eq!(round(&app), None, "no line from the learner, no round");

	app.bridge.chat_line(TERMINAL, gs_base::clock::now_ms());
	call(&app, Some(TERMINAL), None, "read_space", &space).await;
	call(&app, Some(&helper), None, "list_spaces", "{}").await;
	call(&app, Some(TERMINAL), None, "update_space", &format!(r#"{{"space_id":"{space_id}","description":"Discrete math."}}"#)).await;
	call(&app, Some(TERMINAL), None, "respond", r#"{"work_id":"w_gone_1","text":"Hi."}"#).await;
	assert_eq!(round(&app), Some(vec!["Looking at CSE 21".to_owned()]), "the helper's read, the change and the work loop are no steps");

	call(&app, Some(TERMINAL), Some("sess-1"), "wait_for_work", r#"{"timeout_seconds":1}"#).await;
	assert!(round(&app).is_some(), "the folder's waiter waits while its session works");
	woken(&app, Some(TERMINAL), "sess-1", "wait_for_work", r#"{"timeout_seconds":1}"#).await;
	assert_eq!(round(&app), None, "the session's own wait says it is done");
}

#[tokio::test]
async fn an_outside_agent_s_calls_count_unless_it_is_the_helper_or_holds_background_work() {
	let app = app();
	call(&app, None, None, "list_spaces", "{}").await;
	assert_eq!(round(&app), Some(vec!["Looking at your spaces".to_owned()]), "its first call begins the round");
	wait(&app, None).await;
	assert_eq!(round(&app), None, "its wait ends it");

	call(&app, None, Some("helper-1"), "wait_for_work", r#"{"timeout_seconds":1,"helper":true}"#).await;
	call(&app, None, Some("helper-1"), "list_spaces", "{}").await;
	assert_eq!(round(&app), None, "the helper's calls are not the teacher's");

	// An asked job, taken by an outside agent: its round begins, and the agent's own calls count
	// again only once it answered.
	app.bridge.mark_asked("job_ask");
	let engine = gs_engine::turn::models::agent_engine(&app.bridge);
	let job = gs_base::tasks::spawn("test", async move {
		let ask = vec![gs_json::json!({ "role": "user", "content": "what does HW6 cover", "timestamp": 1 })];
		gs_engine::turn::faux::stream(&engine, ask, Some("job_ask".to_owned()), &gs_engine::turn::abort::Abort::new(), &mut |_| {}).await
	});
	gs_base::clock::sleep(20).await;
	let (_, body) = call(&app, None, Some("bg-1"), "wait_for_work", r#"{"timeout_seconds":1}"#).await;
	let work_id = work_id(&body);
	call(&app, None, Some("bg-1"), "list_spaces", "{}").await;
	assert_eq!(round(&app), Some(Vec::new()), "held background work is no step");
	call(&app, None, Some("bg-1"), "respond", &format!(r#"{{"work_id":"{work_id}","text":"Limits.","wait_seconds":0}}"#)).await;
	job.await.unwrap();
	call(&app, None, Some("bg-1"), "list_spaces", "{}").await;
	assert_eq!(round(&app), Some(vec!["Looking at your spaces".to_owned()]));
}

#[tokio::test]
async fn the_window_reads_the_round_at_its_route() {
	use tokio::io::{AsyncReadExt, AsyncWriteExt};
	let app = app();
	let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
	let port = listener.local_addr().unwrap().port();
	gs_base::tasks::spawn("test", axum::serve(listener, gs_server::http::server(app.clone(), &gs_server::http::access::Access::default())).into_future());
	let get = || async move {
		let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
		conn.write_all(b"GET /api/teacher-work HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n").await.unwrap();
		let mut answer = String::new();
		conn.read_to_string(&mut answer).await.unwrap();
		gs_json::parse(answer.split("\r\n\r\n").nth(1).unwrap_or("")).unwrap()
	};
	assert_eq!(get().await, gs_json::json!({ "live": false, "since": null, "steps": [] }));
	call(&app, None, None, "list_spaces", "{}").await;
	let live = get().await;
	assert_eq!((live["live"].as_bool(), live["steps"][0]["text"].as_str()), (Some(true), Some("Looking at your spaces")), "{live:?}");
}

/// Whether `text` is in any file under the app's data folder.
fn written(dir: &std::path::Path, text: &str) -> bool {
	std::fs::read_dir(dir).unwrap().flatten().any(|entry| {
		let path = entry.path();
		if path.is_dir() { written(&path, text) } else { std::fs::read(&path).is_ok_and(|bytes| String::from_utf8_lossy(&bytes).contains(text)) }
	})
}

#[tokio::test]
async fn the_teacher_terminal_s_own_tools_are_steps_shown_and_never_written_down() {
	let app = app();
	let helper = "f".repeat(32);
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned(), helper.clone()], Some(TERMINAL.to_owned()));
	let mut events = app.events.subscribe();
	assert_eq!(own_tool(&app, Some(TERMINAL), "WebSearch", "cse 21 hw7"), 200);
	assert_eq!(round(&app), None, "a tool begins no round");

	app.bridge.chat_line(TERMINAL, gs_base::clock::now_ms());
	own_tool(&app, Some(TERMINAL), "WebSearch", "cse 21 hw7");
	own_tool(&app, Some(&helper), "Read", "helper.pdf");
	own_tool(&app, None, "Read", "outside.pdf");
	own_tool(&app, Some(TERMINAL), "TodoWrite", "plan");
	own_tool(&app, Some(TERMINAL), "Bash", "ignored");
	assert_eq!(round(&app), Some(vec!["Searching the web for “cse 21 hw7”".to_owned(), "Running a command".to_owned()]), "the helper, an agent outside godspeed and an unlisted tool make no step");

	let data = app.paths.data.clone();
	assert!(!written(&data, "cse 21 hw7") && !written(&data, "helper.pdf"), "no subject in the data folder");
	while let Ok(event) = events.try_recv() {
		assert!(!gs_json::stringify(&event.payload).contains("cse 21"), "{event:?}");
	}
}

#[tokio::test]
async fn the_teacher_s_own_tools_make_no_step_while_it_holds_background_work() {
	let app = app();
	app.bridge.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	app.bridge.set_terminal_chat(TERMINAL, "sess-1");
	app.bridge.chat_line(TERMINAL, gs_base::clock::now_ms());
	// Asked, so the teacher takes it at once rather than after the helper's grace.
	app.bridge.mark_asked("job_check");
	let engine = gs_engine::turn::models::agent_engine(&app.bridge);
	let job = gs_base::tasks::spawn("test", async move {
		let ask = vec![gs_json::json!({ "role": "user", "content": "read HW6", "timestamp": 1 })];
		gs_engine::turn::faux::stream(&engine, ask, Some("job_check".to_owned()), &gs_engine::turn::abort::Abort::new(), &mut |_| {}).await
	});
	gs_base::clock::sleep(20).await;
	let (_, body) = call(&app, Some(TERMINAL), Some("sess-1"), "wait_for_work", r#"{"timeout_seconds":1}"#).await;
	let work_id = work_id(&body);
	own_tool(&app, Some(TERMINAL), "Read", "HW6.pdf");
	assert_eq!(round(&app), Some(Vec::new()), "held background work is no step");
	call(&app, Some(TERMINAL), Some("sess-1"), "respond", &format!(r#"{{"work_id":"{work_id}","text":"Done.","wait_seconds":0}}"#)).await;
	job.await.unwrap();
	own_tool(&app, Some(TERMINAL), "Read", "HW6.pdf");
	assert_eq!(round(&app), Some(vec!["Reading HW6.pdf".to_owned()]));
}
