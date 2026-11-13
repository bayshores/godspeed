//! The universal argument heal: every tool of a registry heals
//! what is mechanically recognizable (a JSON-encoded stand-in for the schema's shape) after its
//! own preparation, so no tool can ship unwrapped and validation rejects the rest.

use super::fn_tool::FnTool;

/// Heals every tool of a registry. Idempotent, so a tool's own heal under this one is harmless.
pub fn heal_tool_record(tools: Vec<FnTool>) -> Vec<FnTool> {
	tools.into_iter().map(FnTool::healed).collect()
}
