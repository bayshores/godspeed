//! search_graph and import_notes: a space's knowledge graph, read and added to directly.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use gs_agent::extraction::extraction::NotesImportInput;
use gs_agent::extraction::ledgers::ScopedGraph;
use gs_base::locale;
use gs_base::re::Re;
use gs_core::contracts::space::safe_name;
use gs_core::graph::graph::get_graph;
use gs_json::{Json, json};
use gs_services::App;
use gs_services::app::agent_actions::note_agent_action;
use gs_services::spaces::space_actions::READING_NOTE;
use gs_services::graph::extraction::extraction;

use super::reply::{failure, result};
use super::tools::{ToolCall, space_arg};

pub async fn search_graph(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let scope = match space_arg(app, args["space_id"].as_str()) {
		Ok(scope) => scope,
		Err(error) => return failure(&error),
	};
	let graph = match get_graph(&ScopedGraph::new(&app.stores.graphs, scope.as_deref())) {
		Ok(graph) => graph,
		Err(error) => return failure(&error),
	};
	let max = args["limit"].as_i64().unwrap_or(30) as usize;
	let found: Vec<&Json> = match args["query"].as_str().filter(|q| !gs_base::text::trim(q).is_empty()) {
		Some(query) => {
			let by_id: HashMap<&str, &Json> = graph.nodes.iter().map(|n| (n["id"].as_str().unwrap_or_default(), n)).collect();
			match app.search.search_facts(scope.as_deref(), &graph.nodes, query, max).await {
				Ok(ids) => ids.iter().filter_map(|id| by_id.get(id.as_str()).copied()).collect(),
				Err(error) => return failure(&error),
			}
		}
		None => {
			let mut newest: Vec<&Json> = graph.nodes.iter().collect();
			newest.sort_by(|a, b| locale::compare(b["createdAt"].as_str().unwrap_or_default(), a["createdAt"].as_str().unwrap_or_default()));
			newest.truncate(max);
			newest
		}
	};
	let picked: HashSet<&str> = found.iter().filter_map(|n| n["id"].as_str()).collect();
	let names: HashMap<&str, &str> = graph.nodes.iter().filter_map(|n| Some((n["id"].as_str()?, n["name"].as_str()?))).collect();
	let name_of = |id: &str| names.get(id).copied().unwrap_or(id).to_owned();
	let ids = |c: &Json| -> Vec<String> { c["premises"].as_arr().into_iter().flatten().filter_map(|p| p.as_str().map(str::to_owned)).collect() };
	let chains: Vec<String> = graph
		.chains
		.iter()
		.filter(|c| picked.contains(c["conclusion"].as_str().unwrap_or_default()) || ids(c).iter().any(|p| picked.contains(p.as_str())))
		.take(100)
		.map(|c| {
			let premises: Vec<String> = ids(c).iter().map(|p| name_of(p)).collect();
			format!("{} ⟹ {}", premises.join(" + "), name_of(c["conclusion"].as_str().unwrap_or_default()))
		})
		.collect();
	let facts: Vec<Json> = found.iter().map(|n| json!({ "id": n["id"], "name": n["name"], "statement": n["statement"] })).collect();
	result(&json!({ "totalFacts": graph.nodes.len(), "facts": facts, "chains": chains }))
}

pub fn import_notes(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let scope = match space_arg(app, args["space_id"].as_str()) {
		Ok(scope) => scope,
		Err(error) => return failure(&error),
	};
	let name = args["name"].as_str().unwrap_or_default();
	let text = args["text"].as_str().unwrap_or_default();
	let Some(space_id) = scope else {
		note_agent_action(app, call.caller, &json!({ "label": format!("Reading {name}"), "spaceId": null, "target": null, "page": "/graph" }));
		import_in_background(app, name, text);
		return result(&json!({ "status": "started", "note": format!("Import started. {READING_NOTE}") }));
	};
	// Compare as stored, so "week1/notes.md" finds "notes.md".
	let clean = safe_name(name);
	let file_name = if Re::new(r"\.(md|markdown|txt)$", "i").test(&clean) { clean } else { format!("{clean}.md") };
	// Only a note it imported or wrote before is replaced; the learner's own file never is.
	let file = match gs_services::spaces::write_agent_file(app, &space_id, &file_name, &gs_base::text::utf8_bytes(text), "study") {
		Ok((file, _)) => file,
		Err(refused) => return failure(&refused),
	};
	let file_id = file["id"].clone();
	note_agent_action(app, call.caller, &json!({ "label": format!("Reading {file_name}"), "spaceId": space_id, "target": { "kind": "file", "id": file_id }, "page": "/space/files" }));
	result(&json!({ "status": "started", "fileId": file_id, "note": format!("Import started. {READING_NOTE}") }))
}

/// No-space notes are read in the background; their work reaches the agent through
/// wait_for_work, and a failure is only logged.
fn import_in_background(app: &Arc<App>, name: &str, text: &str) {
	let (app, name, text) = (app.clone(), name.to_owned(), text.to_owned());
	tokio::spawn(async move {
		let input = NotesImportInput { file_path: name.clone(), text, scope: None, source_id: None, may_be_space_info: false };
		if let Err(err) = extraction(&app).import_notes(input).await {
			eprintln!("[mcp] import of {name} failed: {err}");
		}
	});
}

#[cfg(test)]
mod tests {
	use gs_services::spaces::add_copied_file;
	use gs_services::spaces::space_card::space_file_path;

	use super::*;

	#[tokio::test]
	async fn an_import_never_writes_over_the_learner_s_own_file() {
		let root = std::env::temp_dir().join(format!("gs-import-notes-{}", gs_base::ids::uuid()));
		for name in ["data", "home", "tmp", "res"] {
			std::fs::create_dir_all(root.join(name)).unwrap();
		}
		let app = App::new(gs_base::config::Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "Botany" })).unwrap()["id"].as_str().unwrap().to_owned();
		let own = add_copied_file(&app, &space_id, "notes.md", b"My own notes.", "study").unwrap();
		let call = ToolCall { app: &app, caller: None, meta: &Json::Null };
		let import = |name: &str, text: &str| import_notes(&call, &json!({ "space_id": space_id, "name": name, "text": text }));

		let refused = import("notes", "The agent's notes.");
		assert_eq!(refused["isError"], json!(true));
		assert_eq!(refused["content"][0]["text"], json!("This space already has a file named notes.md that this tool can't replace. Pick another name, or ask the learner to remove the old one."));
		let record = app.stores.spaces.get_space(&space_id).unwrap();
		assert_eq!(std::fs::read_to_string(space_file_path(&app, &record, &own).unwrap()).unwrap(), "My own notes.");

		// Its own import by that name is replaced and keeps its id.
		let first = import("Leaves", "Veins.");
		let again = import("Leaves.md", "Veins and stomata.");
		let id = |reply: &Json| gs_json::parse(reply["content"][0]["text"].as_str().unwrap()).unwrap()["fileId"].clone();
		assert!(first.get("isError").is_none() && again.get("isError").is_none(), "{again:?}");
		assert_eq!(id(&first), id(&again));
		let record = app.stores.spaces.get_space(&space_id).unwrap();
		assert_eq!(record["files"].as_arr().unwrap().len(), 2);
		std::fs::remove_dir_all(&root).ok();
	}
}
