//! The duplicate check on the extractor's submit: the local search scores each new proposition
//! against the graph's facts and gs_core's rule flags likely copies. No model runs; a search that
//! fails lets the submit through.

use std::sync::Arc;

use gs_core::graph::duplicates::{Fact, find_duplicates};
use gs_json::Json;

use super::extraction::ExtractionHost;
use super::findings::duplicate_notice;
use super::submit_agent::Notice;

/// Nearest facts scored per proposition; the rule shows at most 3.
const SCORED: usize = 5;

/// The check over `scope`'s merged `nodes` (all of them, this source's included).
pub(super) fn duplicate_check(host: Arc<dyn ExtractionHost>, scope: Option<String>, nodes: Arc<Vec<Json>>) -> Notice {
	Box::new(move |value| {
		let (host, scope, nodes, value) = (host.clone(), scope.clone(), nodes.clone(), value.clone());
		Box::pin(async move {
			let propositions = value["propositions"].items();
			if propositions.is_empty() || nodes.is_empty() {
				return None;
			}
			let scores = match host.similar_facts(scope.as_deref(), &nodes, propositions, SCORED).await {
				Ok(scores) => scores,
				Err(err) => {
					eprintln!("[extraction] duplicate check skipped: {err}");
					return None;
				}
			};
			let new: Vec<Fact> = propositions.iter().map(Fact::of).collect();
			let existing: Vec<Fact> = nodes.iter().map(Fact::of).collect();
			let found = find_duplicates(&new, &existing, &scores);
			(!found.is_empty()).then(|| duplicate_notice(&found))
		})
	})
}
