//! The Codex adapter against recorded app-server turns, over in-memory pipes.

use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::{Json, json};
use tokio::sync::mpsc::UnboundedReceiver;

use crate::event::{Ask, End, Part, ToolCall, ToolReply, Usage};
use crate::session::{Runtime, Session};
use crate::test_peer::{Peer, Seen, fixture, next, replay, runtime, seen_until_end, spec, text_reply};

/// Opens a session on a new app-server: the handshake, and the thread started or resumed. Gives
/// the thread request's params too.
async fn open(runtime: &Runtime, peers: &mut UnboundedReceiver<Peer>, resume: Option<&str>) -> (Session, Peer, Json) {
	let (session, (peer, params)) = tokio::join!(runtime.open(spec(resume)), async {
		let mut peer = peers.recv().await.unwrap();
		let init = peer.answer("initialize", json!({ "userAgent": "godspeed/0.169.0", "codexHome": "/h", "platformFamily": "unix", "platformOs": "macos" })).await;
		assert_eq!(init["capabilities"], json!({ "experimentalApi": true, "requestAttestation": false }));
		assert_eq!(peer.recv().await, json!({ "method": "initialized" }));
		let method = if resume.is_some() { "thread/resume" } else { "thread/start" };
		let params = peer.answer(method, json!({ "thread": { "id": resume.unwrap_or("thr_1") }, "model": "gpt-6-luna" })).await;
		(peer, params)
	});
	(session.unwrap(), peer, params)
}

/// Starts a turn and answers `turn/start`; gives its params.
async fn send(session: &Session, peer: &mut Peer, turn: &str) -> Json {
	let input = [Part::Text("Explain what a derivative is.".into())];
	let (sent, params) = tokio::join!(session.send(&input), peer.answer("turn/start", json!({ "turn": { "id": turn, "items": [], "status": "inProgress", "error": null } })));
	sent.unwrap();
	params
}

fn note(method: &str, params: Json) -> Json {
	json!({ "method": method, "params": params })
}

#[tokio::test]
async fn a_thread_starts_with_godspeeds_tools_and_without_what_codex_adds_by_default() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (session, mut peer, params) = open(&runtime, &mut peers, None).await;
	assert_eq!(session.native_id(), "thr_1");
	assert_eq!(
		params,
		json!({
			"cwd": "/work",
			"model": "claude-sonnet-5-5",
			"sandbox": "workspace-write",
			"approvalPolicy": "on-request",
			"developerInstructions": "You are a tutor inside godspeed.",
			"config": { "features.apps": false, "agents.enabled": false, "skills.include_instructions": false, "project_doc_max_bytes": 0 },
			"dynamicTools": [{ "type": "function", "name": "quiz", "description": "Show the learner one quiz question.", "inputSchema": { "type": "object", "properties": { "question": { "type": "string" } }, "required": ["question"] } }],
			"ephemeral": false,
		})
	);
	let turn = send(&session, &mut peer, "turn_1").await;
	assert_eq!(turn, json!({ "threadId": "thr_1", "input": [{ "type": "text", "text": "Explain what a derivative is.", "text_elements": [] }] }));
}

#[tokio::test]
async fn a_recorded_lesson_turn_streams_its_reply_around_a_tool() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (session, mut peer, _) = open(&runtime, &mut peers, None).await;
	send(&session, &mut peer, "turn_1").await;
	let (mut seen, answers) = replay(&mut peer, &session, &fixture("codex-lesson.jsonl"), &text_reply("unused")).await;
	seen.extend(seen_until_end(&session).await);
	assert!(answers.is_empty());
	let first = "I’ll check the learner’s study spaces first, then tailor a brief beginner explanation.";
	let second = "A derivative tells you how quickly something is changing at a particular moment. Imagine a car’s position changing over time: its derivative is the car’s speed right then. On a graph, it’s the slope of the curve at one point. If a curve is steep there, what does that tell you about how quickly the value is changing?";
	assert_eq!(
		seen,
		[
			Seen::Started,
			Seen::Delta("I’ll check the learner’s study spaces first, ".into()),
			Seen::Delta("then tailor a brief beginner explanation.".into()),
			Seen::Done(first.into()),
			Seen::Own("mcpToolCall".into(), false),
			Seen::Own("mcpToolCall".into(), true),
			Seen::Usage(Usage { input: 39273, cached: 39040, output: 72 }),
			Seen::Delta("A derivative tells you how quickly something is changing at a particular moment. ".into()),
			Seen::Delta("Imagine a car’s position changing over time: its derivative is the car’s speed right then. ".into()),
			Seen::Delta("On a graph, it’s the slope of the curve at one point. If a curve is steep there, what does that tell you about how quickly the value is changing?".into()),
			Seen::Done(second.into()),
			Seen::Ended(End::Completed),
		]
	);
}

#[tokio::test]
async fn a_recorded_command_waits_for_the_learner_to_allow_it() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (session, mut peer, _) = open(&runtime, &mut peers, None).await;
	send(&session, &mut peer, "turn_2").await;
	let (mut seen, answers) = replay(&mut peer, &session, &fixture("codex-approval.jsonl"), &text_reply("unused")).await;
	seen.extend(seen_until_end(&session).await);
	assert_eq!(answers, [json!({ "id": 0, "result": { "decision": "accept" } })]);
	let command = "/bin/zsh -lc \"printf 'hello' > approval-test.txt\"";
	assert_eq!(
		seen,
		[
			Seen::Started,
			Seen::Delta("I’ll create the file in the current folder with the requested single word.".into()),
			Seen::Done("I’ll create the file in the current folder with the requested single word.".into()),
			Seen::Own("commandExecution".into(), false),
			Seen::Asked(Ask::Command { command: command.into(), cwd: "/work".into(), reason: None }),
			Seen::Own("commandExecution".into(), true),
			Seen::Delta("Done. Created `approval-test.txt` with the single word `hello`.".into()),
			Seen::Done("Done. Created `approval-test.txt` with the single word `hello`.".into()),
			Seen::Usage(Usage { input: 39836, cached: 39552, output: 19 }),
			Seen::Ended(End::Completed),
		]
	);
}

#[tokio::test]
async fn stop_interrupts_the_running_turn() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (session, mut peer, _) = open(&runtime, &mut peers, None).await;
	send(&session, &mut peer, "turn_3").await;
	replay(&mut peer, &session, &fixture("codex-interrupt.jsonl"), &text_reply("unused")).await;
	let (stopped, params) = tokio::join!(session.interrupt(), peer.answer("turn/interrupt", json!({})));
	stopped.unwrap();
	assert_eq!(params, json!({ "threadId": "thr_1", "turnId": "turn_3" }));
	peer.send(&note("turn/completed", json!({ "threadId": "thr_1", "turn": { "id": "turn_3", "items": [], "status": "interrupted", "error": null } }))).await;
	assert_eq!(
		seen_until_end(&session).await,
		[
			Seen::Started,
			Seen::Delta("# The History of Calculus: From Archimedes to Cauchy\n\n".into()),
			Seen::Delta("Calculus is the mathematics of change and accumulation.".into()),
			Seen::Ended(End::Interrupted),
		]
	);
}

#[tokio::test]
async fn a_question_tool_ends_the_turn_only_once_codex_has_recorded_it() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (session, mut peer, _) = open(&runtime, &mut peers, None).await;
	send(&session, &mut peer, "turn_4").await;
	peer.send(&note("turn/started", json!({ "threadId": "thr_1", "turn": { "id": "turn_4", "items": [], "status": "inProgress", "error": null } }))).await;
	let call = |id: &str, call: &str, tool: &str, args: Json| json!({ "id": id, "method": "item/tool/call", "params": { "threadId": "thr_1", "turnId": "turn_4", "callId": call, "namespace": null, "tool": tool, "arguments": args } });
	let completed = |call: &str, tool: &str| note("item/completed", json!({ "threadId": "thr_1", "turnId": "turn_4", "completedAtMs": 0, "item": { "type": "dynamicToolCall", "id": call, "namespace": null, "tool": tool, "arguments": {}, "status": "completed", "contentItems": null, "success": true, "durationMs": 1 } }));

	// A picture goes back as an image item.
	peer.send(&call("r1", "call_1", "show_page", json!({}))).await;
	assert!(matches!(next(&session).await, crate::event::SessionEvent::TurnStarted));
	let crate::event::SessionEvent::ToolCall { call: asked, reply } = next(&session).await else { panic!("no tool call") };
	assert_eq!(asked, ToolCall { id: "call_1".into(), name: "show_page".into(), args: json!({}) });
	reply.send(ToolReply { content: vec![Part::Image { mime: "image/png".into(), base64: "iVBORw0KGgo=".into() }], is_error: false, ends_turn: false }).unwrap();
	assert_eq!(peer.recv().await, json!({ "id": "r1", "result": { "contentItems": [{ "type": "inputImage", "imageUrl": "data:image/png;base64,iVBORw0KGgo=" }], "success": true } }));
	peer.send(&completed("call_1", "show_page")).await;
	assert!(peer.quiet(150).await, "a tool that does not end the turn leaves it running");

	peer.send(&call("r2", "call_2", "quiz", json!({ "question": "What is the derivative of x²?" }))).await;
	let crate::event::SessionEvent::ToolCall { reply, .. } = next(&session).await else { panic!("no tool call") };
	reply.send(ToolReply { content: vec![Part::Text("Shown to the learner.".into())], is_error: false, ends_turn: true }).unwrap();
	assert_eq!(peer.recv().await, json!({ "id": "r2", "result": { "contentItems": [{ "type": "inputText", "text": "Shown to the learner." }], "success": true } }));
	assert!(peer.quiet(150).await, "an interrupt before Codex records the call would cancel it");
	peer.send(&completed("call_2", "quiz")).await;
	assert_eq!(peer.answer("turn/interrupt", json!({})).await, json!({ "threadId": "thr_1", "turnId": "turn_4" }));
	// What Codex writes before the interrupt lands is not part of the reply.
	peer.send(&note("item/agentMessage/delta", json!({ "threadId": "thr_1", "turnId": "turn_4", "itemId": "item_x", "delta": "Take your time!" }))).await;
	peer.send(&note("turn/completed", json!({ "threadId": "thr_1", "turn": { "id": "turn_4", "items": [], "status": "interrupted", "error": null } }))).await;
	assert_eq!(seen_until_end(&session).await, [Seen::Ended(End::Completed)]);
}

#[tokio::test]
async fn a_resumed_thread_takes_a_new_model_and_a_steer() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (session, mut peer, params) = open(&runtime, &mut peers, Some("thr_old")).await;
	assert_eq!(session.native_id(), "thr_old");
	assert_eq!(params["threadId"], json!("thr_old"));
	assert_eq!(params["excludeTurns"], json!(true));
	assert!(params["dynamicTools"].is_null(), "a thread keeps its tools");
	assert_eq!(params["developerInstructions"], json!("You are a tutor inside godspeed."));

	session.set_model("gpt-6").unwrap();
	assert_eq!(send(&session, &mut peer, "turn_5").await["model"], json!("gpt-6"));
	let steer = [Part::Text("Use an example.".into())];
	let (steered, params) = tokio::join!(session.steer(&steer), peer.answer("turn/steer", json!({ "turnId": "turn_5" })));
	steered.unwrap();
	assert_eq!(params, json!({ "threadId": "thr_old", "input": [{ "type": "text", "text": "Use an example.", "text_elements": [] }], "expectedTurnId": "turn_5" }));
	peer.send(&note("turn/completed", json!({ "threadId": "thr_old", "turn": { "id": "turn_5", "status": "failed", "error": { "message": "usage limit reached" } } }))).await;
	assert_eq!(seen_until_end(&session).await, [Seen::Ended(End::Failed("usage limit reached".into()))]);
	assert!(send(&session, &mut peer, "turn_6").await["model"].is_null(), "the model went with the turn it was picked for");

	peer.send(&json!({ "id": 9, "method": "attestation/generate", "params": {} })).await;
	assert_eq!(peer.recv().await["error"]["code"], json!(-32601));
}

#[tokio::test]
async fn when_app_server_stops_its_sessions_end_and_the_next_open_starts_it_again() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (session, peer, _) = open(&runtime, &mut peers, None).await;
	drop(peer);
	let crate::event::SessionEvent::Ended(End::Failed(why)) = next(&session).await else { panic!("no end") };
	assert!(why.starts_with("Codex stopped: it closed its output"), "{why}");
	assert!(session.next().await.is_none());
	assert_eq!(session.send(&[Part::Text("hi".into())]).await, Err("Codex stopped; open the session again".into()));
	let (again, _, _) = open(&runtime, &mut peers, Some("thr_1")).await;
	assert_eq!(again.native_id(), "thr_1");
}

#[cfg(unix)]
#[tokio::test]
async fn app_server_runs_through_the_learners_own_command_in_godspeeds_codex_folder() {
	let dir = std::env::temp_dir().join(format!("gs-runtime-codex-launcher-{}", std::process::id()));
	std::fs::create_dir_all(&dir).unwrap();
	let seen = dir.join("seen");
	let home = dir.join("codex-home");
	// A stand-in for the learner's launcher: it notes its arguments and Codex's folder, then
	// answers the handshake and `thread/start` in turn.
	let launcher = dir.join("launcher.sh");
	let answers = [r#"{"id":1,"result":{}}"#, "", r#"{"id":2,"result":{"thread":{"id":"thr_9"}}}"#];
	let replies = answers.iter().map(|answer| if answer.is_empty() { "read -r _\n".to_owned() } else { format!("read -r _; echo '{answer}'\n") }).collect::<String>();
	gs_base::fsx::write_text_atomic(&launcher, &format!("printf '%s\\n' \"$@\" \"$CODEX_HOME\" > '{}'\n{replies}cat > /dev/null\n", seen.display())).unwrap();
	let env = std::sync::Arc::new(crate::process::AgentEnv::fixed(vec![("PATH".into(), "/usr/bin:/bin".into()), ("CODEX_HOME".into(), "/the/learners/own".into())]));
	let runtime = Runtime::codex(env, home.clone(), Some(format!("sh '{}' launch codex --", launcher.display())));
	let session = runtime.open(spec(None)).await.unwrap();
	assert_eq!(session.native_id(), "thr_9");
	let memories_off = "--disable\nmemories\n-c\nmemories.generate_memories=false\n-c\nmemories.use_memories=false";
	assert_eq!(std::fs::read_to_string(&seen).unwrap(), format!("launch\ncodex\n--\napp-server\n{memories_off}\n{}\n", home.display()), "Codex's own memories are off");
	assert!(home.is_dir(), "godspeed's Codex folder is made before Codex starts");
	std::fs::remove_dir_all(&dir).unwrap();
}

#[tokio::test]
async fn a_sign_in_gives_its_page_and_says_how_it_ended() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (login, mut peer) = tokio::join!(runtime.login(), async {
		let mut peer = peers.recv().await.unwrap();
		peer.answer("initialize", json!({})).await;
		peer.recv().await;
		let start = peer.answer("account/login/start", json!({ "type": "chatgpt", "loginId": "l1", "authUrl": "https://auth.openai.com/oauth/authorize?state=s" })).await;
		assert_eq!(start, json!({ "type": "chatgpt" }));
		peer
	});
	let login = login.unwrap();
	assert_eq!((login.url.as_str(), login.takes_code), ("https://auth.openai.com/oauth/authorize?state=s", false));
	assert_eq!(login.control.send_code("123").await, Err("Codex's sign-in takes no code".into()));
	let (cancelled, ()) = tokio::join!(login.control.cancel(), async {
		assert_eq!(peer.answer("account/login/cancel", json!({ "status": "canceled" })).await, json!({ "loginId": "l1" }));
		// What Codex sends then, as recorded on the real CLI.
		peer.send(&note("account/login/completed", json!({ "loginId": "l1", "success": false, "error": "Login server error: Login was not completed", "onboardingEntrypoint": null }))).await;
	});
	cancelled.unwrap();
	assert_eq!(login.ended.await.unwrap(), Err("Login server error: Login was not completed".into()));
}

#[tokio::test]
async fn a_finished_sign_in_ends_well() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let (login, mut peer) = tokio::join!(runtime.login(), async {
		let mut peer = peers.recv().await.unwrap();
		peer.answer("initialize", json!({})).await;
		peer.recv().await;
		peer.answer("account/login/start", json!({ "type": "chatgpt", "loginId": "l2", "authUrl": "https://auth.openai.com/oauth/authorize?state=t" })).await;
		peer
	});
	let login = login.unwrap();
	peer.send(&note("account/login/completed", json!({ "loginId": "l2", "success": true, "error": null }))).await;
	assert_eq!(login.ended.await.unwrap(), Ok(()));
}

#[tokio::test]
async fn the_models_are_listed_page_by_page() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let model = |id: &str, default: bool| json!({ "id": id, "model": id, "displayName": id.to_uppercase(), "description": "", "hidden": false, "isDefault": default });
	let (models, ()) = tokio::join!(runtime.models(), async {
		let mut peer = peers.recv().await.unwrap();
		peer.answer("initialize", json!({})).await;
		peer.recv().await;
		assert_eq!(peer.answer("model/list", json!({ "data": [model("gpt-6.1-sol", true)], "nextCursor": "p2" })).await, json!({ "cursor": null }));
		assert_eq!(peer.answer("model/list", json!({ "data": [model("gpt-6-luna", false)], "nextCursor": null })).await, json!({ "cursor": "p2" }));
	});
	let ids: Vec<(String, bool)> = models.unwrap().into_iter().map(|model| (model.id, model.default)).collect();
	assert_eq!(ids, [("gpt-6.1-sol".to_owned(), true), ("gpt-6-luna".to_owned(), false)]);
}

#[tokio::test]
async fn a_refused_sign_in_in_a_turn_and_a_session_that_cannot_open_are_told() {
	let (runtime, mut peers) = runtime(FolderAgent::Codex);
	let told = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
	let count = told.clone();
	runtime.on_trouble(move || {
		count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
	});
	let (session, mut peer, _) = open(&runtime, &mut peers, None).await;
	send(&session, &mut peer, "turn_1").await;
	let error = json!({ "message": "unexpected status 401 Unauthorized", "codexErrorInfo": "unauthorized", "additionalDetails": null });
	peer.send(&note("turn/completed", json!({ "threadId": "thr_1", "turn": { "id": "turn_1", "items": [], "status": "failed", "error": error } }))).await;
	let (_, end) = crate::test_peer::events_until_end(&session).await;
	assert_eq!(end, End::Failed("unexpected status 401 Unauthorized".into()));
	assert_eq!(told.load(std::sync::atomic::Ordering::SeqCst), 1);
	let (opened, ()) = tokio::join!(runtime.open(spec(None)), async {
		let request = peer.recv().await;
		assert_eq!(request["method"].as_str(), Some("thread/start"));
		peer.send(&json!({ "id": request["id"], "error": { "code": -32000, "message": "not signed in" } })).await;
	});
	assert!(opened.is_err());
	assert_eq!(told.load(std::sync::atomic::Ordering::SeqCst), 2);
}
