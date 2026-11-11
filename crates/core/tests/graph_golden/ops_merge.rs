//! Merging extraction findings into the ledgers. Fresh ids and run times differ on every run, so
//! the result is renamed before it is compared (compare::normalise).

use std::collections::HashSet;

use gs_core::graph::graph::{MergeSource, merge_findings};
use gs_json::{Json, json};

use crate::compare::{normalise, strings_of};
use crate::ledgers::Ledgers;

pub fn run(input: &Json) -> Json {
	let ledgers = Ledgers::load(&input["ledgers"]);
	let store = ledgers.store();
	let steps = input["steps"].as_arr().unwrap();
	let results: Json = steps
		.iter()
		.map(|step| {
			let source = &step["source"];
			let source = MergeSource { folded_at: source["foldedAt"].as_str().unwrap().to_owned(), coverage: source["coverage"].as_arr().cloned() };
			merge_findings(step["chatId"].as_str().unwrap(), &step["findings"], &store, &source).unwrap_or_else(|message| json!({ "error": message }))
		})
		.collect();
	let mut known = HashSet::new();
	strings_of(&Json::Obj(ledgers.0.clone()), &mut known);
	strings_of(&input["steps"], &mut known);
	normalise(&json!({ "results": results, "ledgers": store.marks(), "rewrites": store.rewrite_log() }), &known)
}
