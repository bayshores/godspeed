//! Talk chats on a stand-in agent (gs-runtime's FakeAgent): whole turns through the chat handler,
//! as the teacher panel sends them.

use gs_base::{clock, fsx};
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_json::{Json, json};
use gs_runtime::fake::FakeStep;

use super::{create_talk_chat, earlier_words, set_talk_model, talk_chats};
use crate::app::agent_folder::{agent_folder, set_agent_models};
use crate::turns::chat_handler::handle_chat_input;
use crate::turns::stand_in::{Lesson, bash, lesson, text, tool};
use crate::turns::turn_liveness::is_turn_running;
use crate::turns::turn_runs::{abort_turn, answer_approval};
use crate::turns::turn_work::lesson_work;

/// Words only talk sessions are told, which key their own script.
const TALK_KEY: &str = "godspeed's teacher panel";

const A: &str = "0f8fad5b-d9cb-469f-a165-70867728950e";

fn talk(label: &str, turns: Vec<Vec<FakeStep>>) -> Lesson {
	lesson(label, Some("talk"), turns)
}

/// What the agent was sent to open each session.
fn opens(fx: &Lesson) -> Vec<Json> {
	fx.sent("open")
}

#[tokio::test(flavor = "multi_thread")]
async fn a_talk_chat_opens_on_where_you_left_off_and_answers_with_godspeed_s_tools() {
	let fx = talk("talk-tools", vec![vec![tool("create_space", json!({ "name": "Botany", "icon": "dna" })), text("I made Botany.")], vec![text("Glad to help.")]]);
	fx.say("Make a space for botany").await;
	fx.settled().await;
	assert_eq!(fx.replies(), ["I made Botany."]);
	assert!(fx.app.stores.spaces.list_space_records().iter().any(|s| s["name"] == json!("Botany")), "the tool ran");
	assert!(opens(&fx)[0]["systemPrompt"].str_or_empty().contains(TALK_KEY));
	let opened = opens(&fx);
	let tools: Vec<&str> = opened[0]["tools"].items().iter().filter_map(|t| t["name"].as_str()).collect();
	assert_eq!(tools.len(), 24, "godspeed's data tools: {tools:?}");
	let sends = fx.sends();
	assert!(sends[0].starts_with("## Where you left off"), "{}", sends[0]);
	assert!(sends[0].contains("Make a space for botany"));

	fx.say("Thanks").await;
	fx.settled().await;
	assert_eq!(opens(&fx).len(), 1, "the chat goes on in its session");
	assert!(!fx.sends()[1].contains("Where you left off"), "only a new session hears it");
	assert!(talk_chats(&fx.app).iter().all(|chat| chat["id"] != json!(fx.chat_id) || chat["agent"] == json!("claude")));
	assert!(fx.app.stores.chats.list_chats().is_empty(), "a talk chat is not a lesson");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_talk_chat_is_named_by_its_first_line() {
	let fx = talk("talk-name", Vec::new());
	let made = create_talk_chat(&fx.app, &format!("\n  What is due {}?\nand more", "this week ".repeat(8)), None).unwrap();
	let title = made["title"].str_or_empty();
	assert_eq!(title.chars().count(), 60);
	assert!(title.starts_with("What is due this week this week"));
	assert_eq!(create_talk_chat(&fx.app, "", None).unwrap()["title"], json!("A chat"), "a picture alone");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_talk_chat_takes_only_messages() {
	let fx = talk("talk-input", Vec::new());
	let next = handle_chat_input(&fx.app, &fx.chat_id, TurnInput::Chat(ChatInput::Next)).await;
	assert_eq!((next.status, next.text()), (400, r#"{"error":"A talk chat takes a message or Try again"}"#.to_owned()));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chat_s_model_opens_its_session_and_a_new_pick_applies_from_the_next_reply() {
	let fx = talk("talk-model", vec![vec![text("One.")], vec![text("Two.")]]);
	set_talk_model(&fx.app, &fx.chat_id, "claude-sonnet-5-5").unwrap();
	fx.say("Hi").await;
	fx.settled().await;
	assert_eq!(opens(&fx)[0]["model"], json!("claude-sonnet-5-5"));
	set_talk_model(&fx.app, &fx.chat_id, "claude-opus-5-5").unwrap();
	fx.say("Again").await;
	fx.settled().await;
	assert_eq!(opens(&fx).len(), 1);
	assert_eq!(fx.sent("model").iter().map(|m| m["model"].clone()).collect::<Vec<_>>(), [json!("claude-opus-5-5")]);
	assert!(set_talk_model(&fx.app, &fx.chat_id, "two\nlines").is_err());
	let lesson = fx.app.stores.chats.create_chat("Sets", None, None, None, &[]).unwrap();
	assert!(set_talk_model(&fx.app, lesson["id"].str_or_empty(), "claude-opus-5-5").is_err(), "a lesson's model is not the chat's to set");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chat_lists_the_model_its_next_reply_runs_on() {
	let fx = talk("talk-model-listed", Vec::new());
	let listed = |id: &str| talk_chats(&fx.app).into_iter().find(|chat| chat["id"] == json!(id)).unwrap()["model"].clone();
	assert_eq!(listed(&fx.chat_id), Json::Null, "the agent's own default");
	set_agent_models(&fx.app, &json!({ "claude": "claude-sonnet-5-5" })).unwrap();
	assert_eq!(listed(&fx.chat_id), json!("claude-sonnet-5-5"), "the setup card's model");
	let picked = create_talk_chat(&fx.app, "Hi", Some("claude-opus-5-5")).unwrap()["id"].str_or_empty().to_owned();
	assert_eq!(listed(&picked), json!("claude-opus-5-5"), "picked before the chat was made");
	assert!(create_talk_chat(&fx.app, "Hi", Some("two\nlines")).is_err());
	fx.app.stores.chats.set_agent_session(&picked, &json!({ "agent": "codex", "id": "thread-1" })).unwrap();
	assert_eq!(listed(&picked), json!("claude-sonnet-5-5"), "a pick made on the other agent is not sent to this one");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_talk_chat_runs_beside_a_lesson_turn() {
	let fx = lesson("talk-beside-lesson", None, vec![vec![FakeStep::Silence]]);
	fx.agent.push_for(TALK_KEY, vec![text("Here is your week.")]);
	fx.say("Teach me sets").await;
	let talk_id = fx.app.stores.chats.create_chat("Week", Some("talk"), None, None, &[]).unwrap()["id"].str_or_empty().to_owned();
	let sent = handle_chat_input(&fx.app, &talk_id, TurnInput::Chat(ChatInput::Text { text: "What is due?".to_owned(), attachments: None, about: None })).await;
	assert!(sent.ok(), "{}", sent.text());
	for _ in 0..500 {
		if !is_turn_running(&fx.app, &talk_id) {
			break;
		}
		clock::sleep(10).await;
	}
	assert!(!is_turn_running(&fx.app, &talk_id), "the talk turn ended");
	assert!(is_turn_running(&fx.app, &fx.chat_id), "the lesson's turn still runs");
	let talk_record = fx.app.stores.chats.get_chat(&talk_id).unwrap();
	assert!(gs_json::stringify(&talk_record["messages"]).contains("Here is your week."));
	assert!(abort_turn(&fx.app, &fx.chat_id));
	fx.settled().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn an_allowed_card_in_a_talk_chat_lets_the_turn_go_on_on_the_talk_desk() {
	let fx = talk("talk-allow", vec![vec![bash(), text("Your folder has two files.")]]);
	fx.say("What is in my folder?").await;
	let id = fx.approval().await;
	let work = lesson_work(&fx.app, &fx.chat_id).unwrap();
	assert_eq!(work["cause"], json!("talk"));
	assert_eq!(work["approvals"][0]["subject"], json!({ "kind": "command", "text": "ls" }));
	assert!(answer_approval(&fx.app, &fx.chat_id, &id, true));
	fx.settled().await;
	assert_eq!(fx.replies(), ["Your folder has two files."]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_talk_turn_is_the_teacher_s_round_for_follow_with_the_desk_s_steps_until_it_ends() {
	let web = FakeStep::OwnTool { name: "WebSearch".to_owned(), input: json!({ "query": "slope" }) };
	let fx = talk("talk-round", vec![vec![tool("list_spaces", json!({})), web, bash(), text("Both spaces are up to date.")]]);
	fx.say("Update my spaces").await;
	let id = fx.approval().await;
	let round = fx.app.teacher_round.view(clock::now_ms());
	assert_eq!((&round["live"], &round["chatId"]), (&json!(true), &json!(fx.chat_id)));
	let words = |steps: &Json| steps.items().iter().map(|s| s["text"].str_or_empty().to_owned()).collect::<Vec<_>>();
	assert_eq!(words(&round["steps"]), ["Looking at your spaces", "Searching the web for \u{201c}slope\u{201d}"]);
	assert_eq!(words(&round["steps"]), words(&lesson_work(&fx.app, &fx.chat_id).unwrap()["steps"]), "the slip lists the desk's steps");
	assert!(answer_approval(&fx.app, &fx.chat_id, &id, true));
	fx.settled().await;
	assert_eq!(fx.app.teacher_round.view(clock::now_ms())["live"], json!(false), "the round ends with the turn");
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_ends_a_talk_turn_and_denies_its_card() {
	let fx = talk("talk-stop", vec![vec![text("Let me look."), bash()]]);
	fx.say("What is in my folder?").await;
	let id = fx.approval().await;
	assert!(abort_turn(&fx.app, &fx.chat_id));
	fx.settled().await;
	assert!(!answer_approval(&fx.app, &fx.chat_id, &id, true), "denied by Stop");
	assert_eq!(fx.sent("approval")[0]["allow"], json!(false));
	assert_eq!(fx.replies(), ["Let me look."], "the words written stay");
	for _ in 0..100 {
		if !fx.sent("interrupt").is_empty() {
			return;
		}
		clock::sleep(10).await;
	}
	panic!("the agent was never stopped");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chat_from_the_terminal_goes_on_with_its_session_and_shows_its_earlier_words() {
	let fx = talk("talk-terminal", vec![vec![text("Welcome back.")]]);
	let fields = json!({ "agentSession": { "agent": "claude", "id": A, "promptHash": null, "seen": null }, "terminalChat": A });
	let old = fx.app.stores.chats.import_talk_chat("Limits proof", "2026-11-01T10:00:00.000Z", &fields).unwrap();
	let old_id = old["id"].str_or_empty().to_owned();
	let folder: String = agent_folder(&fx.app).chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
	let session_file = fx.app.paths.home.join(".claude/projects").join(folder).join(format!("{A}.jsonl"));
	let said = [
		json!({ "type": "user", "message": { "role": "user", "content": "Prove the limit." }, "timestamp": "2026-11-01T10:00:00.000Z" }),
		json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "Take epsilon." }] }, "timestamp": "2026-11-01T10:00:05.000Z" }),
	];
	fsx::write_text_atomic(&session_file, &said.iter().map(gs_json::stringify).collect::<Vec<_>>().join("\n")).unwrap();
	assert_eq!(earlier_words(&fx.app, &fx.app.stores.chats.get_chat(&old_id).unwrap()), Some(json!([{ "role": "user", "text": "Prove the limit." }, { "role": "assistant", "text": "Take epsilon." }])));

	let sent = handle_chat_input(&fx.app, &old_id, TurnInput::Chat(ChatInput::Text { text: "Where were we?".to_owned(), attachments: None, about: None })).await;
	assert!(sent.ok(), "{}", sent.text());
	for _ in 0..500 {
		if !is_turn_running(&fx.app, &old_id) {
			break;
		}
		clock::sleep(10).await;
	}
	assert_eq!(opens(&fx)[0]["resume"], json!(A), "it goes on with the terminal's session");
	assert!(fx.sends()[0].starts_with("## Where you left off"), "and hears where the learner is now");
	let record = fx.app.stores.chats.get_chat(&old_id).unwrap();
	assert_eq!(record["agentSession"]["id"], json!(format!("{A}")));
	assert!(record["agentSession"]["promptHash"].as_str().is_some(), "from now on like any talk chat");
	// A line the session wrote after the chat came here is the record's, not the earlier words'.
	let later = json!({ "type": "user", "message": { "role": "user", "content": "Where were we?" }, "timestamp": "2099-01-01T00:00:00.000Z" });
	let raw = std::fs::read_to_string(&session_file).unwrap() + "\n" + &gs_json::stringify(&later);
	fsx::write_text_atomic(&session_file, &raw).unwrap();
	assert_eq!(earlier_words(&fx.app, &record).unwrap().as_arr().unwrap().len(), 2);
	assert_eq!(earlier_words(&fx.app, &fx.record()), None, "a chat made here has none");
}
