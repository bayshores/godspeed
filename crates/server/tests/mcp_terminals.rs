//! An agent started in one of the app's terminals sends that terminal's id. Once the shell says
//! the terminal ended, its requests are refused.

mod common;
use common::{TERMINAL, agent_event, app, call, own_tool, round};
use gs_services::App;

#[tokio::test]
async fn an_ended_terminals_agent_is_refused_at_the_door() {
	let app = app();
	let (status, body) = call(&app, Some(TERMINAL), "list_spaces", "{}").await;
	assert_eq!((status, body.as_str()), (403, r#"{"error":"This terminal was closed in godspeed."}"#), "no live terminal has this id");
	for odd in ["ABCDEF0123456789ABCDEF0123456789", "0123", "not an id at all, 32 chars long!"] {
		assert_eq!(call(&app, Some(odd), "list_spaces", "{}").await.0, 403, "{odd}");
	}
	let (status, body) = call(&app, None, "list_spaces", "{}").await;
	assert_eq!(status, 200, "an outside agent is served as before: {body}");

	app.terminals.set_live_terminals(vec![TERMINAL.to_owned()], Some(TERMINAL.to_owned()));
	assert_eq!(call(&app, Some(TERMINAL), "list_spaces", "{}").await.0, 200);
	let access = gs_server::mcp::mcp_access_status(&app).unwrap();
	assert_eq!(access["terminals"], gs_json::json!([{ "id": TERMINAL, "here": true }]));
	assert_eq!(access["outsideHere"], gs_json::Json::Bool(true));
	app.terminals.set_live_terminals(Vec::new(), None);
	assert_eq!(call(&app, Some(TERMINAL), "list_spaces", "{}").await.0, 403);
}

/// Whether the window opened the agent's last change, as Follow does.
fn opened(app: &App, label: &str) -> bool {
	let actions = gs_services::app::agent_actions::recent_agent_actions(app);
	actions.iter().find(|a| a["label"].as_str() == Some(label)).unwrap()["open"] == gs_json::Json::Bool(true)
}

#[tokio::test]
async fn what_the_teacher_terminal_starts_opens() {
	let app = app();
	let other = "f".repeat(32);
	app.terminals.set_live_terminals(vec![TERMINAL.to_owned(), other.clone()], Some(TERMINAL.to_owned()));
	call(&app, None, "create_space", r#"{"name":"Algebra","icon":"sigma"}"#).await;
	assert!(!opened(&app, "Creating Algebra"), "an agent outside the app changes things on its own");
	call(&app, Some(&other), "create_space", r#"{"name":"Chemistry","icon":"sigma"}"#).await;
	assert!(!opened(&app, "Creating Chemistry"), "another terminal is not where the learner asks");
	call(&app, Some(TERMINAL), "create_space", r#"{"name":"Biology","icon":"dna"}"#).await;
	assert!(opened(&app, "Creating Biology"), "the learner asked in the teacher's terminal");

	let (_, body) = call(&app, Some(TERMINAL), "start_lesson", r#"{"topic":"Cells"}"#).await;
	assert_eq!(gs_json::parse(&text(&body)).unwrap()["note"].as_str(), Some("The lesson is in the godspeed window."), "{body}");
	assert!(opened(&app, "Starting Cells"));
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
		async move { text(&call(&app, None, "start_lesson", &args).await.1) }
	};

	let study = gs_json::parse(&start(format!(r#"{{"deadline_id":"{exam}"}}"#)).await).unwrap();
	assert_eq!((study["status"].as_str(), study["title"].as_str()), (Some("started"), Some("Study for Midterm")));
	assert_eq!(study["note"].as_str(), Some("The lesson is in the godspeed window."), "{study:?}");
	let messages = app.stores.chats.get_chat(study["lessonId"].str_or_empty()).unwrap()["messages"].items().to_vec();
	assert!(messages.iter().any(|m| m["role"].as_str() == Some("user")), "the title went as the first message");
	let again = gs_json::parse(&start(format!(r#"{{"deadline_id":"{exam}","space_id":"{space_id}"}}"#)).await).unwrap();
	assert_eq!((again["status"].as_str(), &again["lessonId"]), (Some("continued"), &study["lessonId"]));
	assert_eq!(again["note"].as_str(), Some("The lesson is in the godspeed window. The learner continues where they left off."), "{again:?}");

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
		async move { text(&call(&app, None, "start_lesson", &args).await.1) }
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
	let (_, body) = call(&app, None, "open_page", &args).await;
	assert!(text(&body).contains("Sent to the godspeed window"), "{body}");
	call(&app, None, "open_page", &args).await;
	let opens = gs_services::app::agent_actions::recent_agent_actions(&app).into_iter().filter(|a| a["label"].as_str() == Some("Opening Algebra's Files")).count();
	assert_eq!(opens, 2, "asked twice, it opens twice");
	assert!(opened(&app, "Opening Algebra's Files"), "an agent outside the app opens it too");
	let (_, body) = call(&app, None, "open_page", r#"{"page":"files"}"#).await;
	assert!(body.contains(r#""isError":true"#) && text(&body) == "Files needs a space_id.", "{body}");
	let (_, body) = call(&app, None, "open_page", r#"{"page":"inbox"}"#).await;
	assert!(body.contains(r#""isError":true"#), "{body}");
}

#[tokio::test]
async fn the_teacher_terminal_s_reads_are_its_round_s_steps_until_it_stops() {
	let app = app();
	let other = "f".repeat(32);
	app.terminals.set_live_terminals(vec![TERMINAL.to_owned(), other.clone()], Some(TERMINAL.to_owned()));
	let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "CSE 21" })).unwrap()["id"].str_or_empty().to_owned();
	let space = format!(r#"{{"space_id":"{space_id}"}}"#);
	call(&app, Some(TERMINAL), "read_space", &space).await;
	assert_eq!(round(&app), None, "no line from the learner, no round");

	app.terminals.chat_line(TERMINAL, gs_base::clock::now_ms());
	call(&app, Some(TERMINAL), "read_space", &space).await;
	call(&app, Some(&other), "list_spaces", "{}").await;
	call(&app, Some(TERMINAL), "update_space", &format!(r#"{{"space_id":"{space_id}","description":"Discrete math."}}"#)).await;
	assert_eq!(round(&app), Some(vec!["Looking at CSE 21".to_owned()]), "another terminal's read and the change are no steps");

	assert_eq!(agent_event(&app, Some(TERMINAL), gs_json::json!({ "event": "stop" })), 200);
	assert_eq!(round(&app), None, "its Stop hook ends it");
}

#[tokio::test]
async fn an_outside_agent_s_round_ends_when_it_goes_quiet() {
	let app = app();
	call(&app, None, "list_spaces", "{}").await;
	assert_eq!(round(&app), Some(vec!["Looking at your spaces".to_owned()]), "its first call begins the round");
	let later = app.terminals.teacher_work(gs_base::clock::now_ms() + 20_000);
	assert_eq!(later["live"], gs_json::Json::Bool(false), "20 seconds with no call end it");
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
	call(&app, None, "list_spaces", "{}").await;
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
	let other = "f".repeat(32);
	app.terminals.set_live_terminals(vec![TERMINAL.to_owned(), other.clone()], Some(TERMINAL.to_owned()));
	let mut events = app.events.subscribe();
	assert_eq!(own_tool(&app, Some(TERMINAL), "WebSearch", "cse 21 hw7"), 200);
	assert_eq!(round(&app), None, "a tool begins no round");

	app.terminals.chat_line(TERMINAL, gs_base::clock::now_ms());
	own_tool(&app, Some(TERMINAL), "WebSearch", "cse 21 hw7");
	own_tool(&app, Some(&other), "Read", "other.pdf");
	own_tool(&app, None, "Read", "outside.pdf");
	own_tool(&app, Some(TERMINAL), "TodoWrite", "plan");
	own_tool(&app, Some(TERMINAL), "Bash", "ignored");
	assert_eq!(round(&app), Some(vec!["Searching the web for “cse 21 hw7”".to_owned(), "Running a command".to_owned()]), "another terminal, an agent outside godspeed and an unlisted tool make no step");

	let data = app.paths.data.clone();
	assert!(!written(&data, "cse 21 hw7") && !written(&data, "other.pdf"), "no subject in the data folder");
	while let Ok(event) = events.try_recv() {
		assert!(!gs_json::stringify(&event.payload).contains("cse 21"), "{event:?}");
	}
}
