//! search_vault and write_vault_note: the outside agent's only way to read and write the
//! learner's vault.

use gs_json::Json;
use gs_services::vault;

use super::reply::{failure, result};
use super::tools::ToolCall;

pub fn search_vault(call: &ToolCall<'_>, args: &Json) -> Json {
	vault::search_vault(call.app, args).map_or_else(|why| failure(&why), |found| result(&found))
}

pub fn write_vault_note(call: &ToolCall<'_>, args: &Json) -> Json {
	vault::write_vault_note(call.app, args).map_or_else(|why| failure(&why), |written| result(&written))
}
