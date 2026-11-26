//! Lessons on a stand-in agent (gs-runtime's FakeAgent): whole turns through the chat handler, the
//! record they leave, the agent session the lesson keeps, and what the agent was sent.

use std::sync::Arc;

use gs_base::{base64, clock};
use gs_core::messages::attachments::{ChatAttachment, pdf_note_of};
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_core::messages::native_messages::new_user_steer;
use gs_core::messages::role::Role;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_core::spaces::file_state::FileKind;
use gs_core::spaces::today_note::local_day;
use gs_core::study::reply_nudges::{LAST_REPLY_LEAD, Nudge, curve_refusal};
use gs_json::{Json, json};
use gs_engine::turn::events::AgentEvent;
use gs_runtime::Runtime;
use gs_runtime::fake::{FakeAgent, FakeStep};
use parking_lot::Mutex;

use super::chat_handler::handle_chat_input;
use super::stand_in::{Lesson, bash, lesson, lesson_in, lesson_on, text, tool};
use super::turn_liveness::is_turn_running;
use super::turn_runs::{abort_turn, answer_approval, running_turn};
use super::turn_work::lesson_work;
use crate::App;
use crate::app::agent_folder::{agent_folder, folder_agent, set_agent_models};
use crate::app::test_support::scratch_dir;
use crate::jobs::steer_live_chat;
use crate::spaces::{add_file_from_path, write_agent_file};

const CURVE: &str = "| lambda | error |\n|---|---|\n| 0.1 | 9 |\n| 1 | 4 |\n| 10 | 6 |";
const QUESTIONS: &str = "1. What is the score?\n2. Which lambda wins?";

#[tokio::test(flavor = "multi_thread")]
async fn a_question_ends_the_turn_and_the_next_turn_goes_on_with_what_is_new() {
	let ask = tool("ask_user_question", json!({ "question": "Which part of sets?" }));
	let fx = lesson("session-question", None, vec![vec![text("One check first."), ask, text("never played")], vec![text("Unions, then.")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	assert_eq!(fx.replies(), ["One check first."], "the question ended the turn");
	let calls: Vec<Json> = fx.messages().iter().filter(|m| Role::Assistant.is(m)).flat_map(|m| m["content"].items().iter().filter(|b| b["type"].as_str() == Some("toolCall")).cloned().collect::<Vec<_>>()).collect();
	assert_eq!(calls[0]["name"].as_str(), Some("ask_user_question"));
	let stored = fx.record()["agentSession"].clone();
	assert_eq!((stored["agent"].as_str(), stored["seen"].as_str()), (Some("claude"), fx.messages().last().unwrap()["id"].as_str()));

	fx.say("why?").await;
	fx.settled().await;
	assert_eq!(fx.sent("open").len(), 1, "the lesson's open session goes on");
	let sends = fx.sends();
	assert!(sends[0].contains("Teach me sets"));
	assert!(sends[1].contains("why?") && !sends[1].contains("Teach me sets"), "only what is new: {}", sends[1]);
	assert!(sends[1].ends_with("One idea per reply, at most four short lines, then his move. A worked example: one short line per step."), "his rules come last: {}", sends[1]);
	assert_eq!(fx.replies(), ["One check first.", "Unions, then."]);
}

/// A figure the teacher draws is stored with its svg, which the lesson shows, its render goes back
/// to the lesson's session as an image in the tool's result, and it ends the turn.
#[tokio::test(flavor = "multi_thread")]
async fn a_drawn_figure_is_stored_with_its_svg_its_render_goes_back_as_an_image_and_it_ends_the_turn() {
	let svg = r#"<svg viewBox="0 0 100 40"><line x1="10" y1="20" x2="90" y2="20" stroke="var(--ink)" stroke-width="2"/></svg>"#;
	let fx = lesson("session-figure", Some("study"), vec![vec![text("Here it is."), tool("visual", json!({ "svg": svg })), text("never played")]]);
	fx.say("Draw the number line").await;
	fx.settled().await;
	assert_eq!(fx.replies(), ["Here it is."], "the figure ended the turn");
	let result = fx.messages().into_iter().find(|m| Role::ToolResult.is(m) && m["toolName"].as_str() == Some("visual")).expect("the figure's result is stored");
	assert_eq!(result["isError"], json!(false), "{result:?}");
	assert!(result["details"]["svg"].str_or_empty().starts_with("<svg"), "{result:?}");
	let reply = fx.sent("tool_result").pop().expect("the figure's result went back to the agent");
	let image = &reply["content"][1];
	assert_eq!((image["type"].as_str(), image["mimeType"].as_str(), reply["endTurn"].as_bool()), (Some("image"), Some("image/png"), Some(true)), "{reply:?}");
	assert!(!image["data"].str_or_empty().is_empty());
}

const FIGURE: &str = r#"<svg viewBox="0 0 100 40"><line x1="10" y1="20" x2="90" y2="20" stroke="var(--ink)" stroke-width="2"/></svg>"#;

/// The last assistant message's stop reason: "stop" for a turn that ended by itself.
fn last_stop(fx: &Lesson) -> Option<String> {
	fx.messages().iter().rev().find(|m| Role::Assistant.is(m)).and_then(|m| m["stopReason"].as_str().map(str::to_owned))
}

/// A figure drawn before the reply has any words does not end the turn: the teacher gets its
/// render back at once and goes on to write the words, and the turn ends by itself.
#[tokio::test(flavor = "multi_thread")]
async fn a_figure_drawn_before_any_words_lets_the_turn_go_on_to_write_them() {
	let fx = lesson("session-figure-first", Some("study"), vec![vec![tool("visual", json!({ "svg": FIGURE })), text("Look at the line.")]]);
	fx.say("Draw the number line").await;
	fx.settled().await;
	assert_eq!(fx.replies(), ["Look at the line."], "the words came after the figure");
	let reply = fx.sent("tool_result").pop().expect("the figure's result went back to the agent");
	assert_eq!(reply["endTurn"].as_bool(), Some(false), "{reply:?}");
	assert_eq!(last_stop(&fx).as_deref(), Some("stop"), "the turn ended by itself");
}

/// Once the turn has words, a second figure ends it, as one drawn after the words always does.
#[tokio::test(flavor = "multi_thread")]
async fn a_figure_drawn_after_the_words_ends_the_turn_even_when_one_came_before_them() {
	let draw = || tool("visual", json!({ "svg": FIGURE }));
	let fx = lesson("session-figure-twice", Some("study"), vec![vec![draw(), text("Here is the line."), draw(), text("never played")]]);
	fx.say("Draw the number line").await;
	fx.settled().await;
	assert_eq!(fx.replies(), ["Here is the line."], "the second figure ended the turn");
	let ends: Vec<Option<bool>> = fx.sent("tool_result").iter().map(|r| r["endTurn"].as_bool()).collect();
	assert_eq!(ends, [Some(false), Some(true)]);
}

/// Over Codex too, a figure drawn before any words lets the turn go on to write them.
#[tokio::test(flavor = "multi_thread")]
async fn over_codex_a_figure_drawn_before_any_words_lets_the_turn_go_on() {
	let fx = lesson_on("session-figure-codex", Some("study"), vec![vec![tool("visual", json!({ "svg": FIGURE })), text("Look at the line.")]], FakeAgent::codex_runtime);
	fx.say("Draw the number line").await;
	fx.settled().await;
	assert_eq!(fx.replies(), ["Look at the line."]);
	assert_eq!(last_stop(&fx).as_deref(), Some("stop"), "the turn ended by itself, not by an interrupt");
}

/// A homework lesson's turns end with the time now and the time due on the day it is due, after
/// his rules when the session goes on, and never on another day.
#[tokio::test(flavor = "multi_thread")]
async fn a_homework_lesson_ends_with_the_clock_only_on_the_day_it_is_due() {
	let mut fx = lesson("session-due-today", None, vec![vec![text("Problem 1 first.")], vec![text("Good.")], vec![text("Later.")]]);
	let space = fx.app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].str_or_empty().to_owned();
	let homework_due = |date: &str| {
		let deadline = fx.app.stores.spaces.add_deadline(&space, &json!({ "name": "HW 7", "kind": "homework", "date": date, "time": "23:59" })).unwrap()["id"].str_or_empty().to_owned();
		fx.app.stores.chats.create_chat("Work on HW 7", Some("homework"), Some(&space), Some(&deadline), &[]).unwrap()["id"].str_or_empty().to_owned()
	};
	let (today, another_day) = (homework_due(&local_day(clock::now_ms())), homework_due("2099-01-15"));
	let last_line = |send: &str| send.lines().last().unwrap_or_default().to_owned();
	fx.chat_id = today;
	for words in ["Start HW 7", "Done with 1"] {
		fx.say(words).await;
		fx.settled().await;
	}
	let sends = fx.sends();
	for send in &sends {
		assert!(last_line(send).starts_with("Now ") && send.ends_with("; due 11:59 PM."), "{send}");
	}
	assert!(sends[1].contains("then his move."), "the rules come before the clock: {}", sends[1]);
	fx.chat_id = another_day;
	fx.say("Start").await;
	fx.settled().await;
	assert!(!fx.sends()[2].contains("; due "), "another day: no clock: {}", fx.sends()[2]);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_allowed_permission_question_lets_the_turn_go_on() {
	let fx = lesson("session-allow", None, vec![vec![bash(), text("Listed.")]]);
	fx.say("Look at my folder").await;
	let id = fx.approval().await;
	assert_eq!(lesson_work(&fx.app, &fx.chat_id).unwrap()["approvals"][0], json!({ "id": id, "text": "Teacher wants to run this command.", "subject": { "kind": "command", "text": "ls" } }));
	assert!(answer_approval(&fx.app, &fx.chat_id, &id, true));
	assert!(!answer_approval(&fx.app, &fx.chat_id, &id, true), "answered once");
	fx.settled().await;
	assert_eq!(fx.replies(), ["Listed."]);
	assert_eq!(fx.sent("approval")[0]["allow"], json!(true));
}

/// A lesson's turn and a file's reading run at once on the picked agent, each in a session of its
/// own playing its own script: the reading is done while the lesson waits on the learner.
#[tokio::test(flavor = "multi_thread")]
async fn a_lesson_and_a_reading_run_together_each_in_a_session_of_its_own() {
	let fx = lesson("session-with-job", None, vec![vec![bash(), text("Listed.")]]);
	let reading = "You are the extraction stage of a learning app.";
	fx.agent.push_for(reading, vec![tool("submit_findings", json!({ "propositions": [], "chains": [], "reteaches": [] }))]);
	fx.say("Look at my folder").await;
	let id = fx.approval().await;

	let space = fx.app.stores.spaces.create_space(&json!({ "name": "Biology" })).unwrap()["id"].str_or_empty().to_owned();
	let file = write_agent_file(&fx.app, &space, "Study guide.md", b"Mitosis has four phases.", FileKind::Study).unwrap().0["id"].str_or_empty().to_owned();
	let status = || fx.app.stores.spaces.get_space(&space).unwrap()["files"].items().iter().find(|f| f["id"].as_str() == Some(file.as_str())).unwrap()["status"].clone();
	for _ in 0..500 {
		if status() == json!("ready") {
			break;
		}
		clock::sleep(10).await;
	}
	assert_eq!(status(), json!("ready"));
	assert!(is_turn_running(&fx.app, &fx.chat_id), "the lesson still waits on its question");

	assert!(answer_approval(&fx.app, &fx.chat_id, &id, true));
	fx.settled().await;
	assert_eq!(fx.replies(), ["Listed."]);
	let opened = fx.sent("open");
	assert_eq!(opened.len(), 2, "{opened:?}");
	assert_eq!(opened.iter().filter(|m| m["systemPrompt"].str_or_empty().starts_with(reading)).count(), 1, "one session reads, the other teaches");
}

/// The PDF reader a lesson sends out reads in a session of its own, and what it reads shows as a
/// step on the lesson's desk at its page while the lesson's turn lasts. It needs pdfium.
#[tokio::test(flavor = "multi_thread")]
async fn the_pdf_reader_s_lines_are_steps_on_the_lesson_s_desk() {
	let Some(pdfium) = gs_pdf::test_support::pdfium_dir() else { return };
	let root = scratch_dir("session-pdf-steps");
	for name in ["data", "home", "tmp"] {
		std::fs::create_dir_all(root.join(name)).unwrap();
	}
	let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), pdfium), None);
	let pdf = root.join("lines.pdf");
	std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/../pdf/tests/fixtures/lines.pdf"), &pdf).unwrap();
	let path = pdf.to_string_lossy().into_owned();
	let fx = lesson_in(app, root, None, vec![vec![tool("pdf", json!({ "path": path, "question": "What is on page 2?" })), bash(), text("Listed.")]], FakeAgent::runtime);
	fx.agent.push_for("You are a PDF reading specialist", vec![tool("pdf_extract", json!({ "pages": "2" })), text("Page 2 lists lines (p. 2).")]);
	fx.say("Read my PDF").await;
	let id = fx.approval().await;

	let step = || lesson_work(&fx.app, &fx.chat_id).unwrap()["steps"].items().iter().find(|s| s["text"].as_str() == Some("Reading page 2 of lines.pdf")).cloned();
	for _ in 0..500 {
		if step().is_some() {
			break;
		}
		clock::sleep(10).await;
	}
	let step = step().expect("the reader's line is a step on the desk");
	assert_eq!(step["reads"], json!({ "name": "lines.pdf", "path": path, "kind": "pdf", "from": null, "to": null, "page": 2 }));
	assert!(answer_approval(&fx.app, &fx.chat_id, &id, true));
	fx.settled().await;
	let opened = fx.sent("open");
	assert!(opened.iter().any(|m| m["systemPrompt"].str_or_empty().starts_with("You are a PDF reading specialist")), "the reader has a session of its own");
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_denies_the_waiting_permission_question_and_stops_the_agent() {
	let fx = lesson("session-stop", None, vec![vec![bash(), text("after")]]);
	fx.say("Look at my folder").await;
	fx.approval().await;
	assert!(abort_turn(&fx.app, &fx.chat_id));
	fx.settled().await;
	assert_eq!(fx.sent("approval")[0]["allow"], json!(false));
	for _ in 0..100 {
		if !fx.sent("interrupt").is_empty() {
			return;
		}
		clock::sleep(10).await;
	}
	panic!("the agent was never stopped");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_message_sent_during_the_turn_goes_to_claude_code_as_the_next_turn() {
	let fx = lesson("session-steer", None, vec![vec![bash(), text("first")], vec![text("second")]]);
	fx.say("Look at my folder").await;
	let id = fx.approval().await;
	assert!(steer_live_chat(&fx.app, &fx.chat_id, new_user_steer("also this", "steer_1")));
	answer_approval(&fx.app, &fx.chat_id, &id, true);
	fx.settled().await;
	assert_eq!(fx.replies(), ["first", "second"]);
	assert!(fx.sends()[1].contains("also this"));
	let steer_at = fx.messages().iter().position(|m| m["id"].as_str() == Some("steer_1")).unwrap_or_else(|| panic!("the steer is saved: {:?}", fx.messages()));
	assert_eq!(fx.messages()[steer_at + 1]["content"][0]["text"].as_str(), Some("second"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_message_sent_during_the_turn_goes_to_codex_in_the_same_turn() {
	let fx = lesson_on("session-steer-codex", None, vec![vec![bash(), text("after")]], FakeAgent::codex_runtime);
	fx.say("Look at my folder").await;
	let id = fx.approval().await;
	assert!(steer_live_chat(&fx.app, &fx.chat_id, new_user_steer("also this", "steer_1")));
	for _ in 0..500 {
		if !fx.requests("turn/steer").is_empty() {
			break;
		}
		clock::sleep(10).await;
	}
	answer_approval(&fx.app, &fx.chat_id, &id, true);
	fx.settled().await;
	let steers = fx.requests("turn/steer");
	assert_eq!(steers.len(), 1, "{:?}", fx.agent.sent());
	assert_eq!(steers[0]["params"]["input"][0]["text"].as_str(), Some("also this"));
	assert_eq!(fx.requests("turn/start").len(), 1, "the message joined the turn that was running");
	assert_eq!(fx.replies(), ["after"]);
	let steer_at = fx.messages().iter().position(|m| m["id"].as_str() == Some("steer_1")).unwrap_or_else(|| panic!("the steer is saved: {:?}", fx.messages()));
	assert_eq!(fx.messages()[steer_at + 1]["content"][0]["text"].as_str(), Some("after"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_session_the_agent_cannot_go_on_with_rolls_over_to_a_new_one() {
	let fx = lesson("session-resume", None, vec![vec![text("hello")], vec![FakeStep::Fail("No conversation found".to_owned())], vec![text("again")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	let first = fx.record()["agentSession"]["id"].str_or_empty().to_owned();
	// As after a restart: the session is no longer open, so the lesson resumes it.
	fx.app.turns.sessions.lock().clear();
	fx.say("more").await;
	fx.settled().await;
	let opens: Vec<Json> = fx.sent("open").iter().map(|o| o["resume"].clone()).collect();
	assert_eq!(opens, [Json::Null, json!(first), Json::Null]);
	assert_eq!(fx.replies(), ["hello", "again"]);
	assert!(fx.sends()[2].contains("Teach me sets"), "the new session gets the whole lesson");
	assert_ne!(fx.record()["agentSession"]["id"].as_str(), Some(first.as_str()));
}

#[tokio::test(flavor = "multi_thread")]
async fn changed_instructions_roll_over_to_a_new_session() {
	let fx = lesson("session-hash", None, vec![vec![text("hello")], vec![text("again")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	let mut stored = fx.record()["agentSession"].clone();
	stored.set("promptHash", "an older prompt");
	fx.app.stores.chats.set_agent_session(&fx.chat_id, &stored).unwrap();
	fx.say("more").await;
	fx.settled().await;
	assert_eq!(fx.sent("open")[1]["resume"], Json::Null);
	let sends = fx.sends();
	assert!(sends[1].contains("Teach me sets") && !sends[1].contains("One idea per reply"), "{}", sends[1]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_source_mark_that_points_at_nothing_is_taken_out_and_noted_for_the_next_reply() {
	let fx = lesson("session-cites", None, vec![vec![text("Sets are collections [[f_000000000000:9]].")], vec![text("ok")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	assert!(!fx.replies()[0].contains("[["), "{}", fx.replies()[0]);
	fx.say("more").await;
	fx.settled().await;
	assert!(fx.sends()[1].starts_with(&format!("{LAST_REPLY_LEAD}\nRemoved source marks that don't point at a passage of a space file: f_000000000000:9.")), "{}", fx.sends()[1]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_study_quiz_whose_question_reads_as_a_curve_is_refused_once() {
	let options: Vec<Json> = ["U-shaped", "Flat", "Rising"].iter().map(|label| json!({ "label": label, "value": label })).collect();
	let quiz = json!({ "type": "check", "nodeId": "t1", "question": CURVE, "options": options, "explanation": "It dips.", "correctAnswer": "U-shaped" });
	let fx = lesson("session-curve", Some("study"), vec![vec![tool("quiz", quiz), text("ok")]]);
	fx.say("Teach me regularization").await;
	fx.settled().await;
	let result = fx.messages().into_iter().find(|m| Role::ToolResult.is(m)).expect("the call's result is saved");
	assert_eq!((result["isError"].as_bool(), result["content"][0]["text"].as_str()), (Some(true), Some(curve_refusal().as_str())));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_study_reply_with_a_list_of_questions_is_noted_for_the_next_reply() {
	let fx = lesson("session-prose", Some("study"), vec![vec![text(QUESTIONS)], vec![text("ok")]]);
	fx.say("Teach me regularization").await;
	fx.settled().await;
	assert_eq!(fx.replies(), [QUESTIONS], "the words were shown and are kept");
	fx.say("more").await;
	fx.settled().await;
	assert!(fx.sends()[1].starts_with(&format!("{LAST_REPLY_LEAD}\n{}", Nudge::QuestionList.note())), "{}", fx.sends()[1]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_call_with_bad_arguments_is_an_error_and_the_turn_goes_on() {
	let fx = lesson("session-tool-error", None, vec![vec![tool("ask_user_question", json!({})), text("Let me ask that again.")]]);
	fx.say("Teach me sets").await;
	fx.settled().await;
	let result = fx.messages().into_iter().find(|m| Role::ToolResult.is(m)).expect("the failed call's result is saved");
	assert_eq!(result["isError"].as_bool(), Some(true));
	assert_eq!(fx.replies(), ["Let me ask that again."], "a failed question does not end the turn");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_calls_of_one_step_stay_in_one_message() {
	let fx = lesson("session-step", None, Vec::new());
	let home = fx.app.paths.home.to_string_lossy().into_owned();
	fx.agent.push(vec![FakeStep::Calls(vec![("ls".to_owned(), json!({ "path": home })), ("ls".to_owned(), json!({ "path": home }))]), text("Two looks.")]);
	fx.say("What is in my folder?").await;
	fx.settled().await;
	// Each message as its role and the ids of its calls: no call is written twice, none waits.
	let shape: Vec<String> = fx
		.messages()
		.iter()
		.map(|m| {
			let ids: Vec<&str> = m["content"].items().iter().filter(|b| b["type"].as_str() == Some("toolCall")).map(|b| b["id"].str_or_empty()).collect();
			format!("{} {}{}", m["role"].str_or_empty(), ids.join(","), m["toolCallId"].str_or_empty())
		})
		.collect();
	assert_eq!(shape, ["custom ", "user ", "assistant toolu_1.0,toolu_1.1", "toolResult toolu_1.0", "toolResult toolu_1.1", "assistant "], "{:?}", fx.messages());
}

/// Over Codex a plot sent before its guess waits unseen: no message the window gets holds it
/// until the guess comes, and then the two come together.
#[tokio::test(flavor = "multi_thread")]
async fn a_plot_sent_first_is_never_shown_before_its_guess() {
	let plot = json!({
		"title": "One feature, where the weight ends up",
		"x": { "name": "a", "label": "where the data alone put it", "min": 0, "max": 10 },
		"y": { "label": "w", "min": 0, "max": 5 },
		"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 },
		"lines": [{ "label": "penalty", "expr": "a/(1+lambda)", "hidden": true }, { "label": "leash", "expr": "min(a, 4/(1+lambda))" }],
	});
	let options = json!([{ "label": "At 2.", "value": "A" }, { "label": "At 4.", "value": "B" }]);
	let guess = json!({ "type": "predict", "nodeId": "reg", "question": "At a = 8, where does the penalty put it?", "options": options, "explanation": "8/2 = 4.", "correctAnswer": "B", "onPlot": { "line": "penalty", "x": 8 } });
	let fx = lesson_on("session-held-plot", Some("study"), vec![vec![bash(), text("A leash."), tool("plot", plot), text("Guess first."), tool("quiz", guess)]], FakeAgent::codex_runtime);
	fx.app.stores.chats.save_tree(&fx.chat_id, &json!({ "nodes": [{ "id": "reg", "title": "Regularization" }], "edges": [] })).unwrap();
	fx.say("Teach me Regularization.").await;
	// The approval holds the turn while the window's view starts listening.
	let id = fx.approval().await;
	let seen: Arc<Mutex<Vec<Json>>> = Arc::default();
	let sink = seen.clone();
	running_turn(&fx.app, &fx.chat_id).unwrap().turn().subscribe(Arc::new(move |event: &AgentEvent| sink.lock().push(event.to_json())));
	answer_approval(&fx.app, &fx.chat_id, &id, true);
	fx.settled().await;

	let seen = seen.lock();
	let calls = |e: &Json| e["message"]["content"].items().iter().filter_map(|b| b["name"].as_str().map(str::to_owned)).collect::<Vec<_>>();
	let guess_at = seen.iter().position(|e| e["type"].as_str() == Some("tool_execution_start") && e["toolName"].as_str() == Some("quiz")).expect("the guess came");
	assert!(seen[..guess_at].iter().all(|e| !calls(e).contains(&"plot".to_owned())), "the plot was shown before its guess: {:?}", &seen[..guess_at]);
	assert!(seen[guess_at..].iter().any(|e| e["type"].as_str() == Some("message_end") && calls(e) == ["plot", "quiz"]), "then both at once");
}

/// A lesson's session starts on the model the learner picked for the agent; a job keeps the
/// agent's own default.
#[tokio::test(flavor = "multi_thread")]
async fn a_new_lesson_session_starts_on_the_picked_model() {
	for runtime in [FakeAgent::runtime as fn(&FakeAgent) -> Runtime, FakeAgent::codex_runtime] {
		let fx = lesson_on("session-model", None, vec![vec![text("Sets, then.")]], runtime);
		let agent = folder_agent(&fx.app);
		let mut picked = gs_json::Obj::new();
		picked.insert(agent.name(), "a-picked-model");
		set_agent_models(&fx.app, &Json::Obj(picked)).unwrap();
		fx.say("Teach me sets").await;
		fx.settled().await;
		let opened = if agent == FolderAgent::Claude { fx.sent("open")[0]["model"].clone() } else { fx.requests("thread/start")[0]["params"]["model"].clone() };
		assert_eq!(opened.as_str(), Some("a-picked-model"), "{}", agent.name());
	}
}

/// Try again after a failed reply runs on from the record on a new session: the agent hears the
/// learner's line once and answers it once, and the record holds the line once.
#[tokio::test(flavor = "multi_thread")]
async fn try_again_after_a_failed_reply_answers_the_line_once() {
	const LINE: &str = "Why are sets unordered?";
	for runtime in [FakeAgent::runtime as fn(&FakeAgent) -> Runtime, FakeAgent::codex_runtime] {
		let fx = lesson_on("session-try-again", None, vec![vec![FakeStep::Fail("overloaded".to_owned())], vec![text("Order is not part of a set.")]], runtime);
		let agent = folder_agent(&fx.app);
		fx.say(LINE).await;
		fx.settled().await;
		let retry = handle_chat_input(&fx.app, &fx.chat_id, TurnInput::Chat(ChatInput::Continue)).await;
		assert!(retry.ok(), "{}", retry.text());
		fx.settled().await;
		let (opens, inputs): (usize, Vec<String>) = if agent == FolderAgent::Claude {
			(fx.sent("open").len(), fx.sends())
		} else {
			let words = |t: &Json| t["params"]["input"].items().iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n");
			(fx.requests("thread/start").len(), fx.requests("turn/start").iter().map(words).collect())
		};
		assert_eq!(opens, 2, "{}: Try again opens a new session", agent.name());
		assert_eq!(inputs.len(), 2, "{}", agent.name());
		assert_eq!(inputs[1].matches(LINE).count(), 1, "{}: the new session hears the line once", agent.name());
		assert_eq!(fx.replies(), ["Order is not part of a set."], "{}", agent.name());
		let users = fx.messages().iter().filter(|m| Role::User.is(m) && m["content"].as_str() == Some(LINE)).count();
		assert_eq!(users, 1, "{}: the record holds the line once", agent.name());
	}
}

/// A new install has no godspeed folder: the first session sets it up, so the agent finds its
/// space-setup steps there, and what an older godspeed left in the folder goes.
#[tokio::test(flavor = "multi_thread")]
async fn the_first_session_sets_up_the_godspeed_folder() {
	let fx = lesson("session-folder", Some("talk"), vec![vec![text("Let's set one up.")]]);
	let folder = std::path::PathBuf::from(agent_folder(&fx.app));
	std::fs::create_dir_all(&folder).unwrap();
	gs_base::fsx::write_text_atomic(&folder.join("CLAUDE.md"), "<!-- godspeed rewrites this file each time it starts. Put your own notes for Claude in CLAUDE.local.md. -->\n").unwrap();
	assert!(!folder.join(".godspeed/setup-spaces.md").exists());
	fx.say("Set up a space").await;
	fx.settled().await;
	assert!(folder.join(".godspeed/setup-spaces.md").is_file(), "the space-setup steps are there");
	assert!(!folder.join("CLAUDE.md").exists(), "an older godspeed's file goes");
	assert_eq!(fx.sent("open")[0]["cwd"].as_str(), folder.to_str());
	assert_eq!(fx.replies(), ["Let's set one up."]);
}

/// A PDF the learner attaches is saved in the chat's own folder, which the agent reads without
/// asking: Claude Code takes it as an added folder, and Codex's sandbox reads every folder. A
/// space file made from it keeps the name the learner gave it.
#[tokio::test(flavor = "multi_thread")]
async fn an_attached_pdf_is_read_without_asking_and_keeps_its_name_in_a_space() {
	let fx = lesson("session-attached-pdf", Some("talk"), vec![vec![text("A space from your notes, then.")]]);
	let pdf = ChatAttachment { name: "graph notes.pdf".to_owned(), mime_type: "application/pdf".to_owned(), data: base64::encode(b"%PDF-1.4 notes") };
	let sent = handle_chat_input(&fx.app, &fx.chat_id, TurnInput::Chat(ChatInput::Text { text: "Make a space from this".to_owned(), attachments: Some(vec![pdf]), about: None })).await;
	assert!(sent.ok(), "{}", sent.text());
	fx.settled().await;
	let parts: Vec<Json> = fx.messages().iter().flat_map(|m| m["content"].items().to_vec()).collect();
	let (_, path) = parts.iter().find_map(|part| pdf_note_of(part["text"].as_str()?)).expect("the PDF's note");
	assert!(parts.iter().any(|part| part["text"].str_or_empty().ends_with("\nRead it when you need its content.")), "the panel's chat has no pdf tool");
	let read_dirs = fx.sent("open")[0]["readDirs"].clone();
	assert_eq!(read_dirs.items().len(), 1);
	assert!(std::path::Path::new(&path).starts_with(read_dirs[0].str_or_empty()), "{path} is in a folder the agent reads without asking");
	assert!(std::path::Path::new(&path).file_name().unwrap().to_string_lossy().ends_with("-graph notes.pdf"), "stored by its content");
	let space_id = fx.app.stores.spaces.create_space(&json!({ "name": "Graphs" })).unwrap()["id"].str_or_empty().to_owned();
	let file = add_file_from_path(&fx.app, &space_id, &path, FileKind::Study).unwrap();
	assert_eq!(file["name"].as_str(), Some("graph notes.pdf"));
}
