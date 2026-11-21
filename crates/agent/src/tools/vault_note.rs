//! write_vault_note: a lesson's teacher writes a note into the learner's vault, like the outside
//! agent's tool of the same name. A lesson started while a vault is picked has it for its whole
//! length.

use std::sync::Arc;

use gs_core::session::schema::{array, object, string};
use gs_core::spaces::space_tools::{SPACE_ARG_TEXT, SPACE_TOOL_TEXT};
use gs_core::vault::mistakes::MAX_KINDS;
use gs_core::vault::note_tool::{LINKS_MAX, MISTAKE_KIND_MAX, MISTAKE_TEXT_MAX, RECALL_MAX, TEXT_MAX, TITLE_MAX};
use gs_json::{Json, json};

use super::fn_tool::FnTool;

/// Writes the note the arguments describe: the answer the teacher hears, or the refusal.
pub type WriteVaultNote = Arc<dyn Fn(&Json) -> Result<Json, String> + Send + Sync>;

fn limited(max: usize, description: &str) -> Json {
	json!({ "type": "string", "minLength": 1, "maxLength": max, "description": description })
}

pub fn write_vault_note_tool(write: WriteVaultNote) -> FnTool {
	let t = &*SPACE_ARG_TEXT;
	let mistake = object(&["text", "kind"], vec![("text", limited(MISTAKE_TEXT_MAX, t.vault_mistake_text)), ("kind", limited(MISTAKE_KIND_MAX, t.vault_mistake_kind))]);
	let mut mistakes = array(mistake, 0, t.vault_mistakes);
	if let Some(fields) = mistakes.as_obj_mut() {
		fields.insert("maxItems", MAX_KINDS as f64);
	}
	let mut links = array(json!({ "type": "string", "minLength": 1 }), 0, t.vault_links);
	if let Some(fields) = links.as_obj_mut() {
		fields.insert("maxItems", LINKS_MAX as f64);
	}
	let parameters = object(
		&[],
		vec![
			("topic_id", string(&format!("{} Left out: the topic of the lesson's current step.", t.vault_topic))),
			("title", limited(TITLE_MAX, t.vault_title)),
			("text", limited(TEXT_MAX, t.vault_text)),
			("recall", limited(RECALL_MAX, t.vault_recall)),
			("mistakes", mistakes),
			("source", string(t.vault_source)),
			("links", links),
			("covered_by", string(t.vault_covered_by)),
		],
	);
	let description = SPACE_TOOL_TEXT.iter().find(|(tool, _)| *tool == "write_vault_note").map_or("", |(_, text)| *text);
	FnTool::server("write_vault_note", description, parameters, move |args, _ctx| {
		let written = write(&args);
		async move { written }
	})
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::tool::Tool;

	use super::*;

	#[test]
	fn takes_the_notes_words_and_no_space_id() {
		let tool = write_vault_note_tool(Arc::new(|args: &Json| Ok(json!({ "status": "written", "name": args["title"] }))));
		assert_eq!(tool.name(), "write_vault_note");
		assert!(tool.description().starts_with("Write what the learner answered"));
		let schema = tool.parameters();
		assert!(schema.get("required").is_none());
		for key in ["topic_id", "title", "text", "recall", "mistakes", "source", "links", "covered_by"] {
			assert!(schema["properties"][key]["description"].as_str().is_some(), "{key}");
		}
		assert!(schema["properties"].get("space_id").is_none());
		assert_eq!(schema["properties"]["text"]["maxLength"].as_f64(), Some(TEXT_MAX as f64));
	}
}
