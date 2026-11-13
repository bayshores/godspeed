//! The universal argument heal: every tool of a registry heals
//! what is mechanically recognizable (a JSON-encoded stand-in for the schema's shape) after its
//! own preparation, so no tool can ship unwrapped and validation rejects the rest.

use gs_core::session::plot::PLOT_TOOL;
use gs_engine::turn::tool::Tool;

use super::fn_tool::FnTool;

/// Heals every tool of a registry but the plot, whose stored call the window draws as sent, so it
/// is checked as sent. Idempotent, so a tool's own heal under this one is harmless.
pub fn heal_tool_record(tools: Vec<FnTool>) -> Vec<FnTool> {
	tools.into_iter().map(|tool| if tool.name() == PLOT_TOOL { tool } else { tool.healed() }).collect()
}
