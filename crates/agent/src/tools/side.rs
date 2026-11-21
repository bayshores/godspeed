//! The tools every lesson-like session may add beside its own: the space card and search, the
//! graph search, the learner's rules, the deadline changes, opening a page and writing a vault note. Each is present only when the
//! composition root passes its reader.

use gs_core::session::tool_switches::filter_enabled_tools;
use gs_engine::turn::tool::Tool;
use gs_json::Json;

use crate::fs_tools::find::find_tool;
use crate::fs_tools::grep::grep_tool;
use crate::fs_tools::ls::ls_tool;
use crate::fs_tools::read::read_tool;

use super::space::{SpaceToolContext, space_tools};
use super::fn_tool::FnTool;
use super::graph::{SearchGraph, search_graph_tool};
use super::open_page::{OpenPage, open_page_tool};
use super::rules::{SaveRule, save_rule_tool};
use super::space_actions::{SpaceActions, lesson_space_change_tools};
use super::vault_note::{WriteVaultNote, write_vault_note_tool};

#[derive(Clone, Default)]
pub struct LessonSide {
	/// The lesson's space, when it has one.
	pub space: Option<SpaceToolContext>,
	/// The lesson's own graph, when the settings open it to the agent.
	pub search_graph: Option<SearchGraph>,
	pub save_rule: Option<SaveRule>,
	/// The deadline changes a learner may ask for mid-lesson.
	pub space_actions: Option<SpaceActions>,
	/// "Open my cheat sheet", asked mid-lesson.
	pub open_page: Option<OpenPage>,
	/// "Note this", and the notes a lesson writes; only in a lesson started with a vault picked.
	pub write_vault_note: Option<WriteVaultNote>,
}

impl LessonSide {
	pub fn tools(&self) -> Vec<FnTool> {
		let mut tools = Vec::new();
		if let Some(space) = &self.space {
			tools.extend(space_tools(space));
		}
		if let Some(search) = &self.search_graph {
			tools.push(search_graph_tool(search.clone()));
		}
		if let Some(save_rule) = &self.save_rule {
			tools.push(save_rule_tool(save_rule.clone()));
		}
		if let Some(actions) = &self.space_actions {
			tools.extend(lesson_space_change_tools(actions));
		}
		if let Some(open) = &self.open_page {
			tools.push(open_page_tool(open.clone()));
		}
		if let Some(write) = &self.write_vault_note {
			tools.push(write_vault_note_tool(write.clone()));
		}
		tools
	}
}

/// The read-only tools over the learner's own files, in every agent's registry.
pub fn file_tools() -> Vec<FnTool> {
	[read_tool(), ls_tool(), find_tool(), grep_tool()].into_iter().map(FnTool::from_tool).collect()
}

/// Drops every tool the resolved settings switch off, keeping the order of the rest.
pub fn filter_enabled(tools: Vec<FnTool>, enabled: Option<&Json>) -> Vec<FnTool> {
	filter_enabled_tools(tools.into_iter().map(|t| (t.name().to_owned(), t)).collect(), enabled).into_iter().map(|(_, tool)| tool).collect()
}
