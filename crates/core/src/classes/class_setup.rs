//! What every class should have, so a class made before an app update catches up: the agent's
//! briefing lists what each class is missing.

use gs_base::text;
use gs_json::Json;

/// How the agent fills in each missing item.
pub const SETUP_HOW: &str = "Fill them in with update_class: set an icon without asking; write a signature or description from the class's files, asking the learner when unsure.";

/// The setup items the class is missing, e.g. ["icon"].
pub fn missing_setup(cls: &Json) -> Vec<&'static str> {
	let checks = [
		("icon", !cls["icon"].truthy()),
		("signature", !cls["signature"].truthy()),
		("description", text::trim(cls["description"].as_str().unwrap_or("")).is_empty()),
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
