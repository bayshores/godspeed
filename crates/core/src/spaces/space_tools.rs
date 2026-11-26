//! The space tools the teacher panel's chat offers (and a lesson or a deadline request some of): their names, descriptions (`space_tool_text`), argument shapes and outcome.

use gs_json::Json;

pub use super::space_tool_text::{SPACE_ARG_TEXT, SPACE_TOOL_TEXT, SpaceArgText};
pub use crate::contracts::space::DEADLINE_KINDS;

pub const FILE_KINDS: [&str; 2] = ["study", "info"];

/// The pages open_page opens.
pub const OPEN_PAGES: [&str; 8] = ["home", "progress", "files", "deadlines", "graph", "deadline", "cheat_sheet", "lesson"];

/// A page the learner can open to see what a space tool changed.
#[derive(Clone, Debug, PartialEq)]
pub struct SpaceChange {
	pub label: String,
	pub page: String,
}

/// What a space tool gives back.
#[derive(Clone, Debug, PartialEq)]
pub enum ToolOutcome {
	Ok { value: Json, changes: Vec<SpaceChange> },
	Err(String),
}
