//! Study's reply nudges (`core::study::reply_nudges`). A quiz's question, a problem's statement
//! and topic_done's opener lead that read as a curve are refused, on the reply's topic (the
//! opener's on the topic it opens). A reply's own words were already shown, so their nudges and
//! the wall of prose become notes the teacher reads before its next reply. A reply that sends a
//! plot gets no curve nudge. Each nudge is raised once a topic, so the same call sent again goes
//! through; the wall once a learner input, logged with what came next. What was raised lives in
//! memory; after a restart a topic or input may get one more.

use gs_core::contracts::chat::ChatKind;
use gs_core::messages::native_messages::active_problem_of;
use gs_core::session::plot::PLOT_TOOL;
use gs_core::study::reply_nudges::{LAST_REPLY_LEAD, Nudge, OPEN_PROBLEM_NOTE, WALL_WORDS, curve_refusal, prose_words, reply_nudges, short_reply_input, wall_note};
use gs_core::study::topic_parts::{first_topic, reply_topic};
use gs_engine::turn::messages::tool_calls;
use gs_json::Json;

use crate::App;

/// The wall a lesson's reply was noted for: the learner input it came after, and the noted text
/// until the next reply for that input is logged.
pub(super) struct Wall {
	input: String,
	noted: Option<String>,
}

fn study_lesson(app: &App, chat_id: &str) -> Option<Json> {
	app.stores.chats.get_chat(chat_id).filter(|c| ChatKind::of(c) == ChatKind::Study)
}

fn plots(reply: &Json) -> bool {
	tool_calls(reply).iter().any(|c| c["name"].as_str() == Some(PLOT_TOOL))
}

/// Raised once per lesson, topic and nudge: true the first time.
fn first_time(app: &App, chat_id: &str, topic: String, nudge: Nudge) -> bool {
	app.turns.nudged.lock().insert((chat_id.to_owned(), topic, nudge))
}

/// Why a Study call in `reply` (the assistant message so far) is refused, or none.
pub fn call_refusal(app: &App, chat_id: &str, reply: &Json, name: &str, args: &Json) -> Option<String> {
	let curve = |words: Option<&str>| words.is_some_and(|w| reply_nudges(w).contains(&Nudge::CurveTable));
	let posed = match name {
		"quiz" => curve(args["question"].as_str()),
		"problem" => curve(args["statement"].as_str()),
		"topic_done" => curve(args["opener"]["lead"].as_str()),
		_ => false,
	};
	if !posed || plots(reply) {
		return None;
	}
	let lesson = study_lesson(app, chat_id)?;
	let topic = match name {
		"topic_done" => args["opener"]["quiz"]["nodeId"].as_str()?.to_owned(),
		_ => reply_topic(lesson["messages"].items(), first_topic(lesson.get("tree").filter(|t| !t.is_null())), reply).unwrap_or_default(),
	};
	first_time(app, chat_id, topic, Nudge::CurveTable).then(curve_refusal)
}

/// The notes a Study reply's words call for (`reply` is one finished assistant message with
/// text), for the teacher's next reply.
pub fn reply_notes(app: &App, chat_id: &str, reply: &Json, text: &str) -> Vec<String> {
	let Some(lesson) = study_lesson(app, chat_id) else { return Vec::new() };
	let messages = lesson["messages"].items();
	let mut nudges = reply_nudges(text);
	nudges.retain(|n| !(*n == Nudge::CurveTable && plots(reply)));
	let topic = (!nudges.is_empty()).then(|| reply_topic(messages, first_topic(lesson.get("tree").filter(|t| !t.is_null())), reply).unwrap_or_default());
	let problem_open = active_problem_of(messages).is_some();
	let note = |n: Nudge| if n == Nudge::QuestionList && problem_open { format!("{} {OPEN_PROBLEM_NOTE}", n.note()) } else { n.note().to_owned() };
	let mut lines: Vec<String> = nudges.into_iter().filter(|n| first_time(app, chat_id, topic.clone().unwrap_or_default(), *n)).map(note).collect();
	lines.extend(wall_line(app, chat_id, messages, text));
	lines
}

/// The notes before the teacher's next reply, as one message, and gone once taken.
pub(super) fn take_notes(app: &App, chat_id: &str) -> Option<String> {
	let lines = app.turns.notes.lock().remove(chat_id).filter(|lines| !lines.is_empty())?;
	Some(format!("{LAST_REPLY_LEAD}\n{}", lines.join("\n")))
}

/// Keeps notes for the teacher's next reply in this lesson.
pub(super) fn add_notes(app: &App, chat_id: &str, lines: impl IntoIterator<Item = String>) {
	let mut lines = lines.into_iter().filter(|line| !line.is_empty()).peekable();
	if lines.peek().is_some() {
		app.turns.notes.lock().entry(chat_id.to_owned()).or_default().extend(lines);
	}
}

/// The wall's note, once a learner input: more than `WALL_WORDS` words of prose right after his
/// own message or a miss. Each note is logged, and so is the next reply for that input
/// (identical, or its word count), so the backstop's effect can be measured.
fn wall_line(app: &App, chat_id: &str, messages: &[Json], text: &str) -> Option<String> {
	let input = short_reply_input(messages)?;
	let words = prose_words(text);
	let mut walls = app.turns.walls.lock();
	if let Some(wall) = walls.get_mut(chat_id).filter(|w| w.input == input) {
		if let Some(noted) = wall.noted.take() {
			let next = if text == noted { "identical".to_owned() } else { format!("{words} words") };
			eprintln!("[reply wall] lesson {chat_id}: the reply after the note is {next}");
		}
		return None;
	}
	if words <= WALL_WORDS {
		return None;
	}
	eprintln!("[reply wall] lesson {chat_id}: noted a reply of {words} words");
	walls.insert(chat_id.to_owned(), Wall { input, noted: Some(text.to_owned()) });
	Some(wall_note(words))
}
