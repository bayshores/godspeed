//! Lesson creation (lessons.ts): the one place a new lesson record is born (POST /api/chats and
//! MCP start_lesson), so a lesson in a class always opens with its class card. Every new lesson
//! is a study session.
//!
//! Message order at birth: class card, graph-context picks, study plan; the caller then sends the
//! learner's first message. A start from a deadline is recorded on the chat so that deadline's
//! Study button can reopen it.

use std::collections::HashMap;
use std::sync::Arc;

use gs_core::contracts::graph::title_from_prompt;
use gs_core::graph::chains::{chains_for_selection, format_chain_line};
use gs_core::graph::graph::get_graph;
use gs_core::messages::native_messages::{new_class_context_message, new_graph_context_message, new_study_context_message};
use gs_core::study::study::{MAX_STUDY_FACTS, study_context_text, study_plan_tree, study_title};
use gs_json::Json;

use crate::App;
use crate::classes::class_card::class_card_for;
use crate::graph::graph::graph_store_for;
use crate::graph::progress::{deadline_study_for, study_topics_for, topic_study_for};

/// What a lesson starts from.
pub enum LessonStart {
	/// A typed topic (its title), with any facts picked for it (`{id, name, statement}`).
	Typed { title: String, picks: Vec<Json> },
	/// Some of the class's topics.
	Topics(Vec<String>),
	/// A deadline: its topics for today.
	Deadline(String),
}

pub struct CreateLessonInput {
	/// None is "No class".
	pub class_id: Option<String>,
	pub start: LessonStart,
}

/// A new lesson: `title` is the whole title (the record's may be shortened), the first message.
pub struct Created {
	pub chat: Json,
	pub title: String,
}

/// The 404 refusals: `class_not_found`, `topics_not_found`, `deadline_not_found`.
#[derive(Debug, PartialEq)]
pub struct NotFound {
	pub code: &'static str,
	pub error: &'static str,
}

struct Start {
	title: String,
	picks: Vec<Json>,
	topics: Vec<Json>,
}

pub fn create_lesson(app: &Arc<App>, input: CreateLessonInput) -> Result<Result<Created, NotFound>, String> {
	let scope = input.class_id.as_deref();
	let cls = match scope {
		None => None,
		Some(id) => match app.stores.classes.get_class(id) {
			Some(cls) => Some(cls),
			None => return Ok(Err(NotFound { code: "class_not_found", error: "No such class" })),
		},
	};
	let start = match start_of(app, scope, &input.start)? {
		Ok(start) => start,
		Err(not_found) => return Ok(Err(not_found)),
	};
	let deadline_id = match &input.start {
		LessonStart::Deadline(id) => Some(id.as_str()),
		_ => None,
	};
	let class_id = cls.as_ref().and_then(|c| c["id"].as_str());
	let chat = app.stores.chats.create_chat(&title_from_prompt(&start.title), Some("study"), class_id, deadline_id)?;
	let chat_id = chat["id"].as_str().unwrap_or_default().to_owned();
	let mut messages = Vec::new();
	if let Some(cls) = &cls {
		messages.push(new_class_context_message(&class_card_for(app, cls)?));
	}
	if !start.picks.is_empty() {
		// The picks carry what the learner saw; the chains come from the lesson's own class graph.
		let graph = get_graph(graph_store_for(app, scope).as_ref())?;
		let by_id: HashMap<&str, &Json> = graph.nodes.iter().filter_map(|n| Some((n["id"].as_str()?, n))).collect();
		let names: HashMap<String, String> = by_id.iter().map(|(id, n)| ((*id).to_owned(), n["name"].as_str().unwrap_or_default().to_owned())).collect();
		let picked: Vec<Json> = start.picks.iter().filter_map(|p| by_id.get(p["id"].as_str()?).map(|n| (*n).clone())).collect();
		let lines: Vec<String> = chains_for_selection(&picked, &graph.chains)
			.iter()
			.map(|c| {
				let premises: Vec<&str> = c["premises"].as_arr().into_iter().flatten().filter_map(Json::as_str).collect();
				format_chain_line(&premises, c["conclusion"].as_str().unwrap_or_default(), &names)
			})
			.collect();
		messages.push(new_graph_context_message(&start.picks, &lines));
	}
	messages.push(new_study_context_message(&study_context_text(&start.topics), "study-context"));
	app.stores.chats.save_messages(&chat_id, &messages)?;
	app.stores.chats.save_tree(&chat_id, &study_plan_tree(&start.topics)?)?;
	let chat = app.stores.chats.get_chat(&chat_id).unwrap_or(chat);
	Ok(Ok(Created { chat, title: start.title }))
}

/// The session's title, picks and topics for each kind of start.
fn start_of(app: &Arc<App>, scope: Option<&str>, start: &LessonStart) -> Result<Result<Start, NotFound>, String> {
	Ok(match start {
		LessonStart::Topics(topic_ids) => {
			let study = topic_study_for(app, scope, topic_ids)?;
			if study.topics.is_empty() {
				return Ok(Err(NotFound { code: "topics_not_found", error: "No such topics" }));
			}
			Ok(Start { title: study_title(&study.topics), picks: study.picks, topics: study.topics })
		}
		LessonStart::Deadline(deadline_id) => {
			let deadline = match scope {
				Some(class_id) => deadline_study_for(app, class_id, deadline_id)?,
				None => None,
			};
			let Some(deadline) = deadline else {
				return Ok(Err(NotFound { code: "deadline_not_found", error: "No such deadline" }));
			};
			// A deadline with no topics yet is studied by name.
			if deadline.topics.is_empty() {
				return Ok(Ok(typed(app, scope, &format!("Study for {}", deadline.name), Vec::new())?));
			}
			Ok(Start { title: study_title(&deadline.topics), picks: deadline.picks, topics: deadline.topics })
		}
		LessonStart::Typed { title, picks } => Ok(typed(app, scope, gs_base::text::trim(title), picks.iter().take(MAX_STUDY_FACTS).cloned().collect())?),
	})
}

/// A typed topic: its picked facts grouped into topics, or the one topic it names. Picked facts
/// with nothing typed are titled after their topics.
fn typed(app: &Arc<App>, scope: Option<&str>, title: &str, picks: Vec<Json>) -> Result<Start, String> {
	let fact_ids: Vec<String> = picks.iter().filter_map(|p| p["id"].as_str().map(str::to_owned)).collect();
	let topics = study_topics_for(app, scope, &fact_ids, &title_from_prompt(if title.is_empty() { "Untitled session" } else { title }))?;
	let title = if !title.is_empty() {
		title.to_owned()
	} else if !picks.is_empty() {
		study_title(&topics)
	} else {
		"Untitled session".to_owned()
	};
	Ok(Start { title, picks, topics })
}
