//! search_graph: the lesson looks up its own space's knowledge graph on demand.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::session::schema::{object, string};
use gs_json::Json;

use super::fn_tool::FnTool;

/// Searches the lesson's graph for a query (none: newest facts), giving facts and chains.
pub type SearchGraph = Arc<dyn Fn(Option<String>) -> BoxFuture<'static, Result<Json, String>> + Send + Sync>;

pub fn search_graph_tool(search: SearchGraph) -> FnTool {
	let parameters = object(&[], vec![("query", string("What to look for, plain words (matched by meaning and keywords)."))]);
	let description = "Search this lesson's knowledge graph: what earlier lessons and files taught the learner, as facts (id, name, statement) and the reasoning chains connecting them. No query: most recent facts.";
	FnTool::server("search_graph", description, parameters, move |args, _ctx| {
		let search = search.clone();
		async move { search(args["query"].as_str().map(str::to_owned)).await }
	})
}
