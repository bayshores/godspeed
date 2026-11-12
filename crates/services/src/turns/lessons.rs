//! Lesson creation (lessons.ts): the one place a new lesson record is born (POST /api/chats and
//! MCP start_lesson), so a lesson in a space always opens with its space card. Every new lesson
//! is a study session.
//!
//! Message order at birth: space card, graph-context picks, study plan; the caller then sends the
//! learner's first message. A start from a deadline is recorded on the chat so that deadline's
//! Study button can reopen it.

use std::collections::HashMap;
use std::sync::Arc;

use gs_base::locks::LockKey;
use gs_core::contracts::graph::title_from_prompt;
use gs_core::graph::chains::{chains_for_selection, format_chain_line};
use gs_core::graph::graph::get_graph;
use gs_core::messages::native_messages::{new_space_context_message, new_graph_context_message, new_study_context_message};
use gs_core::study::study::{MAX_STUDY_FACTS, study_context_text, study_plan_tree, study_title};
use gs_json::Json;

use crate::App;
use crate::spaces::space_card::space_card_for;
use crate::graph::graph::graph_store_for;
use crate::graph::progress::{deadline_study_for, study_topics_for, topic_study_for};

/// What a lesson starts from.
pub enum LessonStart {
	/// A typed topic (its title), with any facts picked for it (`{id, name, statement}`).
	Typed { title: String, picks: Vec<Json> },
	/// Some of the space's topics.
	Topics(Vec<String>),
	/// A deadline: its topics for today.
	Deadline(String),
}

pub struct CreateLessonInput {
	/// None is "No space".
	pub space_id: Option<String>,
	pub start: LessonStart,
}

/// A new lesson: `title` is the whole title (the record's may be shortened), the first message.
pub struct Created {
	pub chat: Json,
	pub title: String,
}

/// The 404 refusals: `space_not_found`, `topics_not_found`, `deadline_not_found`.
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
	let scope = input.space_id.as_deref();
	// Held from the space check to the finished lesson: a space delete takes this lock too, so it
	// sees the new lesson, never a lesson born into a space it already removed.
	let _space = scope.map(|id| app.locks.lock(LockKey::Space(id)));
	let cls = match scope {
		None => None,
		Some(id) => match app.stores.spaces.get_space(id) {
			Some(cls) => Some(cls),
			None => return Ok(Err(NotFound { code: "space_not_found", error: "No such space" })),
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
	let space_id = cls.as_ref().and_then(|c| c["id"].as_str());
	let chat = app.stores.chats.create_chat(&title_from_prompt(&start.title), Some("study"), space_id, deadline_id)?;
	let chat_id = chat["id"].as_str().unwrap_or_default().to_owned();
	let mut messages = Vec::new();
	if let Some(cls) = &cls {
		messages.push(new_space_context_message(&space_card_for(app, cls)?));
	}
	if !start.picks.is_empty() {
		// The picks carry what the learner saw; the chains come from the lesson's own space graph.
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
				Some(space_id) => deadline_study_for(app, space_id, deadline_id)?,
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

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_lesson_started_as_its_space_goes_is_not_created() {
		let root = scratch_dir("lesson-space-gone");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&gs_json::json!({ "name": "Algebra" })).unwrap()["id"].as_str().unwrap().to_owned();
		// The delete holds the space while the lesson is started.
		let deleting = app.locks.lock(LockKey::Space(&space_id));
		let (starting, space) = (app.clone(), space_id.clone());
		let started = std::thread::spawn(move || {
			let input = CreateLessonInput { space_id: Some(space), start: LessonStart::Typed { title: "Sets".to_owned(), picks: Vec::new() } };
			create_lesson(&starting, input).unwrap().map(drop)
		});
		std::thread::sleep(std::time::Duration::from_millis(100));
		app.stores.spaces.delete_space(&space_id).unwrap();
		drop(deleting);
		assert_eq!(started.join().unwrap(), Err(NotFound { code: "space_not_found", error: "No such space" }));
		assert!(app.stores.chats.list_chats().is_empty());
	}
}
