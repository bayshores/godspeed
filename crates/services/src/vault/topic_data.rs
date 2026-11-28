//! What the server knows about each topic of a space that a note holds: its standing, its answer
//! count, when it comes back from earlier, its facts and the deadlines that cover it.

use gs_core::study::progress::TopicStatus;
use gs_core::study::review::next_review_day;
use gs_json::Json;

use crate::App;
use crate::graph::progress::{progress_for, space_reviews};

pub(crate) struct TopicFacts {
	pub id: String,
	pub name: String,
	pub status: TopicStatus,
	/// The topic's own standing color, as Progress draws it.
	pub color: String,
	/// "2 of 3 right", or "none yet".
	pub answered: String,
	pub next_review: Option<String>,
	pub facts: Vec<String>,
	/// The names of the open deadlines that cover it.
	pub deadlines: Vec<String>,
}

/// The grouped topics of a space; None when the space does not exist.
pub(crate) fn space_topics(app: &App, space_id: &str) -> Result<Option<Vec<TopicFacts>>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(None) };
	let reviews = space_reviews(app, space_id);
	let open: Vec<&Json> = progress["deadlines"].items().iter().filter(|d| !d["done"].truthy()).collect();
	let topics = progress["topics"].items().iter().filter(|t| !t["ungrouped"].truthy()).map(|t| {
		let id = t["id"].str_or_empty();
		let covering: Vec<&&Json> = open.iter().filter(|d| d["topicIds"].items().iter().any(|x| x.as_str() == Some(id))).collect();
		let close = covering.iter().filter_map(|d| d["daysUntil"].as_i64()).filter(|n| *n >= 1).min();
		let (answered, right) = (t["answered"].as_i64().unwrap_or(0), t["right"].as_i64().unwrap_or(0));
		TopicFacts {
			id: id.to_owned(),
			name: t["name"].str_or_empty().to_owned(),
			status: TopicStatus::parse(t["status"].str_or_empty()).unwrap_or(TopicStatus::Untested),
			color: t["color"].str_or_empty().to_owned(),
			answered: if answered > 0 { format!("{right} of {answered} right") } else { "none yet".to_owned() },
			next_review: next_review_day(&reviews.answers, &reviews.outcomes, id, close),
			facts: progress["facts"].items().iter().filter(|f| f["topicId"].as_str() == Some(id)).map(|f| f["id"].str_or_empty().to_owned()).collect(),
			deadlines: covering.iter().map(|d| d["name"].str_or_empty().to_owned()).collect(),
		}
	});
	Ok(Some(topics.collect()))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn an_unknown_space_has_no_topics() {
		let root = scratch_dir("vault-topics-none");
		let app = test_app(&root);
		assert!(space_topics(&app, "space_nope").unwrap().is_none());
	}

	#[test]
	fn a_space_without_answers_has_untested_topics_only() {
		let root = scratch_dir("vault-topics");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].as_str().unwrap().to_owned();
		assert!(space_topics(&app, &space_id).unwrap().unwrap().is_empty());
	}
}
