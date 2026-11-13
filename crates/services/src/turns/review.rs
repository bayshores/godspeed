//! Questions from earlier in a Study lesson: the next one to show, his answer and his skip.
//! godspeed asks them by itself and the window grades them, so none wakes the agent. An answer is
//! written to the lesson at once, even while a turn runs, and reaches the agent as one
//! [From earlier] line with his next input. A skip stores nothing: skipped questions are kept in
//! memory until the sitting ends. The open question is the next pick, so a reload shows the same
//! one.

use std::collections::HashSet;

use gs_base::events::EventKind;
use gs_base::locks::LockKey;
use gs_base::{clock, time};
use gs_core::messages::input_events::stamped_quiz_answer;
use gs_core::messages::lesson_markers::new_review_marker;
use gs_core::study::review::{ReviewSitting, ReviewSpace, item_key, pick_reviews, review_window_open, teaching_topics};
use gs_core::study::topic_end::{SITTING_GAP_MS, sitting_start};
use gs_json::{Json, json};

use super::turn_liveness::is_turn_running;
use crate::App;
use crate::app::agent_actions::record_answer;
use crate::graph::progress::{progress_for, space_order_for, space_reviews};

/// The questions from earlier skipped in a lesson's sitting, and when the last one was.
pub(crate) struct Skips {
	keys: HashSet<String>,
	at: i64,
}

/// What a request about a question from earlier got.
#[derive(Debug, PartialEq)]
pub enum ReviewReply {
	/// The question to show now (`{of, nodeId, topic, quiz}`), or none.
	Next(Option<Json>),
	/// The answer was written, or the skip noted.
	Done,
	UnknownLesson,
	/// The question named is not one this sitting may ask any more.
	NotOpen,
	/// The answer is not a graded quiz answer with a pick, or I don't know.
	NotAnAnswer,
}

fn times(record: &Json) -> Vec<f64> {
	record["messages"].as_arr().into_iter().flatten().filter_map(|m| m["timestamp"].as_f64()).collect()
}

/// The questions skipped in this sitting; ones from an ended sitting are forgotten.
fn skipped(app: &App, chat_id: &str, record: &Json, now: i64) -> HashSet<String> {
	let mut skips = app.turns.review_skips.lock();
	let newest = times(record).into_iter().fold(f64::NEG_INFINITY, f64::max);
	let ended = skips.get(chat_id).is_some_and(|s| (now as f64) - newest.max(s.at as f64) >= SITTING_GAP_MS);
	if ended {
		skips.remove(chat_id);
	}
	skips.get(chat_id).map(|s| s.keys.clone()).unwrap_or_default()
}

/// The open question from earlier in a Study lesson of a space: the next pick for this sitting,
/// whether or not the window may show one now.
pub fn open_question(app: &App, chat_id: &str, record: &Json) -> Result<Option<Json>, String> {
	Ok(sitting_picks(app, chat_id, record)?.into_iter().next())
}

/// The question from earlier `of` names while it is still one this sitting may ask. The one on
/// screen may have moved down the picks since it was served (a skip forgotten, a topic stopped,
/// midnight), and is still his to answer, skip or ask about.
pub fn askable(app: &App, chat_id: &str, record: &Json, of: &Json) -> Result<Option<Json>, String> {
	Ok(sitting_picks(app, chat_id, record)?.into_iter().find(|q| item_key(&q["of"]) == item_key(of)))
}

/// The questions from earlier this sitting may ask, the next one first.
fn sitting_picks(app: &App, chat_id: &str, record: &Json) -> Result<Vec<Json>, String> {
	let Some(space_id) = record["spaceId"].as_str().filter(|_| record["kind"].as_str() == Some("study")) else { return Ok(Vec::new()) };
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(Vec::new()) };
	let order = space_order_for(app, space_id, &progress);
	let rank = |t: &Json| t["members"].as_arr().into_iter().flatten().filter_map(|m| m.as_str().and_then(|id| order.get(id))).min().copied().unwrap_or(usize::MAX);
	let mut topics: Vec<Json> = progress["topics"].as_arr().cloned().unwrap_or_default();
	topics.sort_by_key(rank);
	let reviews = space_reviews(app, space_id);
	let (teaching, skipped) = (teaching_topics(record), skipped(app, chat_id, record, clock::now_ms()));
	let space = ReviewSpace {
		today: progress["today"].str_or_empty(),
		topics: &topics,
		links: progress["topicLinks"].as_arr().map_or(&[], Vec::as_slice),
		deadlines: progress["deadlines"].as_arr().map_or(&[], Vec::as_slice),
		answers: &reviews.answers,
		outcomes: &reviews.outcomes,
		items: &reviews.items,
	};
	Ok(pick_reviews(&space, &ReviewSitting { teaching: &teaching, deadline_id: record["deadlineId"].as_str(), skipped: &skipped }))
}

/// The question from earlier to show now: the one he asked the teacher about in this sitting
/// while it is still askable, since the agent was told it stays open; otherwise one only in the
/// sitting's first wait while the teacher reads or writes or no agent is teaching, with nothing
/// else open.
pub fn next_review(app: &App, chat_id: &str) -> Result<ReviewReply, String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(ReviewReply::UnknownLesson) };
	let now = clock::now_ms();
	if let Some(of) = asked_this_sitting(&record, now)
		&& let Some(question) = askable(app, chat_id, &record, of)?
	{
		return Ok(ReviewReply::Next(Some(question)));
	}
	let busy = is_turn_running(app, chat_id) || !app.bridge.agent_teaching(now);
	if !review_window_open(&record, now, busy) {
		return Ok(ReviewReply::Next(None));
	}
	Ok(ReviewReply::Next(open_question(app, chat_id, &record)?))
}

/// The question from earlier he last asked the teacher about in this sitting. Once answered or
/// skipped it is no longer askable.
fn asked_this_sitting(record: &Json, now: i64) -> Option<&Json> {
	let start = sitting_start(&times(record), now as f64);
	let sitting = record["messages"].as_arr().into_iter().flatten().rev().take_while(|m| m["timestamp"].as_f64().is_some_and(|t| t >= start));
	sitting.filter(|m| m["customType"].as_str() == Some("app-note")).map(|m| &m["details"]["reviewOf"]).find(|of| of.as_obj().is_some())
}

/// His answer to a question from earlier still askable, as the window graded it: written as a
/// `review` marker with the server's clock and the start of his sitting, and counted in the
/// activity feed like any quiz answer of the lesson. Err: the lesson could not be saved.
pub fn answer_review(app: &App, chat_id: &str, of: &Json, answer: &Json) -> Result<ReviewReply, String> {
	let graded = answer["dontKnow"].truthy() || answer["correct"].as_bool().is_some();
	let Some(stamped) = stamped_quiz_answer(answer).filter(|_| graded && !answer["dismissed"].truthy()) else { return Ok(ReviewReply::NotAnAnswer) };
	let record = {
		let _guard = app.locks.lock(LockKey::Chat(chat_id));
		let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(ReviewReply::UnknownLesson) };
		let Some(question) = askable(app, chat_id, &record, of)? else { return Ok(ReviewReply::NotOpen) };
		let mut details = question;
		if let Some(d) = details.as_obj_mut() {
			d.insert("answer", stamped);
			d.insert("sitting", time::iso(sitting_start(&times(&record), clock::now_ms() as f64) as i64));
		}
		let mut messages = record["messages"].as_arr().cloned().unwrap_or_default();
		messages.push(new_review_marker(details));
		app.stores.chats.save_messages(chat_id, &messages)?;
		record
	};
	record_answer(app, &record, answer);
	app.events.emit(EventKind::RecordChanged, json!({ "chatId": chat_id }));
	Ok(ReviewReply::Done)
}

/// Skip question on a question from earlier still askable: nothing is stored, and the next pick
/// passes it by until the sitting ends.
pub fn skip_review(app: &App, chat_id: &str, of: &Json) -> Result<ReviewReply, String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(ReviewReply::UnknownLesson) };
	if askable(app, chat_id, &record, of)?.is_none() {
		return Ok(ReviewReply::NotOpen);
	}
	let now = clock::now_ms();
	let mut skips = app.turns.review_skips.lock();
	let entry = skips.entry(chat_id.to_owned()).or_insert_with(|| Skips { keys: HashSet::new(), at: now });
	entry.keys.insert(item_key(of));
	entry.at = now;
	Ok(ReviewReply::Done)
}
