//! open_page: a lesson's teacher, or the cheat sheet's agent, opens a page in the learner's
//! window when they ask to see something, like the outside agent's tool of the same name.

use std::sync::Arc;

use gs_core::session::schema::{object, one_of_literals, string};
use gs_core::spaces::space_tools::{OPEN_PAGES, SPACE_ARG_TEXT, SPACE_TOOL_TEXT};
use gs_json::Json;

use super::fn_tool::FnTool;

/// Opens the page the arguments name: what the agent hears, or the refusal.
pub type OpenPage = Arc<dyn Fn(&Json) -> Result<String, String> + Send + Sync>;

pub fn open_page_tool(open: OpenPage) -> FnTool {
	let t = &*SPACE_ARG_TEXT;
	let parameters = object(
		&["page"],
		vec![
			("page", one_of_literals(&OPEN_PAGES, t.page)),
			("space_id", string(t.page_space)),
			("deadline_id", string(t.page_deadline)),
			("lesson_id", string(t.page_lesson)),
		],
	);
	let description = SPACE_TOOL_TEXT.iter().find(|(tool, _)| *tool == "open_page").map_or("", |(_, text)| *text);
	FnTool::server("open_page", description, parameters, move |args, _ctx| {
		let opened = open(&args);
		async move { opened.map(Json::from) }
	})
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::tool::Tool;
	use gs_json::json;

	use super::*;

	/// The same tool as the outside agent's (tools.json), so a lesson's teacher opens pages the
	/// same way.
	#[test]
	fn takes_a_page_and_its_id() {
		let tool = open_page_tool(Arc::new(|args: &Json| Ok(format!("opened {}", args["page"].str_or_empty()))));
		assert_eq!(tool.name(), "open_page");
		assert!(tool.description().starts_with("Open a page in the learner's godspeed window"));
		let schema = tool.parameters();
		assert_eq!(schema["required"], json!(["page"]));
		assert_eq!(schema["properties"]["page"]["anyOf"].items().len(), OPEN_PAGES.len());
		for key in ["space_id", "deadline_id", "lesson_id"] {
			assert!(schema["properties"][key]["description"].as_str().is_some(), "{key}");
		}
	}
}
