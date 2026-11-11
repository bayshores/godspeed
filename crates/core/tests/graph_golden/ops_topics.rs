//! Topic reads and the write rule that repairs a submitted grouping.

use gs_core::graph::topics::{TopicDraft, repair_topics, resolve_topics, same_fact_set, topic_name_problem};
use gs_json::{Json, json};

fn strings(v: &Json) -> Vec<String> {
	v.as_arr().unwrap().iter().map(|s| s.as_str().unwrap().to_owned()).collect()
}

fn snapshot(v: &Json) -> Option<&Json> {
	(!v.is_null()).then_some(v)
}

pub fn run(op: &str, input: &Json) -> Json {
	match op {
		"resolve_topics" => {
			let facts = strings(&input["factIds"]);
			json!({ "resolved": resolve_topics(snapshot(&input["snapshot"]), &facts), "same": same_fact_set(snapshot(&input["snapshot"]), &facts) })
		}
		"repair_topics" => {
			let drafts: Vec<TopicDraft> = input["drafts"]
				.as_arr()
				.unwrap()
				.iter()
				.map(|d| TopicDraft { id: d["id"].as_str().map(str::to_owned), name: d["name"].as_str().unwrap().to_owned(), members: strings(&d["members"]) })
				.collect();
			let mut counter = 0;
			let topics = repair_topics(&drafts, &strings(&input["factIds"]), input["chains"].as_arr().unwrap(), input["existing"].as_arr().unwrap(), || {
				counter += 1;
				format!("new_{counter}")
			});
			Json::from(topics)
		}
		"topic_names" => input["names"].as_arr().unwrap().iter().map(|n| Json::from(topic_name_problem(n.as_str().unwrap()))).collect(),
		other => panic!("not a topic op: {other}"),
	}
}
