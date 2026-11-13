//! The map readers: the prober and practice read the learner's
//! knowledge graph on demand. Names, kinds, counts and dates only, never statement text.

use std::sync::Arc;

use gs_core::graph::graph::{graph_session_index, graph_session_propositions};
use gs_core::graph::ports::{GraphDeps, GraphStore};
use gs_json::{Json, js_number};

use super::fn_tool::FnTool;
use super::ports::ChatPort;
use gs_core::session::schema::{no_arguments, object, string_min};

/// One space graph a lesson may read, named, with `own` marking the lesson's space.
#[derive(Clone)]
pub struct ScopedGraph {
	pub space_name: String,
	pub graph_store: Arc<dyn GraphStore>,
	pub own: bool,
}

/// What the graph tools close over: the stores the session views read.
#[derive(Clone)]
pub struct GraphToolContext {
	pub chat_store: Arc<dyn ChatPort>,
	pub graph_store: Arc<dyn GraphStore>,
	/// Every space graph plus "No space" (reads may cross spaces, writes never do). With it the
	/// tools read across all of them; without it, the one graph store.
	pub graphs: Option<Arc<dyn Fn() -> Vec<ScopedGraph> + Send + Sync>>,
}

const EMPTY_GRAPH: &str = "The knowledge graph is empty \u{2014} no session has contributed propositions yet.";

/// A session's line without its space tag or id: name, kind, count and dates.
fn session_facts(session: &Json) -> String {
	let count = session["propositions"].as_f64().unwrap_or(0.0);
	let born = session["createdAt"].as_str().unwrap_or("unknown date");
	let active = session["updatedAt"].as_str().filter(|s| !s.is_empty()).map(|u| format!(", last active {u}")).unwrap_or_default();
	format!("{} ({}, {} proposition{}, born {born}{active})", session["name"].as_str().unwrap_or_default(), session["kind"].as_str().unwrap_or_default(), js_number(count), if count == 1.0 { "" } else { "s" })
}

fn sessions_of(chat_store: &Arc<dyn ChatPort>, graph_store: &Arc<dyn GraphStore>) -> Result<Vec<Json>, String> {
	graph_session_index(&GraphDeps { chat_store: chat_store.as_ref(), graph_store: graph_store.as_ref() })
}

fn propositions_of(chat_store: &Arc<dyn ChatPort>, graph_store: &Arc<dyn GraphStore>, session: &str) -> Result<Vec<Json>, String> {
	graph_session_propositions(&GraphDeps { chat_store: chat_store.as_ref(), graph_store: graph_store.as_ref() }, session)
}

/// list_sessions across spaces: the lesson's own space first, then the others, each line
/// tagged with its space.
fn list_across_spaces(chat_store: &Arc<dyn ChatPort>, graphs: &[ScopedGraph]) -> Result<String, String> {
	let ordered = graphs.iter().filter(|g| g.own).chain(graphs.iter().filter(|g| !g.own));
	let mut lines: Vec<String> = Vec::new();
	for g in ordered {
		for s in sessions_of(chat_store, &g.graph_store)? {
			let own = if g.own { " (this lesson's space)" } else { "" };
			lines.push(format!("{}. {} \u{2014} space: {}{own} \u{2014} id: {}", lines.len() + 1, session_facts(&s), g.space_name, s["id"].as_str().unwrap_or_default()));
		}
	}
	if lines.is_empty() {
		return Ok(EMPTY_GRAPH.to_owned());
	}
	Ok(format!("{} session(s) across the learner's spaces (this lesson's space first, then the others; most recent first within each):\n{}", lines.len(), lines.join("\n")))
}

fn list_sessions_tool(ctx: &GraphToolContext) -> FnTool {
	let ctx = ctx.clone();
	let description = "List the sessions of the learner's persistent knowledge graph \u{2014} every chat or imported-notes file that ever contributed a proposition, most recent first. The map is organized into birth-session clusters (propositions grouped by the session they were first learned in), and session names are those clusters' labels. \
		Each line: the session's name, kind (chat/file), how many propositions were born in it, its dates, and its id \u{2014} use that id with list_propositions. \
		Reading this first shows what he has already covered and when, before you probe anything.";
	FnTool::server("list_sessions", description, no_arguments(), move |_args, _ctx| {
		let ctx = ctx.clone();
		async move {
			if let Some(graphs) = &ctx.graphs {
				return list_across_spaces(&ctx.chat_store, &graphs()).map(Json::from);
			}
			let sessions = sessions_of(&ctx.chat_store, &ctx.graph_store)?;
			if sessions.is_empty() {
				return Ok(Json::from(EMPTY_GRAPH));
			}
			let lines: Vec<String> = sessions.iter().enumerate().map(|(i, s)| format!("{}. {} \u{2014} id: {}", i + 1, session_facts(s), s["id"].as_str().unwrap_or_default())).collect();
			Ok(Json::from(format!("{} session(s) in the knowledge graph, most recent first:\n{}", sessions.len(), lines.join("\n"))))
		}
	})
}

fn list_propositions_tool(ctx: &GraphToolContext) -> FnTool {
	let ctx = ctx.clone();
	let parameters = object(&["session"], vec![("session", string_min(1, "The session's id exactly as list_sessions reported it (a chat id or a notes source id)"))]);
	let description = "List the propositions BORN in one knowledge-graph session \u{2014} what was covered there. \
		Names only \u{2014} no statement text, no session contents (the map's ORGANIZATION is your business, its prose is not).";
	FnTool::server("list_propositions", description, parameters, move |args, _ctx| {
		let ctx = ctx.clone();
		async move {
			let session = args["session"].as_str().unwrap_or_default();
			// The session lives in exactly one space graph.
			let mut propositions: Vec<Json> = Vec::new();
			for g in ctx.graphs.iter().flat_map(|graphs| graphs()) {
				propositions = propositions_of(&ctx.chat_store, &g.graph_store, session)?;
				if !propositions.is_empty() {
					break;
				}
			}
			if propositions.is_empty() {
				propositions = propositions_of(&ctx.chat_store, &ctx.graph_store, session)?;
			}
			if propositions.is_empty() {
				return Ok(Json::from(format!("No propositions born in session \"{session}\". Call list_sessions for the current ids.")));
			}
			let lines: Vec<String> = propositions.iter().map(|p| format!("- {}", p["name"].as_str().unwrap_or_default())).collect();
			Ok(Json::from(format!("{} proposition(s) covered in this session:\n{}", propositions.len(), lines.join("\n"))))
		}
	})
}

/// list_sessions and list_propositions.
pub fn prober_graph_tools(ctx: &GraphToolContext) -> Vec<FnTool> {
	vec![list_sessions_tool(ctx), list_propositions_tool(ctx)]
}
