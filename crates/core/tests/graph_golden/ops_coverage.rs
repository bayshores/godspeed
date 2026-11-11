//! Extraction coverage: view lines, fingerprints, slots, what is uncovered and the token-budgeted runs.

use gs_core::graph::coverage::{batch_runs, coverage_of, coverage_slots, message_fingerprint, message_view_lines};
use gs_core::messages::native_messages::failed_output_call_ids;
use gs_json::{Json, json};

use crate::ledgers::transcript;

fn id_of(message: &Json) -> &str {
	message["id"].as_str().unwrap_or("")
}

pub fn run(input: &Json) -> Json {
	let messages: Vec<Json> = match input["messages"].as_str() {
		Some(id) => transcript(id),
		None => input["messages"].as_arr().unwrap().clone(),
	};
	let (entries, chat_id) = (input["entries"].as_arr().unwrap(), input["chatId"].as_str().unwrap());
	let failed = failed_output_call_ids(&messages);
	let each = |f: &dyn Fn(&Json) -> Json| -> Json { messages.iter().map(f).collect() };
	let lines = |m: &Json, failed: Option<&_>| -> Json { message_view_lines(m, id_of(m), failed).into_iter().map(Json::from).collect() };

	let slots = coverage_slots(&messages);
	let cov = coverage_of(&messages, entries, chat_id);
	let runs: Json = input["budgets"]
		.as_arr()
		.unwrap()
		.iter()
		.map(|b| {
			let budget = b.as_f64().unwrap();
			let by_id: Json = batch_runs(&cov.slots, &cov.uncovered, budget).iter().map(|run| run.iter().map(|s| Json::from(id_of(s.message))).collect::<Json>()).collect();
			json!({ "budget": budget, "runs": by_id })
		})
		.collect();
	json!({
		"viewLines": each(&|m| lines(m, None)),
		"viewLinesFailed": each(&|m| lines(m, Some(&failed))),
		"fingerprints": each(&|m| Json::from(message_fingerprint(m, None))),
		"fingerprintsFailed": each(&|m| Json::from(message_fingerprint(m, Some(&failed)))),
		"slots": slots.iter().map(|s| json!({ "fp": s.fp, "tokens": s.tokens })).collect::<Json>(),
		"uncovered": cov.uncovered.iter().map(|i| Json::from(*i)).collect::<Json>(),
		"totals": json!({
			"coveredTokens": cov.covered_tokens,
			"uncoveredTokens": cov.uncovered_tokens,
			"coveredCount": cov.covered_count,
			"uncoveredCount": cov.uncovered_count,
		}),
		"runs": runs,
	})
}
