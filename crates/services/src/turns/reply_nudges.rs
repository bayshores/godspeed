//! Study's reply nudges (`core::study::reply_nudges`): a reply whose words call for one is not
//! stored, and the teacher reads why. A quiz's question and a problem's statement are read for a
//! curve too, on the reply's topic, and topic_done's opener lead on the topic it opens. A reply
//! that sends a plot gets no curve nudge. Each is sent once a topic, so the same reply sent again
//! goes through. A wall of prose is sent back once a learner input, and logged with what came
//! next. What was sent lives in memory; after a restart a topic or input may get one more.

use gs_core::messages::native_messages::active_problem_of;
use gs_core::messages::role::Role;
use gs_core::session::plot::PLOT_TOOL;
use gs_core::study::reply_nudges::{Nudge, OPEN_PROBLEM_NOTE, WALL_WORDS, prose_words, reply_nudges, short_reply_input, wall_refusal};
use gs_core::study::topic_parts::{first_topic, reply_topic};
use gs_engine::bridge::ReplyCall;
use gs_json::{Json, json};

use crate::App;

/// The wall a lesson's reply was sent back for: the learner input it came after, and the refused
/// text until the next reply for that input is logged.
pub(super) struct Wall {
	input: String,
	refused: Option<String>,
}

/// Why a Study lesson's reply is sent back, or none when it is stored.
pub fn reply_refusal(app: &App, chat_id: &str, text: Option<&str>, calls: &[ReplyCall]) -> Option<String> {
	// A reply that sends a plot already does what the curve nudge asks.
	let plotted = calls.iter().any(|c| c.name == PLOT_TOOL);
	let mut words = text.map(reply_nudges).unwrap_or_default();
	words.retain(|n| !(plotted && *n == Nudge::CurveTable));
	// A quiz's question and a problem's statement are words he reads too.
	let curve_posed = calls
		.iter()
		.filter_map(|c| match c.name.as_str() {
			"quiz" => c.arguments["question"].as_str(),
			"problem" => c.arguments["statement"].as_str(),
			_ => None,
		})
		.any(|asked| reply_nudges(asked).contains(&Nudge::CurveTable));
	if curve_posed && !plotted && !words.contains(&Nudge::CurveTable) {
		words.insert(0, Nudge::CurveTable);
	}
	let openers: Vec<&str> = calls
		.iter()
		.filter(|c| !plotted && c.name == "topic_done" && c.arguments["opener"]["lead"].as_str().is_some_and(|lead| reply_nudges(lead).contains(&Nudge::CurveTable)))
		.filter_map(|c| c.arguments["opener"]["quiz"]["nodeId"].as_str())
		.collect();
	let lesson = app.stores.chats.get_chat(chat_id).filter(|c| c["kind"].as_str() == Some("study"))?;
	let messages = lesson["messages"].items();
	let mut due: Vec<(String, Nudge)> = openers.into_iter().map(|topic| (topic.to_owned(), Nudge::CurveTable)).collect();
	if !words.is_empty() {
		let content: Vec<Json> = text.map(|t| json!({ "type": "text", "text": t })).into_iter().chain(calls.iter().map(|c| json!({ "type": "toolCall", "id": "", "name": c.name, "arguments": c.arguments }))).collect();
		let topic = reply_topic(messages, first_topic(lesson.get("tree").filter(|t| !t.is_null())), &json!({ "role": Role::Assistant.as_str(), "content": content })).unwrap_or_default();
		due.extend(words.into_iter().map(|n| (topic.clone(), n)));
	}
	let problem_open = active_problem_of(messages).is_some();
	let refusal = |n: Nudge| if n == Nudge::QuestionList && problem_open { format!("{} {OPEN_PROBLEM_NOTE}", n.refusal()) } else { n.refusal().to_owned() };
	let mut lines: Vec<String> = {
		let mut sent = app.turns.nudged.lock();
		// The opener's curve comes first, so a curve in both reads once.
		due.into_iter().filter(|(topic, n)| sent.insert((chat_id.to_owned(), topic.clone(), *n))).map(|(_, n)| refusal(n)).collect()
	};
	lines.dedup();
	lines.extend(wall_line(app, chat_id, messages, text));
	(!lines.is_empty()).then(|| lines.join("\n"))
}

/// The wall's refusal, once a learner input: more than `WALL_WORDS` words of prose right after
/// his own message or a miss. Each send-back is logged, and so is the next reply for that input
/// (identical, or its word count), so the backstop's effect can be measured.
fn wall_line(app: &App, chat_id: &str, messages: &[Json], text: Option<&str>) -> Option<String> {
	let input = short_reply_input(messages)?;
	let words = text.map_or(0, prose_words);
	let mut walls = app.turns.walls.lock();
	if let Some(wall) = walls.get_mut(chat_id).filter(|w| w.input == input) {
		if let Some(refused) = wall.refused.take() {
			let next = if text == Some(refused.as_str()) { "identical".to_owned() } else { format!("{words} words") };
			eprintln!("[reply wall] lesson {chat_id}: the reply after the send-back is {next}");
		}
		return None;
	}
	if words <= WALL_WORDS {
		return None;
	}
	eprintln!("[reply wall] lesson {chat_id}: sent back a reply of {words} words");
	walls.insert(chat_id.to_owned(), Wall { input, refused: text.map(str::to_owned) });
	Some(wall_refusal(words))
}
