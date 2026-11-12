//! The topic grouper (topic-grouper.ts): one model call that groups a space graph's facts into the
//! topics a learner would name, on the single-submit seam. Names of 1-4 words are checked here so
//! the model retries; every fact in exactly one topic is repaired after (core topics); the
//! scheduling lives in the graph service.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::{ids, text};
use gs_core::contracts::graph::TOPIC_MATERIALS;
use gs_core::graph::topics::{TopicDraft, repair_topics, topic_name_problem};
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_json::{Json, json, stringify_pretty};

use super::submit_agent::{SubmitAgentOptions, run_submit_agent};
use crate::subagents::pi_run::RunError;

/// The core grouping instruction, approved word for word: keep the wording.
pub const TOPIC_GROUPING_RULE: &str = "Group these facts into the topics a learner would name when studying this space: 4\u{2013}20 facts per topic, a 1\u{2013}4 word name in the space's own terms (\"Expected value\", \"Conditional probability\"). Keep existing topics and names stable; only add, split, or merge when facts don't fit. Every fact goes in exactly one topic.";

pub fn topic_grouper_instructions() -> String {
	format!(
		"You are the topic grouper of a learning app. You receive the facts of one space's knowledge graph (id, name, statement) and the space's current topics, if any.\n\n{TOPIC_GROUPING_RULE}\n\nAlso give each topic its material, the main work it asks of a learner: term (definitions, names, notation or values to know by heart), procedure (a method run in steps to reach an answer), concept (an idea to understand and tell apart from look-alikes) or proof (arguments to follow and write).\n\nSubmit the whole grouping with one submit_topics call. For a topic that already exists, keep its id; leave id out for a new topic. Members are fact ids from the list."
	)
}

fn submit_schema() -> Json {
	json!({
		"type": "object",
		"required": ["topics"],
		"properties": {
			"topics": {
				"type": "array",
				"items": {
					"type": "object",
					"required": ["name", "members"],
					"properties": {
						"id": { "type": "string", "description": "The existing topic's id (tpc_\u{2026}) when keeping a topic; leave out for a new one." },
						"name": { "type": "string", "description": "1\u{2013}4 words, in the space's own terms." },
						"members": { "type": "array", "items": { "type": "string" }, "description": "The ids of the facts in this topic." },
						// Any string, so one off-list label can't bounce the whole grouping; drafts() keeps the known ones.
						"material": { "type": "string", "description": "The main work this topic asks: term, procedure, concept or proof." },
					},
				},
				"description": "Every topic. Every fact id appears in exactly one topic.",
			},
		},
	})
}

pub struct TopicGrouperInput {
	/// The space's display name (prompt and work-item label).
	pub space_name: String,
	/// `{ id, name, statement }` each.
	pub facts: Vec<Json>,
	pub chains: Vec<Json>,
	/// The current topics (`{ id, name, members[, material] }`), members already limited to live facts.
	pub current: Vec<Json>,
	/// None: the outside agent.
	pub engine: Option<Engine>,
	pub abort: Option<Abort>,
}

static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));

/// The facts one per line, then the current topics as JSON.
pub fn topic_grouper_prompt(space_name: &str, facts: &[Json], current: &[Json]) -> String {
	let lines: Vec<String> = facts.iter().map(|f| format!("{} | {} | {}", f["id"].str_or_empty(), f["name"].str_or_empty(), SPACES.replace(f["statement"].str_or_empty(), " "))).collect();
	let current = if current.is_empty() {
		"(none yet \u{2014} this is the first grouping)".to_owned()
	} else {
		let topics: Vec<Json> = current.iter().map(|t| json!({ "id": t["id"], "name": t["name"], "members": t["members"] })).collect();
		stringify_pretty(&Json::Arr(topics), " ")
	};
	format!("Space: {space_name}\n\nFacts ({}) \u{2014} id | name | statement:\n{}\n\nCurrent topics:\n{current}", facts.len(), lines.join("\n"))
}

/// Names that are empty or longer than 4 words, and an empty grouping, go back to the model.
fn grouping_problem(value: &Json) -> Option<String> {
	let topics = value["topics"].as_arr().map_or(&[][..], Vec::as_slice);
	let mut problems: Vec<String> = topics.iter().filter_map(|t| topic_name_problem(t["name"].str_or_empty())).collect();
	if topics.is_empty() {
		problems.push("Submit at least one topic.".to_owned());
	}
	(!problems.is_empty()).then(|| problems.join(" "))
}

/// The submitted topics, each with its material only when it is one of the four.
fn drafts(submitted: &Json) -> Vec<TopicDraft> {
	submitted["topics"]
		.as_arr()
		.into_iter()
		.flatten()
		.map(|t| TopicDraft {
			id: t["id"].as_str().map(str::to_owned),
			name: t["name"].str_or_empty().to_owned(),
			members: t["members"].as_arr().into_iter().flatten().map(|m| m.str_or_empty().to_owned()).collect(),
			material: t["material"].as_str().and_then(|m| {
				let m = text::trim(m).to_lowercase();
				TOPIC_MATERIALS.iter().find(|known| **known == m).map(|known| (*known).to_owned())
			}),
		})
		.collect()
}

/// Asks the model for a grouping, then repairs it so every current fact is in exactly one topic.
pub async fn group_topics(bridge: &Bridge, input: TopicGrouperInput) -> Result<Vec<Json>, RunError> {
	let prompt = topic_grouper_prompt(&input.space_name, &input.facts, &input.current);
	let mut opts = SubmitAgentOptions::new("submit_topics", "Submit the full topic grouping for the space's facts.", submit_schema(), topic_grouper_instructions(), Json::from(prompt), "the topic grouper never submitted topics");
	opts.task_label = Some(format!("Topic grouping: {}", input.space_name));
	opts.validate = Some(Box::new(|value| {
		let problem = grouping_problem(value);
		Box::pin(async move { problem })
	}));
	opts.engine = input.engine;
	opts.abort = input.abort;
	let submitted = run_submit_agent(bridge, opts).await?;
	let fact_ids: Vec<String> = input.facts.iter().map(|f| f["id"].str_or_empty().to_owned()).collect();
	Ok(repair_topics(&drafts(&submitted), &fact_ids, &input.chains, &input.current, || ids::uuid_hex("tpc", 10)))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_prompt_lists_facts_then_current_topics() {
		let facts = vec![json!({ "id": "n_1", "name": "A", "statement": "x\n y" })];
		assert_eq!(topic_grouper_prompt("Algo", &facts, &[]), "Space: Algo\n\nFacts (1) \u{2014} id | name | statement:\nn_1 | A | x y\n\nCurrent topics:\n(none yet \u{2014} this is the first grouping)");
		let current = vec![json!({ "id": "tpc_1", "name": "S", "members": ["n_1"], "extra": 1 })];
		assert!(topic_grouper_prompt("Algo", &facts, &current).ends_with("Current topics:\n[\n {\n  \"id\": \"tpc_1\",\n  \"name\": \"S\",\n  \"members\": [\n   \"n_1\"\n  ]\n }\n]"));
	}

	#[test]
	fn drafts_keep_only_known_materials_lower_cased() {
		let submitted = json!({ "topics": [
			{ "name": "A", "members": ["n_1"], "material": "proof" },
			{ "name": "B", "members": [], "material": " Procedure " },
			{ "name": "C", "members": [], "material": "essay" },
			{ "name": "D", "members": [] },
		] });
		let got: Vec<Option<String>> = drafts(&submitted).into_iter().map(|d| d.material).collect();
		assert_eq!(got, [Some("proof".to_owned()), Some("procedure".to_owned()), None, None]);
	}

	#[test]
	fn the_instructions_ask_for_each_topics_material() {
		assert!(topic_grouper_instructions().contains("\n\nAlso give each topic its material, the main work it asks of a learner: term ("));
	}

	#[test]
	fn bad_names_and_empty_groupings_are_refused() {
		assert_eq!(grouping_problem(&json!({ "topics": [] })).unwrap(), "Submit at least one topic.");
		let long = grouping_problem(&json!({ "topics": [{ "name": "A name that is far too long" }, { "name": "  " }] })).unwrap();
		assert!(long.starts_with("\"A name that is far too long\" has 7 words"));
		assert!(long.contains("A topic name is empty"));
		assert_eq!(grouping_problem(&json!({ "topics": [{ "name": "Sorting" }] })), None);
	}
}
