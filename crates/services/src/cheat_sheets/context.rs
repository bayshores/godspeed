//! Everything one request needs: the class, the deadline, its topics.

use std::cmp::Ordering;

use gs_base::time::iso_now;
use gs_core::study::cheat_sheet::{ParsedSheet, mistake_counts, new_cheat_sheet, sheet_mistakes};
use gs_core::study::progress::{topic_facts, topic_status};
use gs_json::{Json, json};

use super::{Outcome, refuse};
use crate::App;
use crate::graph::progress::{class_mistakes, class_order_for, progress_for};

/// Facts sent per topic, to keep the request short.
const FACTS_PER_TOPIC: usize = 5;

/// What is saved for the deadline.
pub(super) enum Saved {
	None,
	/// A newer build wrote it: shown, never changed.
	Newer,
	Sheet(Json),
}

pub(super) struct Deadline {
	pub id: String,
	pub name: String,
	pub date: String,
}

pub(super) struct Context {
	pub class_id: String,
	pub class_name: String,
	pub class_notes: String,
	pub info_files: Vec<String>,
	pub deadline: Deadline,
	/// The deadline's topics in class order.
	pub topics: Vec<Json>,
	pub mistakes: Vec<Json>,
	pub saved: Saved,
}

impl Saved {
	/// The saved sheet's working folder, when it has one.
	pub fn folder(&self) -> Option<&str> {
		match self {
			Saved::Sheet(sheet) => sheet["folder"].as_str().filter(|f| !f.is_empty()),
			_ => None,
		}
	}
}

pub(super) fn read_saved(app: &App, class_id: &str, deadline_id: &str) -> Result<Saved, String> {
	Ok(match app.stores.cheat_sheets.read_cheat_sheet(class_id, deadline_id)? {
		None => Saved::None,
		Some(ParsedSheet::Newer) => Saved::Newer,
		Some(ParsedSheet::Sheet(sheet)) => Saved::Sheet(sheet),
	})
}

/// The latest saved sheet, or a new one.
pub(super) fn sheet_now(app: &App, ctx: &Context) -> Result<Json, String> {
	Ok(match read_saved(app, &ctx.class_id, &ctx.deadline.id)? {
		Saved::Sheet(sheet) => sheet,
		_ => new_cheat_sheet(&ctx.deadline.id, &iso_now()),
	})
}

/// A topic's place in the class: its earliest fact (a topic nothing orders sorts last).
fn rank(topic: Option<&Json>, order: &std::collections::HashMap<String, usize>) -> f64 {
	let members = topic.and_then(|t| t["members"].as_arr());
	members.into_iter().flatten().filter_map(Json::as_str).map(|id| order.get(id).map_or(f64::INFINITY, |&n| n as f64)).fold(f64::INFINITY, f64::min)
}

pub(super) fn context_for(app: &App, class_id: &str, deadline_id: &str) -> Outcome<Context> {
	let record = app.stores.classes.get_class(class_id);
	let deadline = record.as_ref().and_then(|r| r["deadlines"].as_arr()).and_then(|all| all.iter().find(|d| d["id"].as_str() == Some(deadline_id)));
	let progress = match (&record, deadline) {
		(Some(_), Some(_)) => progress_for(app, class_id, None)?,
		_ => None,
	};
	let due = progress.as_ref().and_then(|p| p["deadlines"].as_arr()).and_then(|all| all.iter().find(|d| d["id"].as_str() == Some(deadline_id)));
	let (Some(record), Some(deadline), Some(progress), Some(due)) = (&record, deadline, &progress, due) else { return refuse(404, "No such deadline") };

	let all_topics: &[Json] = progress["topics"].as_arr().map_or(&[], |a| a.as_slice());
	let topic_of = |id: &str| all_topics.iter().find(|t| t["id"].as_str() == Some(id));
	let order = class_order_for(app, class_id, progress);
	let mut ids: Vec<String> = due["topicIds"].as_arr().into_iter().flatten().filter_map(|id| id.as_str().map(str::to_owned)).collect();
	// Infinity minus Infinity is NaN in JavaScript, which sorts as equal.
	ids.sort_by(|a, b| rank(topic_of(a), &order).partial_cmp(&rank(topic_of(b), &order)).unwrap_or(Ordering::Equal));
	let all = class_mistakes(app, class_id, progress)?;
	let counts = mistake_counts(&all, &ids);
	let facts: &[Json] = progress["facts"].as_arr().map_or(&[], |a| a.as_slice());
	let mut topics = Vec::with_capacity(ids.len());
	for id in &ids {
		let Some(t) = topic_of(id) else { return Err("Cannot read properties of undefined (reading 'name')".to_owned().into()) };
		let shown: Vec<Json> = topic_facts(facts, t).into_iter().take(FACTS_PER_TOPIC).map(|f| json!({ "name": f["name"], "statement": f["statement"] })).collect();
		topics.push(json!({ "id": id, "name": t["name"], "status": topic_status(t["rate"].as_f64()).as_str(), "mistakes": counts.get(id).copied().unwrap_or(0), "facts": shown }));
	}
	let info_files = record["files"].as_arr().into_iter().flatten().filter(|f| f["kind"].as_str() == Some("info")).filter_map(|f| f["name"].as_str().map(str::to_owned)).collect();
	let text = |v: &Json| v.as_str().unwrap_or("").to_owned();
	Ok(Context {
		class_id: class_id.to_owned(),
		class_name: text(&record["name"]),
		class_notes: text(&record["description"]),
		info_files,
		deadline: Deadline { id: text(&deadline["id"]), name: text(&deadline["name"]), date: text(&deadline["date"]) },
		topics,
		mistakes: sheet_mistakes(&all, &ids),
		saved: read_saved(app, class_id, deadline_id)?,
	})
}
