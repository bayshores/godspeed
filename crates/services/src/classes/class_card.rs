//! THE CLASS CARD (class-card.ts): the short [Class context] message a lesson in a class opens
//! with: class name, the learner's description, the class files (size, state, and the path the
//! teacher can open) and the topics of the class's graph with their fact counts. It is a snapshot
//! from when the lesson started; the read_class tool gives the current version.

use std::path::{Path, PathBuf};

use gs_base::config::resolve;
use gs_core::contracts::class::is_recording_file;
use gs_core::graph::graph::get_graph;
use gs_core::graph::topics::resolve_topics;
use gs_core::messages::native_messages::new_class_context_message;
use gs_json::{Json, Obj, json};

use crate::App;
use crate::graph::graph::graph_store_for;

/// Absolute path of a class file on this computer (None when its linked folder is gone).
pub fn class_file_path(app: &App, record: &Json, file: &Json) -> Option<String> {
	let rel = file["path"].as_str().unwrap_or("");
	let abs = if file["origin"].as_str() == Some("copied") {
		resolve(&app.stores.classes.files_dir(record["id"].as_str()?).ok()?.join(rel))
	} else {
		resolve(&Path::new(record["linkedFolder"].as_str().filter(|f| !f.is_empty())?).join(rel))
	};
	Some(abs.to_string_lossy().into_owned())
}

/// Where a recording's transcript is kept (inside the app's own class folder: a linked folder is
/// never written to).
pub fn transcript_path_of(app: &App, class_id: &str, file_id: &str) -> Option<PathBuf> {
	Some(app.stores.classes.files_dir(class_id).ok()?.join("transcripts").join(format!("{file_id}.txt")))
}

/// The card's data for a class as it stands now. A recording is listed by its transcript (its
/// lecture's transcript file, or the one made from it); unreadable files are listed without a
/// path. Err when the class's graph cannot be read.
pub fn class_card_for(app: &App, record: &Json) -> Result<Json, String> {
	let id = record["id"].as_str().unwrap_or("");
	let sizes = app.search.file_extents(id);
	let topics = class_topics(app, id)?;
	let files = record["files"].as_arr().map_or(&[][..], Vec::as_slice);
	let listed: Vec<Json> = files
		.iter()
		.map(|file| {
			let mut p = class_file_path(app, record, file);
			let covering = file["transcriptId"].as_str().filter(|t| !t.is_empty()).and_then(|t| files.iter().find(|f| f["id"].as_str() == Some(t)));
			if let Some(covering) = covering {
				p = class_file_path(app, record, covering);
			} else if p.is_some() && is_recording_file(file["name"].as_str().unwrap_or("")) {
				p = transcript_path_of(app, id, file["id"].as_str().unwrap_or("")).filter(|t| t.exists()).map(|t| t.to_string_lossy().into_owned());
			}
			let mut entry = Obj::new();
			entry.insert("name", file["name"].clone());
			entry.insert("kind", file["kind"].clone());
			entry.insert("path", p.map_or(Json::Null, Json::from));
			if let Some(size) = sizes.get(file["id"].as_str().unwrap_or("")).filter(|s| s.truthy()) {
				entry.insert("size", size.clone());
			}
			entry.insert("status", file["status"].clone());
			Json::Obj(entry)
		})
		.collect();
	let mut card = Obj::new();
	card.insert("classId", record["id"].clone());
	card.insert("name", record["name"].clone());
	card.insert("description", record["description"].clone());
	card.insert("files", listed);
	if !topics.is_empty() {
		card.insert("topics", topics);
	}
	Ok(Json::Obj(card))
}

/// The class graph's topics with how many facts each holds.
pub fn class_topics(app: &App, class_id: &str) -> Result<Vec<Json>, String> {
	let graph = get_graph(graph_store_for(app, Some(class_id)).as_ref())?;
	let snapshot = app.stores.graphs.read_topics(Some(class_id))?;
	let fact_ids: Vec<String> = graph.nodes.iter().filter_map(|n| n["id"].as_str().map(str::to_owned)).collect();
	Ok(resolve_topics(snapshot.as_ref(), &fact_ids).iter().map(|t| json!({ "name": t["name"], "facts": t["members"].as_arr().map_or(0, Vec::len) })).collect())
}

/// Puts (or replaces, or removes) a lesson's class card: the first class-context marker is
/// swapped for the new class's card; with no class it is dropped; a lesson without one gets it as
/// its first message.
pub fn apply_class_card(app: &App, chat_id: &str, record: Option<&Json>) -> Result<(), String> {
	let Some(chat) = app.stores.chats.get_chat(chat_id) else { return Ok(()) };
	let mut messages = chat["messages"].as_arr().cloned().unwrap_or_default();
	let at = messages.iter().position(|m| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("class-context"));
	let card = record.map(|r| class_card_for(app, r).map(|card| new_class_context_message(&card))).transpose()?;
	match (at, card) {
		(Some(at), Some(mut card)) => {
			if let Some(obj) = card.as_obj_mut() {
				obj.insert("id", messages[at]["id"].clone());
			}
			messages[at] = card;
		}
		(Some(at), None) => {
			messages.remove(at);
		}
		(None, Some(card)) => messages.insert(0, card),
		(None, None) => return Ok(()),
	}
	app.stores.chats.save_messages(chat_id, &messages)
}
