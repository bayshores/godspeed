//! What every space should have, so a space made before an app update catches up: the agent's
//! briefing lists what each space is missing.

use gs_base::text;
use gs_json::Json;

/// How the agent fills in each missing item.
pub const SETUP_HOW: &str = "Fill them in with update_space: set an icon without asking; write a signature or description from the space's files, asking the learner when unsure.";

/// The setup items the space is missing, e.g. ["icon"].
pub fn missing_setup(space: &Json) -> Vec<&'static str> {
	let checks = [
		("icon", !space["icon"].truthy()),
		("signature", !space["signature"].truthy()),
		("description", text::trim(space["description"].as_str().unwrap_or("")).is_empty()),
	];
	checks.into_iter().filter(|(_, missing)| *missing).map(|(item, _)| item).collect()
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn lists_what_is_missing() {
		assert_eq!(missing_setup(&json!({ "description": "  " })), ["icon", "signature", "description"]);
		assert!(missing_setup(&json!({ "icon": "cpu", "signature": { "kind": "text", "value": "x" }, "description": "d" })).is_empty());
	}
}
