//! The Claude adapter against recorded helper lines, over in-memory pipes.

use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::json;
use tokio::sync::mpsc::UnboundedReceiver;

use crate::event::{Ask, End, Part, SessionEvent, ToolCall, ToolReply, Usage};
use crate::session::{Runtime, Session};
use crate::test_peer::{Peer, Seen, fixture, next, replay, runtime, seen_until_end, spec, text_reply};

/// Opens a session: the helper is asked to open it and answers with Claude Code's session id.
async fn open(runtime: &Runtime, peer: &mut Option<Peer>, peers: &mut UnboundedReceiver<Peer>, resume: Option<&str>) -> Session {
	let (session, ()) = tokio::join!(runtime.open(spec(resume)), async {
		if peer.is_none() {
			*peer = peers.recv().await;
		}
		let peer = peer.as_mut().unwrap();
		let open = peer.recv().await;
		let session = open["session"].clone();
		let native = resume.unwrap_or("sess-1");
		peer.send(&json!({ "type": "opened", "session": session, "nativeId": native })).await;
	});
	session.unwrap()
}

async fn send(session: &Session, peer: &mut Peer) {
	session.send(&[Part::Text("Explain what a derivative is.".into())]).await.unwrap();
	assert_eq!(peer.recv().await, json!({ "type": "send", "session": "s1", "content": [{ "type": "text", "text": "Explain what a derivative is." }], "steer": false }));
}

#[tokio::test]
async fn a_session_opens_with_godspeeds_tools_on_the_learners_own_claude() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let (session, mut peer) = tokio::join!(runtime.open(spec(None)), async {
		let mut peer = peers.recv().await.unwrap();
		let open = peer.recv().await;
		assert_eq!(
			open,
			json!({
				"type": "open",
				"session": "s1",
				"cwd": "/work",
				"model": "claude-sonnet-5-5",
				"resume": null,
				"persist": true,
				"systemPrompt": "You are a tutor inside godspeed.",
				"tools": [{ "name": "quiz", "description": "Show the learner one quiz question.", "inputSchema": { "type": "object", "properties": { "question": { "type": "string" } }, "required": ["question"] } }],
				"claudePath": "claude",
			})
		);
		peer.send(&json!({ "type": "opened", "session": "s1", "nativeId": "sess-1" })).await;
		peer
	});
	let session = session.unwrap();
	assert_eq!(session.native_id(), "sess-1");
	session.set_model("claude-opus-5-5").unwrap();
	assert_eq!(peer.recv().await, json!({ "type": "model", "session": "s1", "model": "claude-opus-5-5" }));
	session.steer(&[Part::Image { mime: "image/png".into(), base64: "iVBO".into() }]).await.unwrap();
	assert_eq!(peer.recv().await, json!({ "type": "send", "session": "s1", "content": [{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "iVBO" } }], "steer": true }));
	drop(session);
	assert_eq!(peer.recv().await, json!({ "type": "close", "session": "s1" }), "a dropped session closes its query");
}

#[tokio::test]
async fn a_recorded_lesson_turn_answers_godspeeds_tool_and_streams_the_reply() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let mut peer = None;
	let session = open(&runtime, &mut peer, &mut peers, None).await;
	let peer = peer.as_mut().unwrap();
	send(&session, peer).await;
	let spaces = "{\"spaces\":[],\"noSpaceLessons\":0}";
	let (mut seen, answers) = replay(peer, &session, &fixture("claude-lesson.jsonl"), &text_reply(spaces)).await;
	seen.extend(seen_until_end(&session).await);
	assert_eq!(answers, [json!({ "type": "tool_result", "id": "1", "content": [{ "type": "text", "text": spaces }], "isError": false, "endTurn": false })]);
	let reply = "A derivative measures how fast something is changing at one exact moment. Think of a car's speedometer: your position changes over time, and the speedometer shows the rate of that change right now. On a graph, the derivative is the slope of the curve at a single point, meaning how steep the line is there.";
	assert_eq!(
		seen,
		[
			Seen::Started,
			Seen::Usage(Usage { input: 23616, cached: 0, output: 37 }),
			Seen::Tool(ToolCall { id: "toolu_1".into(), name: "list_spaces".into(), args: json!({}) }),
			Seen::Delta("A derivative measures how fast something is changing at one exact moment. ".into()),
			Seen::Delta("Think of a car's speedometer: your position changes over time, and the speedometer shows the rate of that change right now. ".into()),
			Seen::Delta("On a graph, the derivative is the slope of the curve at a single point, meaning how steep the line is there.".into()),
			Seen::Done(reply.into()),
			Seen::Usage(Usage { input: 23678, cached: 23614, output: 169 }),
			Seen::Ended(End::Completed),
		]
	);
}

#[tokio::test]
async fn a_recorded_bash_call_waits_for_the_learner_to_allow_it() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let mut peer = None;
	let session = open(&runtime, &mut peer, &mut peers, None).await;
	let peer = peer.as_mut().unwrap();
	send(&session, peer).await;
	let (mut seen, answers) = replay(peer, &session, &fixture("claude-approval.jsonl"), &text_reply("unused")).await;
	seen.extend(seen_until_end(&session).await);
	assert_eq!(answers, [json!({ "type": "approval", "id": "2", "allow": true, "message": null })]);
	let input = json!({ "command": "echo hello > approval-test.txt", "description": "Create approval-test.txt containing hello" });
	assert_eq!(
		seen,
		[
			Seen::Started,
			Seen::Own("Bash".into(), false),
			Seen::Usage(Usage { input: 23887, cached: 23676, output: 91 }),
			Seen::Asked(Ask::Tool { name: "Bash".into(), input }),
			Seen::Own("Bash".into(), true),
			Seen::Delta("Done.".into()),
			Seen::Done("Done.".into()),
			Seen::Usage(Usage { input: 23993, cached: 23883, output: 5 }),
			Seen::Ended(End::Completed),
		]
	);
}

#[tokio::test]
async fn stop_interrupts_the_running_turn_and_a_refusal_says_why() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let mut peer = None;
	let session = open(&runtime, &mut peer, &mut peers, None).await;
	let peer = peer.as_mut().unwrap();
	send(&session, peer).await;
	replay(peer, &session, &fixture("claude-interrupt.jsonl"), &text_reply("unused")).await;
	session.interrupt().await.unwrap();
	assert_eq!(peer.recv().await, json!({ "type": "interrupt", "session": "s1" }));
	peer.send(&json!({ "type": "sdk", "session": "s1", "message": { "type": "result", "subtype": "error_during_execution", "is_error": true, "num_turns": 2, "errors": [], "parent_tool_use_id": null } })).await;
	assert_eq!(
		seen_until_end(&session).await,
		[
			Seen::Started,
			Seen::Delta("# The History of Calculus: From Archimedes to Cauchy\n\n## Introduction\n\n".into()),
			Seen::Delta("Calculus is often presented as a finished machine.".into()),
			Seen::Ended(End::Interrupted),
		]
	);

	// A refusal the learner gives no words for still tells Claude Code why.
	send(&session, peer).await;
	peer.send(&json!({ "type": "approval", "id": "7", "session": "s1", "tool": "Write", "input": { "file_path": "/work/a.txt" }, "toolUseId": "toolu_7" })).await;
	let SessionEvent::Approval { reply, .. } = next(&session).await else { panic!("no approval") };
	reply.send(crate::event::Verdict { allow: false, message: None }).unwrap();
	assert_eq!(peer.recv().await, json!({ "type": "approval", "id": "7", "allow": false, "message": "The learner did not allow this." }));
}

#[tokio::test]
async fn a_question_tool_ends_the_turn_right_after_its_result() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let mut peer = None;
	let session = open(&runtime, &mut peer, &mut peers, None).await;
	let peer = peer.as_mut().unwrap();
	send(&session, peer).await;
	peer.send(&json!({ "type": "tool_call", "id": "3", "session": "s1", "toolUseId": "toolu_3", "name": "quiz", "args": { "question": "What is the derivative of x²?" } })).await;
	let SessionEvent::ToolCall { call, reply } = next(&session).await else { panic!("no tool call") };
	assert_eq!(call, ToolCall { id: "toolu_3".into(), name: "quiz".into(), args: json!({ "question": "What is the derivative of x²?" }) });
	reply.send(ToolReply { content: vec![Part::Text("Shown to the learner.".into()), Part::Image { mime: "image/png".into(), base64: "iVBO".into() }], is_error: false, ends_turn: true }).unwrap();
	assert_eq!(
		peer.recv().await,
		json!({ "type": "tool_result", "id": "3", "content": [{ "type": "text", "text": "Shown to the learner." }, { "type": "image", "data": "iVBO", "mimeType": "image/png" }], "isError": false, "endTurn": true })
	);
	// The helper's PostToolUse hook stops Claude Code; the SDK reports a finished turn.
	peer.send(&json!({ "type": "sdk", "session": "s1", "message": { "type": "result", "subtype": "success", "is_error": false, "num_turns": 2, "stop_reason": "tool_use", "result": "", "parent_tool_use_id": null } })).await;
	assert_eq!(seen_until_end(&session).await, [Seen::Started, Seen::Ended(End::Completed)]);
}

#[tokio::test]
async fn a_failed_open_and_a_claude_code_that_stops_mid_turn_are_reported() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let (failed, mut peer) = tokio::join!(runtime.open(spec(Some("gone"))), async {
		let mut peer = peers.recv().await.unwrap();
		let open = peer.recv().await;
		assert_eq!(open["resume"], json!("gone"));
		peer.send(&json!({ "type": "error", "session": "s1", "message": "No conversation found with session ID: gone" })).await;
		peer
	});
	assert_eq!(failed.err(), Some("No conversation found with session ID: gone".into()));

	let mut held = Some(peer);
	let session = open(&runtime, &mut held, &mut peers, None).await;
	peer = held.unwrap();
	session.send(&[Part::Text("hi".into())]).await.unwrap();
	peer.recv().await;
	peer.send(&json!({ "type": "sdk", "session": "s2", "message": { "type": "system", "subtype": "init", "parent_tool_use_id": null } })).await;
	peer.send(&json!({ "type": "closed", "session": "s2" })).await;
	assert_eq!(seen_until_end(&session).await, [Seen::Started, Seen::Ended(End::Failed("Claude Code stopped".into()))]);
	assert!(session.send(&[Part::Text("again".into())]).await.is_err(), "its query is gone");
}

#[tokio::test]
async fn when_the_helper_stops_its_sessions_end_and_the_next_open_starts_it_again() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let mut peer = None;
	let session = open(&runtime, &mut peer, &mut peers, None).await;
	drop(peer);
	let SessionEvent::Ended(End::Failed(why)) = next(&session).await else { panic!("no end") };
	assert!(why.starts_with("the Claude helper stopped: it closed its output"), "{why}");
	assert!(session.next().await.is_none());
	assert_eq!(session.send(&[Part::Text("hi".into())]).await, Err("Claude Code stopped; open the session again".into()));
	let mut peer = None;
	let again = open(&runtime, &mut peer, &mut peers, Some("sess-1")).await;
	assert_eq!(again.native_id(), "sess-1");
}

#[tokio::test]
async fn a_steer_after_the_last_step_runs_as_the_next_turn() {
	let (runtime, mut peers) = runtime(FolderAgent::Claude);
	let mut peer = None;
	let session = open(&runtime, &mut peer, &mut peers, None).await;
	let peer = peer.as_mut().unwrap();
	send(&session, peer).await;
	let sdk = |message: gs_json::Json| json!({ "type": "sdk", "session": "s1", "message": message });
	let words = |text: &str| sdk(json!({ "type": "stream_event", "event": { "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": text } }, "parent_tool_use_id": null }));
	let result = sdk(json!({ "type": "result", "subtype": "success", "is_error": false, "num_turns": 1, "parent_tool_use_id": null }));
	peer.send(&words("one, two, three")).await;
	session.steer(&[Part::Text("Stop the list and write DONE.".into())]).await.unwrap();
	assert_eq!(peer.recv().await["steer"], json!(true));
	peer.send(&result).await;
	assert_eq!(seen_until_end(&session).await, [Seen::Started, Seen::Delta("one, two, three".into()), Seen::Ended(End::Completed)]);
	// What Claude Code sends when it then runs the steer by itself, as recorded on the real CLI.
	peer.send(&sdk(json!({ "type": "system", "subtype": "status", "status": null }))).await;
	peer.send(&words("DONE")).await;
	peer.send(&result).await;
	assert_eq!(seen_until_end(&session).await, [Seen::Started, Seen::Delta("DONE".into()), Seen::Ended(End::Completed)]);
}
