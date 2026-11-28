//! activeCompactionOf and keptIndexFor from src/shared/core/compaction.ts, here so the messages
//! module needs nothing from session.

use gs_json::Json;
use crate::messages::role::is_custom;

/// The latest compaction marker that names its first kept message, if any.
pub fn active_compaction_of(messages: &[Json]) -> Option<&Json> {
	messages.iter().rev().find(|m| is_custom(m, "compaction") && m["details"]["firstKeptMessageId"].as_str().is_some())
}

/// Where the marker's first kept message is; None when it is gone (TypeScript's -1).
pub(crate) fn kept_index_for(messages: &[Json], marker: &Json) -> Option<usize> {
	let id = marker["details"]["firstKeptMessageId"].as_str()?;
	messages.iter().position(|m| m["id"].as_str() == Some(id))
}
