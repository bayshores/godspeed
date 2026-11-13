//! The two-day story of a Study session, end to end against a stand-in agent on the bridge and the
//! app clock. Wednesday evening: three questions from earlier while the first reply is written, a
//! reply opening on his lecture page with quoted words, the plot and his guess, a kept sentence
//! with its analogy and memory phrase, Drop this analogy, a problem with one hint, the topic's stop
//! and Stop here. Saturday: Continue shows the stored opener with no agent, three questions from
//! earlier (one bringing back his sentence), the [Resumed], [Opener] and [From earlier] lines in
//! that order, a topic ended by a conclude, Keep going, and the last topic ended by a right quiz.
//! At every step it checks the stored record and what the agent was sent. The window's half of the
//! story (what the screen draws from this record) is the TypeScript side's. The app clock is
//! moved, so this file holds one test and no other file shares its process.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, fsx, ids, time};
use gs_core::contracts::chat::{STUDY_TOPIC_END_ACK_TEXT, TOPIC_DONE_STORED_TEXT};
use gs_core::messages::input_events::{ChatInput, TurnInput};
use gs_core::spaces::today_note::local_day;
use gs_core::study::kept::KeptPart;
use gs_core::study::topic_end::{lesson_stop, shown_openers};
use gs_core::study::topic_parts::topic_parts;
use gs_engine::bridge::{AgentReply, ReplyCall, WaitOptions};
use gs_json::{Json, json, stringify};
use gs_services::App;
use gs_services::graph::progress::progress_for;
use gs_services::spaces::citations::check_cites;
use gs_services::spaces::source_id_for;
use gs_services::turns::lesson_events::{KeepGoing, KeptDrop, drop_kept_part, keep_going};
use gs_services::turns::review::{ReviewReply, answer_review, next_review};
use gs_services::turns::{handle_chat_input, is_turn_running};
use gs_store::graph::Ledger;

const MINUTE_MS: i64 = 60_000;
const DAY_MS: i64 = 86_400_000;

/// The space's lecture files, by file id and name; each topic's fact was born in one of them.
const LECTURES: [(&str, &str); 6] = [
	("f_00000000000b", "Lecture 2.pdf"),
	("f_00000000000e", "Lecture 3.pdf"),
	("f_00000000000d", "Lecture 4.pdf"),
	("f_000000000006", "Lecture 6.pdf"),
	("f_000000000007", "Lecture 7.pdf"),
	("f_000000000008", "Lecture 8.pdf"),
];
/// The topics, each born in the lecture at the same place in LECTURES.
const TOPICS: [(&str, &str); 6] = [("bayes", "Bayes' rule"), ("eig", "Eigenvalues"), ("gd", "Gradient descent"), ("reg", "Regularization"), ("cv", "Cross-validation"), ("ms", "Model selection")];
const LECTURE_6: &str = "f_000000000006";
const LECTURE_7: &str = "f_000000000007";

/// An app over a fresh folder, removed when dropped.
struct Fixture {
	app: Arc<App>,
	dir: PathBuf,
}

impl Drop for Fixture {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

/// Moves the app clock to `at` (ms); the story only moves forward.
fn clock_to(at: i64) {
	let by = at - clock::now_ms();
	assert!(by > 0, "the story only moves forward");
	clock::advance(by);
}

/// Local `hh:mm` on `day` (`YYYY-MM-DD`), in ms.
fn local(day: &str, hh_mm: &str) -> i64 {
	time::parse_date(&format!("{day}T{hh_mm}:00")).unwrap()
}

/// `day` moved by `days` local days.
fn day_after(day: &str, days: i64) -> String {
	local_day(local(day, "12:00") + days * DAY_MS)
}

fn quiz(kind: &str, node: &str, question: &str, options: &[&str]) -> Json {
	let options: Vec<Json> = options.iter().map(|label| json!({ "label": label })).collect();
	json!({ "type": kind, "nodeId": node, "question": question, "options": options, "explanation": "Because of the first option.", "correctAnswer": options[0]["label"] })
}

/// The space Machine Learning Foundations: six lecture files, a passage of Lecture 6 page 14 and
/// of Lecture 7 page 3, one fact and topic per lecture, the Midterm a week after `wednesday`
/// covering Lectures 4, 6, 7 and 8, and two earlier lessons where he got Bayes' rule, Eigenvalues
/// and Gradient descent right 10 days before, which hold their questions from earlier (two each for
/// Bayes' rule and Gradient descent). The space id and the Midterm's id.
fn machine_learning_space(app: &App, wednesday: &str) -> (String, String) {
	let space_id = app.stores.spaces.create_space(&json!({ "name": "Machine Learning Foundations" })).unwrap()["id"].as_str().unwrap().to_owned();
	let file = |(id, name): &(&str, &str)| json!({ "id": id, "origin": "copied", "name": name, "path": name, "kind": "study", "contentFp": "0", "status": "ready", "addedAt": "2026-09-01T00:00:00.000Z" });
	app.stores.spaces.save_files(&space_id, LECTURES.iter().map(file).collect(), &[]).unwrap();
	let rows = json!([
		{ "id": format!("{LECTURE_6}:1"), "fileId": LECTURE_6, "range": "p. 14", "from": 14, "to": 14, "text": "With degree 12 the curve passes through every training point and swings wildly between them.", "hash": "h6" },
		{ "id": format!("{LECTURE_7}:1"), "fileId": LECTURE_7, "range": "p. 3", "from": 3, "to": 3, "text": "Each split holds out a different 12 points, so the test score moves from split to split.", "hash": "h7" },
	]);
	let table = json!({ "format": 1, "model": "Snowflake/snowflake-arctic-embed-xs", "rows": rows, "files": { LECTURE_6: { "fp": "0", "extent": "20 pages" }, LECTURE_7: { "fp": "0", "extent": "12 pages" } } });
	let search = app.paths.data.join("spaces").join(&space_id).join("search");
	fsx::write_atomic(&search.join("passages.json"), stringify(&table).as_bytes(), None).unwrap();
	fsx::write_atomic(&search.join("passages.f32"), &[0u8; 2 * 384 * 4], None).unwrap();

	let then = local(wednesday, "12:00") - 10 * DAY_MS;
	let mut topics = Vec::new();
	for ((node, name), (file_id, _)) in TOPICS.iter().zip(LECTURES) {
		let born = source_id_for(&space_id, file_id);
		let fact = json!({ "id": format!("f_{node}"), "name": name, "statement": name, "createdAt": time::iso(then), "aliases": [], "provenance": [{ "chatId": born, "messageId": format!("{file_id}:1") }] });
		app.stores.graphs.append(Some(&space_id), Ledger::Nodes, &fact).unwrap();
		topics.push(json!({ "id": node, "name": name, "members": [format!("f_{node}")] }));
	}
	app.stores.graphs.append(Some(&space_id), Ledger::Topics, &json!({ "at": time::iso(then), "topics": topics })).unwrap();
	let midterm = json!({ "name": "Midterm", "kind": "exam", "date": day_after(wednesday, 7), "fileIds": [LECTURES[2].0, LECTURES[3].0, LECTURES[4].0, LECTURES[5].0] });
	let deadline_id = app.stores.spaces.add_deadline(&space_id, &midterm).unwrap()["id"].as_str().unwrap().to_owned();

	// Each earlier topic: a quiz he got right, then the topic_done that stored its question.
	let earlier = |nodes: &[&str], tag: &str| {
		let chat_id = app.stores.chats.create_chat("Study earlier topics", Some("study"), Some(&space_id), None).unwrap()["id"].as_str().unwrap().to_owned();
		let mut messages = Vec::new();
		for node in nodes {
			let name = TOPICS.iter().find(|(id, _)| id == node).unwrap().1;
			let right = json!({ "kind": "quiz", "dontKnow": false, "correct": true, "answers": [{ "index": 1, "label": "Yes", "value": "Yes" }], "confidence": 80, "answeredAt": time::iso(then) });
			let review = quiz("check", node, &format!("{name}, question {tag}?"), &["Right", "Wrong", "Neither"]);
			messages.extend([
				json!({ "role": "assistant", "id": format!("m-q-{node}-{tag}"), "content": [{ "type": "toolCall", "id": format!("q-{node}-{tag}"), "name": "quiz", "arguments": quiz("check", node, &format!("Is {name} learned?"), &["Yes", "No"]) }], "timestamp": then }),
				json!({ "role": "toolResult", "toolCallId": format!("q-{node}-{tag}"), "toolName": "quiz", "details": right, "isError": false, "timestamp": then }),
				json!({ "role": "assistant", "id": format!("m-t-{node}-{tag}"), "content": [{ "type": "toolCall", "id": format!("t-{node}-{tag}"), "name": "topic_done", "arguments": { "nodeId": node, "review": review } }], "timestamp": then }),
				json!({ "role": "toolResult", "toolCallId": format!("t-{node}-{tag}"), "toolName": "topic_done", "details": { "part": "topic_done", "v": 1 }, "isError": false, "timestamp": then }),
			]);
		}
		app.stores.chats.save_messages(&chat_id, &messages).unwrap();
	};
	earlier(&["bayes", "eig", "gd"], "1");
	earlier(&["bayes", "gd"], "2");
	(space_id, deadline_id)
}

/// The lesson's next work item, answered the way respond does (its words' marks checked first);
/// the whole transcript the agent was sent, checked to hold none of the lesson's UI-only markers.
async fn agent(app: &App, chat_id: &str, text: Option<&str>, calls: Vec<(&str, Json)>) -> Vec<Json> {
	let opts = WaitOptions { conversation: Some(chat_id.to_owned()), full: true, ..WaitOptions::default() };
	let view = app.bridge.wait_for_work(10_000, opts).await.expect("a work item");
	let text = text.map(|t| check_cites(app, t).text);
	let tool_calls = calls.into_iter().map(|(name, arguments)| ReplyCall { name: name.to_owned(), arguments }).collect();
	app.bridge.respond_to_work(&view.work_id, AgentReply { text, tool_calls }, 0).unwrap();
	let sent = stringify(&Json::Arr(view.messages.clone()));
	for marker in ["keep-going", "keep-check", "analogy-drop", "phrase-drop", "opener-answer", "customType"] {
		assert!(!sent.contains(marker), "{marker} reached the agent: {sent}");
	}
	for m in &view.messages {
		assert!(matches!(m["role"].as_str(), Some("user" | "assistant" | "toolResult")), "{m:?}");
		assert!(m["role"].as_str() != Some("user") || m["text"].as_str().is_some_and(|t| !t.trim().is_empty()), "an empty input reached the agent: {m:?}");
	}
	view.messages
}

async fn says(app: &App, chat_id: &str, text: &str) -> Vec<Json> {
	agent(app, chat_id, Some(text), Vec::new()).await
}

async fn calls(app: &App, chat_id: &str, calls: Vec<(&str, Json)>) -> Vec<Json> {
	agent(app, chat_id, None, calls).await
}

async fn settled(app: &App, chat_id: &str) {
	for _ in 0..2000 {
		if !is_turn_running(app, chat_id) {
			return;
		}
		clock::sleep(5).await;
	}
	panic!("the turn never settled");
}

/// His input; its turn starts and runs in the background.
async fn send(app: &Arc<App>, chat_id: &str, input: ChatInput) {
	let reply = handle_chat_input(app, chat_id, TurnInput::Chat(input)).await;
	assert_eq!(reply.status, 200, "{}", reply.text());
}

fn text(words: &str) -> ChatInput {
	ChatInput::Text { text: words.to_owned(), attachments: None, about: None }
}

/// His graded pick of option `index` (from 1), as the window sends it.
fn picked(index: usize, label: &str, value: &str, correct: bool, confidence: i64) -> Json {
	json!({ "kind": "quiz", "dontKnow": false, "correct": correct, "answers": [{ "index": index, "label": label, "value": value }], "confidence": confidence })
}

fn answered(tool_call_id: &str, answer: Json) -> ChatInput {
	ChatInput::Answer { tool_call_id: tool_call_id.to_owned(), answer, attachments: None }
}

fn messages(app: &App, chat_id: &str) -> Vec<Json> {
	app.stores.chats.get_chat(chat_id).unwrap()["messages"].as_arr().unwrap().clone()
}

/// The newest call named `name` in the record.
fn last_call(record: &[Json], name: &str) -> Json {
	record.iter().rev().flat_map(|m| m["content"].as_arr().into_iter().flatten()).find(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some(name)).unwrap().clone()
}

fn id_of(call: &Json) -> String {
	call["id"].as_str().unwrap().to_owned()
}

fn result_of<'a>(record: &'a [Json], call_id: &str) -> &'a Json {
	record.iter().find(|m| m["role"].as_str() == Some("toolResult") && m["toolCallId"].as_str() == Some(call_id)).unwrap()
}

fn marker<'a>(record: &'a [Json], custom_type: &str, key: &str, of: &str) -> &'a Json {
	record.iter().rfind(|m| m["customType"].as_str() == Some(custom_type) && m["details"][key].as_str() == Some(of)).unwrap()
}

/// Every line of his inputs the agent was sent, in order.
fn input_lines(seen: &[Json]) -> Vec<String> {
	seen.iter().filter(|m| m["role"].as_str() == Some("user")).filter_map(|m| m["text"].as_str()).flat_map(str::lines).map(str::to_owned).collect()
}

/// The last input the agent was sent.
fn last_input(seen: &[Json]) -> String {
	seen.iter().rev().find(|m| m["role"].as_str() == Some("user")).unwrap()["text"].as_str().unwrap().to_owned()
}

/// The Midterm as Today reads it.
fn midterm(app: &App, space_id: &str, deadline_id: &str) -> Json {
	let progress = progress_for(app, space_id, None).unwrap().unwrap();
	progress["deadlines"].as_arr().unwrap().iter().find(|d| d["id"].as_str() == Some(deadline_id)).unwrap().clone()
}

/// The open question from earlier, which must be on `topic`; answered as `answer`.
fn from_earlier(app: &App, chat_id: &str, topic: &str, answer: Json) -> Json {
	let ReviewReply::Next(Some(question)) = next_review(app, chat_id).unwrap() else { panic!("a question from earlier on {topic}") };
	assert_eq!(question["topic"], json!(topic));
	assert_eq!(answer_review(app, chat_id, &question["of"], &answer).unwrap(), ReviewReply::Done);
	question
}

fn plot() -> Json {
	json!({
		"title": "One feature, where the weight ends up",
		"x": { "name": "a", "label": "where the data alone put it", "min": 0, "max": 10 },
		"y": { "label": "w", "min": 0, "max": 5 },
		"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 },
		"lines": [{ "label": "penalty", "expr": "a/(1+lambda)", "hidden": true }, { "label": "leash", "expr": "min(a, 4/(1+lambda))" }],
	})
}

fn guess() -> Json {
	let options = json!([{ "label": "At 2, the leash's length.", "value": "A" }, { "label": "At 4.", "value": "B" }, { "label": "At 3.", "value": "C" }, { "label": "At 8.", "value": "D" }]);
	json!({ "type": "predict", "nodeId": "reg", "question": "Now the data pull twice as hard, a = 8, still at lambda = 1. Where does the penalty put it?", "options": options, "explanation": "a/(1+lambda) is 8/2 = 4.", "correctAnswer": "B", "onPlot": { "line": "penalty", "x": 8 } })
}

fn kept_quiz() -> Json {
	let options = json!([{ "label": "1.5", "value": "A" }, { "label": "6", "value": "B" }, { "label": "3", "value": "C" }, { "label": "0.375", "value": "D" }]);
	let keep = json!({
		"text": "Lambda prices large weights; it does not cap them.",
		"source": format!("[[{LECTURE_6}:1 \"degree 12\"]]"),
		"fits": "The leash fits one part: for the data you have, a larger lambda gives a shorter leash.",
		"stops": "It stops at new data: double the pull and every weight doubles.",
		"phrase": "Price, not cap",
	});
	json!({ "type": "check", "nodeId": "reg", "question": "A penalized fit at lambda = 2 puts one weight at 1.5. Every y is multiplied by 4. Where is that weight now?", "options": options, "explanation": "The fit is linear in y.", "correctAnswer": "B", "keep": keep })
}

fn problem(node: &str, statement: &str) -> Json {
	json!({ "statement": statement, "mode": "recall", "modelSolution": "Say what the penalty or the split does, in one line.", "nodeId": node })
}

fn conclude(outcome: &str, rung: Option<&str>, verdict: &str) -> Json {
	json!({ "outcome": outcome, "verdict": verdict, "rung": rung, "missClass": null, "retest": false })
}

#[tokio::test(flavor = "multi_thread")]
async fn two_days_of_study_for_the_midterm() {
	let dir = std::env::temp_dir().join(format!("gs-learning-loop-story-{}", ids::uuid()));
	for name in ["data", "home", "tmp", "res"] {
		std::fs::create_dir_all(dir.join(name)).unwrap();
	}
	let fx = Fixture { app: App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.join("res")), None), dir };
	let app = &fx.app;
	// The first Wednesday at least a week away: the story only moves the clock forward.
	let wednesday = (7..14).map(|days| clock::now_ms() + days * DAY_MS).find(|ms| time::local(*ms).weekday().to_monday_one_offset() == 3).map(local_day).unwrap();
	let saturday = day_after(&wednesday, 3);
	let (space_id, deadline_id) = machine_learning_space(app, &wednesday);
	let plan = json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }, { "id": "ms", "title": "Model selection" }], "edges": [{ "from": "reg", "to": "cv" }, { "from": "cv", "to": "ms" }] });
	let chat_id = app.stores.chats.create_chat("Study for Midterm", Some("study"), Some(&space_id), Some(&deadline_id)).unwrap()["id"].as_str().unwrap().to_owned();
	app.stores.chats.save_tree(&chat_id, &plan).unwrap();
	let chat = chat_id.as_str();
	// He thinks for 3 minutes 45 before each input, and the agent takes 2 minutes to answer.
	let thinks = || clock::advance(15 * MINUTE_MS / 4);
	let writes = || clock::advance(2 * MINUTE_MS);

	// Wednesday 21:00. Start, and three questions from earlier while the first reply is written.
	clock_to(local(&wednesday, "21:00"));
	send(app, chat, text("Study for Midterm")).await;
	let bayes_wed = from_earlier(app, chat, "Bayes' rule", picked(2, "Wrong", "Wrong", false, 60));
	from_earlier(app, chat, "Eigenvalues", picked(1, "Right", "Right", true, 80));
	let gd_wed = from_earlier(app, chat, "Gradient descent", picked(1, "Right", "Right", true, 80));
	assert_eq!(next_review(app, chat).unwrap(), ReviewReply::Next(None), "three a day");
	writes();
	// The opening reply has words alone; the first topic takes its quoted page.
	let page = format!("Picture fitting a curve of degree 12 to ten points [[{LECTURE_6}:1 \"degree 12\"]]. It hits every point.");
	says(app, chat, &page).await;
	settled(app, chat).await;
	let record = messages(app, chat);
	let stored_page = format!("[[{LECTURE_6}/p. 14/Lecture 6.pdf|degree 12]]");
	let opening = record.iter().find(|m| m["role"].as_str() == Some("assistant") && stringify(&m["content"]).contains(&stored_page)).expect("the quoted mark is stored checked");
	let opening_id = opening["id"].clone();
	assert_eq!(record.iter().filter(|m| m["customType"].as_str() == Some("review")).count(), 3, "his answers are written at once, during the turn");
	assert_eq!(next_review(app, chat).unwrap(), ReviewReply::Next(None), "the reply landed");

	thinks();
	send(app, chat, text("It swings wildly between them?")).await;
	writes();
	let seen = says(app, chat, "A penalty on the weights: the loss grows with them.").await;
	settled(app, chat).await;
	assert_eq!(input_lines(&seen).iter().filter(|l| l.starts_with("[From earlier]")).collect::<Vec<_>>(), ["[From earlier] Bayes' rule wrong, sure 3, picked Wrong. Eigenvalues right, sure 4. Gradient descent right, sure 4."]);
	assert!(stringify(&Json::Arr(seen.clone())).contains(&stored_page), "the agent reads its mark as stored");

	// The plot and its guess; his guess at A opens it.
	thinks();
	send(app, chat, text("How much does it shrink them?")).await;
	writes();
	calls(app, chat, vec![("quiz", guess()), ("plot", plot())]).await;
	settled(app, chat).await;
	let record = messages(app, chat);
	let (plot_call, guess_call) = (last_call(&record, "plot"), last_call(&record, "quiz"));
	assert_eq!((&plot_call["arguments"], &guess_call["arguments"]), (&plot(), &guess()), "both stored as sent");
	let drawn = result_of(&record, &id_of(&plot_call));
	assert_eq!(drawn["details"], json!({ "part": "plot", "v": 1, "id": "p1", "onPlot": { "toolCallId": guess_call["id"], "value": 4.0 }, "y": { "min": 0, "max": 5 } }));
	thinks();
	send(app, chat, answered(&id_of(&guess_call), picked(1, "At 2, the leash's length.", "A", false, 60))).await;
	writes();
	let seen = says(app, chat, "Not quite: the penalty puts it at 4. The leash is a picture, and here it breaks.").await;
	settled(app, chat).await;
	assert!(stringify(&Json::Arr(seen)).contains("p1 drawn. At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2."));

	// A quiz that carries a kept sentence, right; then Drop this analogy while the teacher writes.
	thinks();
	send(app, chat, text("So the penalty scales with the data?")).await;
	writes();
	says(app, chat, "Yes. The fit is linear in y, so the penalty only prices the weights.").await;
	settled(app, chat).await;
	thinks();
	send(app, chat, text("Ok, test me.")).await;
	writes();
	calls(app, chat, vec![("quiz", kept_quiz())]).await;
	settled(app, chat).await;
	let record = messages(app, chat);
	let keep_call = last_call(&record, "quiz");
	let keep_id = id_of(&keep_call);
	assert_eq!(keep_call["arguments"], kept_quiz(), "stored as sent, its source mark unchecked");
	assert_eq!(
		marker(&record, "keep-check", "quizCallId", &keep_id)["details"],
		json!({ "quizCallId": keep_id, "keep": "shown", "fits": true, "phrase": true, "source": "ok", "sourceMark": stored_page }),
		"its verdict, stored when the turn was saved"
	);
	thinks();
	send(app, chat, answered(&keep_id, picked(2, "6", "B", true, 80))).await;
	assert_eq!(drop_kept_part(app, chat, &keep_id, KeptPart::Analogy, false), Ok(KeptDrop::Done), "Drop this analogy during the turn");
	writes();
	let seen = calls(app, chat, vec![("problem", problem("reg", "Why does an L2 penalty shrink the weights, and when does it stop helping?"))]).await;
	settled(app, chat).await;
	assert!(input_lines(&seen).iter().all(|l| !l.starts_with("[Analogy dropped]") && !l.starts_with("keep")), "the drop came after this input, and the keep holds");

	// The problem, one hint, then the conclude that ends the topic, with no other prose.
	thinks();
	send(app, chat, text("Because big weights cost more.")).await;
	writes();
	let seen = says(app, chat, "Half of it. What happens to the cost as lambda grows?").await;
	settled(app, chat).await;
	assert_eq!(input_lines(&seen).iter().filter(|l| l.starts_with("[Analogy dropped]")).collect::<Vec<_>>(), ["[Analogy dropped] Regularization: \"The leash fits one part\""]);
	thinks();
	send(app, chat, text("A bigger lambda makes them cost more, so the fit trades accuracy for smaller weights.")).await;
	writes();
	calls(app, chat, vec![("conclude", conclude("solvedWithHints", Some("R1"), "You said how lambda trades fit for small weights, after one hint."))]).await;
	let seen = calls(app, chat, vec![("ls", json!({ "path": app.paths.home.to_string_lossy() }))]).await;
	let ended = seen.iter().rev().find(|m| m["toolName"].as_str() == Some("conclude")).unwrap();
	assert_eq!(ended["text"], json!(STUDY_TOPIC_END_ACK_TEXT));
	let conclude_reg = ended["toolCallId"].as_str().unwrap().to_owned();
	let opener_cv = json!({
		"nodeId": "reg",
		"review": quiz("check", "reg", "What does a larger lambda do to the weights of a fit?", &["Prices them higher", "Caps them", "Leaves them"]),
		"opener": { "lead": format!("One split of the data can mislead you [[{LECTURE_7}:1 \"a different 12\"]]."), "quiz": quiz("predict", "cv", "If you split the data again, how much can the test score move?", &["It can move a lot", "It barely moves", "It always drops"]) },
	});
	calls(app, chat, vec![("topic_done", opener_cv.clone())]).await;
	settled(app, chat).await;
	let record = messages(app, chat);
	let stop = &result_of(&record, &conclude_reg)["details"]["stop"];
	assert_eq!((stop["kind"].as_str(), stop["nodeId"].as_str(), stop["activeMinutes"].as_i64()), (Some("topic"), Some("reg"), Some(48)), "Stop here is the dark button at 48 minutes");
	let done_reg = last_call(&record, "topic_done");
	assert_eq!(done_reg["arguments"], opener_cv, "stored as sent");
	let stored_lead = format!("One split of the data can mislead you [[{LECTURE_7}/p. 3/Lecture 7.pdf|a different 12]].");
	assert_eq!(result_of(&record, &id_of(&done_reg))["details"], json!({ "part": "topic_done", "v": 1, "lead": stored_lead }));
	let at_stop = lesson_stop(&record, Some(&plan), None).unwrap();
	assert_eq!((at_stop["kind"].as_str(), at_stop["next"].as_str(), at_stop["keptGoing"].as_bool()), (Some("topic"), Some("Cross-validation"), Some(false)));
	assert!(shown_openers(&record).is_empty(), "the opener waits for Keep going");

	// Stop here stores nothing; Today reads Continue studying for Midterm.
	let today = midterm(app, &space_id, &deadline_id);
	assert_eq!(today["continueStudy"]["stop"], json!({ "at": stop["at"], "next": "Cross-validation" }));
	assert_eq!(today.get("studyEndedToday"), None);

	// Saturday 20:40. Continue: the opener shows from disk with no agent teaching.
	clock_to(local(&saturday, "20:40"));
	assert!(!app.bridge.agent_teaching(clock::now_ms()), "the head says Waiting for your agent");
	assert_eq!(keep_going(app, chat, &conclude_reg), Ok(KeepGoing::Kept { opener: true, running: false }));
	let record = messages(app, chat);
	let done_reg_id = id_of(&done_reg);
	assert!(shown_openers(&record).contains_key(&done_reg_id));
	let pages = topic_parts(&record);
	assert_eq!(pages.iter().map(|t| (t["nodeId"].as_str().unwrap(), t["page"]["quote"].as_str())).collect::<Vec<_>>(), [("reg", Some("degree 12")), ("cv", Some("a different 12"))]);
	assert_eq!(pages[0]["page"]["messageId"], opening_id, "Regularization's page is in the opening reply, which named no topic");
	assert_eq!(pages[1]["page"]["leadOf"], json!(done_reg_id), "the next topic's page is its opener's lead");
	assert_eq!(midterm(app, &space_id, &deadline_id)["continueStudy"]["inTopic"], json!("Cross-validation"));

	// His answer to the opener, then three questions from earlier while the teacher writes.
	thinks();
	send(app, chat, ChatInput::OpenerAnswer { topic_done_call_id: done_reg_id.clone(), answer: Some(picked(1, "It can move a lot", "It can move a lot", true, 60)) }).await;
	let bayes_sat = from_earlier(app, chat, "Bayes' rule", picked(1, "Right", "Right", true, 80));
	let gd_sat = from_earlier(app, chat, "Gradient descent", picked(1, "Right", "Right", true, 80));
	let reg_sat = from_earlier(app, chat, "Regularization", picked(1, "Prices them higher", "Prices them higher", true, 80));
	assert_eq!(next_review(app, chat).unwrap(), ReviewReply::Next(None));
	assert_ne!(bayes_sat["of"], bayes_wed["of"], "never the question he missed last time");
	assert_ne!(gd_sat["of"], gd_wed["of"], "never one shown in the last 7 days");
	assert_eq!(reg_sat["of"]["toolCallId"], json!(done_reg_id), "the question topic_done stored");
	let record = messages(app, chat);
	let row = marker(&record, "review", "nodeId", "reg");
	assert_eq!(row["details"]["kept"], json!({ "of": { "chatId": chat, "messageId": keep_call_message(&record, &keep_id), "toolCallId": keep_id }, "text": "Lambda prices large weights; it does not cap them.", "source": stored_page, "phrase": "Price, not cap" }), "his sentence comes back, never the analogy");
	writes();
	let seen = calls(app, chat, vec![("problem", problem("cv", "Why can one train and test split give a misleading score?"))]).await;
	settled(app, chat).await;
	assert_eq!(last_input(&seen), "[Resumed] He came back to this session after a stop.\n[Opener] Cross-validation: he picked A, It can move a lot, sure 3.");

	// Cross-validation ends on a conclude; Keep going in the same sitting.
	thinks();
	send(app, chat, text("Each split tests on different points, so the score depends on which points.")).await;
	writes();
	let seen = calls(app, chat, vec![("conclude", conclude("solved", None, "You named why the score moves: each split tests different points."))]).await;
	let lines = input_lines(&seen);
	let order = ["[Resumed]", "[Opener]", "[From earlier]"].map(|tag| lines.iter().rposition(|l| l.starts_with(tag)).unwrap_or_else(|| panic!("{tag} in {lines:?}")));
	assert!(order[0] < order[1] && order[1] < order[2], "{lines:?}");
	assert_eq!(lines[order[2]], "[From earlier] Bayes' rule right, sure 4. Gradient descent right, sure 4. Regularization right, sure 4.");
	let opener_ms = json!({
		"nodeId": "cv",
		"review": quiz("check", "cv", "Why average the score over several splits?", &["One split can mislead", "It is faster", "It uses less data"]),
		"opener": { "lead": "Now pick between models with those scores.", "quiz": quiz("predict", "ms", "A model wins on one split and loses on four. Which do you keep?", &["The one that wins on average", "The one that won once", "Either"]) },
	});
	calls(app, chat, vec![("topic_done", opener_ms)]).await;
	settled(app, chat).await;
	let record = messages(app, chat);
	let conclude_cv = id_of(&last_call(&record, "conclude"));
	let done_cv = id_of(&last_call(&record, "topic_done"));
	assert_eq!(result_of(&record, &done_cv)["content"], json!([{ "type": "text", "text": TOPIC_DONE_STORED_TEXT }]));
	thinks();
	assert_eq!(keep_going(app, chat, &conclude_cv), Ok(KeepGoing::Kept { opener: true, running: false }));
	thinks();
	send(app, chat, ChatInput::OpenerAnswer { topic_done_call_id: done_cv, answer: Some(picked(1, "The one that wins on average", "The one that wins on average", true, 80)) }).await;
	assert_eq!(next_review(app, chat).unwrap(), ReviewReply::Next(None), "three today already");
	writes();
	let seen = calls(app, chat, vec![("quiz", quiz("check", "ms", "Two models score 0.81 and 0.80 averaged over five splits. What decides between them?", &["The spread over the splits", "The first split", "The training score"]))]).await;
	settled(app, chat).await;
	assert_eq!(last_input(&seen), "[Opener] Model selection: he picked A, The one that wins on average, sure 4.", "no [Resumed] in the same sitting");

	// Model selection ends on a right quiz: the stop comes with topic_done, after the teacher's turn.
	let ms_quiz = id_of(&last_call(&messages(app, chat), "quiz"));
	thinks();
	send(app, chat, answered(&ms_quiz, picked(1, "The spread over the splits", "The spread over the splits", true, 80))).await;
	writes();
	let last = json!({ "nodeId": "ms", "review": quiz("check", "ms", "What should decide between two models with nearly equal averaged scores?", &["Their spread", "Their names", "Their size"]) });
	calls(app, chat, vec![("topic_done", last)]).await;
	settled(app, chat).await;
	let record = messages(app, chat);
	let stop = &result_of(&record, &id_of(&last_call(&record, "topic_done")))["details"]["stop"];
	assert_eq!((stop["kind"].as_str(), stop["nodeId"].as_str()), (Some("topic"), Some("ms")));
	assert_eq!(lesson_stop(&record, Some(&plan), None).unwrap()["kind"], json!("end"), "nothing more is planned today");
	let today = midterm(app, &space_id, &deadline_id);
	assert_eq!((today.get("continueStudy"), &today["studyEndedToday"]), (None, &json!(true)));
}

/// The id of the assistant message holding the call `call_id`.
fn keep_call_message(record: &[Json], call_id: &str) -> String {
	let holds = |m: &&Json| m["content"].as_arr().is_some_and(|c| c.iter().any(|b| b["id"].as_str() == Some(call_id)));
	record.iter().find(holds).unwrap()["id"].as_str().unwrap().to_owned()
}
