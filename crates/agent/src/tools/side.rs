//! The tools every lesson-like session may add beside its own: the class card and search, the
//! learner's rules and the deadline changes. Each is present only when the composition root
//! passes its reader.

use gs_core::session::tool_switches::filter_enabled_tools;
use gs_engine::turn::tool::Tool;
use gs_json::Json;

use crate::fs_tools::find::find_tool;
use crate::fs_tools::grep::grep_tool;
use crate::fs_tools::ls::ls_tool;
use crate::fs_tools::read::read_tool;

use super::class::{ClassToolContext, class_tools};
use super::fn_tool::FnTool;
use super::graph::{GraphToolContext, prober_graph_tools};
use super::rules::{SaveRule, save_rule_tool};
use super::talk::{ClassActions, lesson_class_change_tools};

#[derive(Clone, Default)]
pub struct LessonSide {
	/// The lesson's class, when it has one.
	pub class: Option<ClassToolContext>,
	pub save_rule: Option<SaveRule>,
	/// The deadline changes a learner may ask for mid-lesson.
	pub class_actions: Option<ClassActions>,
}

impl LessonSide {
	pub fn tools(&self) -> Vec<FnTool> {
		let mut tools = Vec::new();
		if let Some(class) = &self.class {
			tools.extend(class_tools(class));
		}
		if let Some(save_rule) = &self.save_rule {
			tools.push(save_rule_tool(save_rule.clone()));
		}
		if let Some(actions) = &self.class_actions {
			tools.extend(lesson_class_change_tools(actions));
		}
		tools
	}
}

/// The map readers when the graph is open to the agent, then the lesson's own side tools.
pub fn graph_and_side(graph: Option<&GraphToolContext>, side: &LessonSide) -> Vec<FnTool> {
	let mut tools = graph.map(prober_graph_tools).unwrap_or_default();
	tools.extend(side.tools());
	tools
}

/// The read-only tools over the learner's own files, in every agent's registry.
pub fn file_tools() -> Vec<FnTool> {
	[read_tool(), ls_tool(), find_tool(), grep_tool()].into_iter().map(FnTool::from_tool).collect()
}

/// Drops every tool the resolved settings switch off, keeping the order of the rest.
pub fn filter_enabled(tools: Vec<FnTool>, enabled: Option<&Json>) -> Vec<FnTool> {
	filter_enabled_tools(tools.into_iter().map(|t| (t.name().to_owned(), t)).collect(), enabled).into_iter().map(|(_, tool)| tool).collect()
}
