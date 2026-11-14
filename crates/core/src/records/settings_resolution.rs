//! The settings record with every knob
//! concrete (an explicit value wins, an absent one takes the factory default).
//!
//! Tool toggles and rules are passed through as stored; consumers read an absent tool as enabled.
//! The extraction batch size and the summarize threshold are no longer settings: they always
//! take the factory value, whatever an old file holds.

use gs_json::{Json, json};

use super::settings::factory_settings;

/// `value ?? default`.
fn or(value: &Json, default: &Json) -> Json {
	if value.is_null() { default.clone() } else { value.clone() }
}

/// The whole record resolved. `record` is None on first boot.
pub fn resolve_settings(record: Option<&Json>) -> Json {
	let none = Json::Null;
	let record = record.unwrap_or(&none);
	let factory = factory_settings();
	let (general, appearance, graph) = (&record["general"], &record["appearance"], &record["graph"]);
	let md = &appearance["mdRendering"];
	let teacher = &general["teacherName"];
	json!({
		"general": {
			"autoUpdate": or(&general["autoUpdate"], &factory["general"]["autoUpdate"]),
			"activeSpace": or(&general["activeSpace"], &factory["general"]["activeSpace"]),
			"teacherName": if teacher.truthy() { teacher.clone() } else { factory["general"]["teacherName"].clone() },
			"sounds": or(&general["sounds"], &factory["general"]["sounds"]),
			"deadlineReminders": or(&general["deadlineReminders"], &factory["general"]["deadlineReminders"]),
		},
		"agent": {
			"tools": or(&record["agent"]["tools"], &json!({})),
			"rules": or(&record["agent"]["rules"], &json!({})),
			"graphTools": or(&record["agent"]["graphTools"], &json!({})),
		},
		"appearance": {
			"background": or(&appearance["background"], &factory["appearance"]["background"]),
			"fontFamily": or(&appearance["fontFamily"], &factory["appearance"]["fontFamily"]),
			"proseFontSize": or(&appearance["proseFontSize"], &factory["appearance"]["proseFontSize"]),
			"mdRendering": {
				"headingWeight": or(&md["headingWeight"], &factory["appearance"]["mdRendering"]["headingWeight"]),
				"boldColor": or(&md["boldColor"], &factory["appearance"]["mdRendering"]["boldColor"]),
				"italicColor": or(&md["italicColor"], &factory["appearance"]["mdRendering"]["italicColor"]),
			},
		},
		"graph": {
			"enabled": or(&graph["enabled"], &factory["graph"]["enabled"]),
			"extractionChunkTokens": factory["graph"]["extractionChunkTokens"],
		},
		"compaction": factory["compaction"],
	})
}

/// The prober's graph tools run only when the graph itself does and the toggle is not off.
pub fn graph_tools_enabled(effective: &Json) -> bool {
	let toggle = &effective["agent"]["graphTools"]["enabled"];
	effective["graph"]["enabled"].truthy() && (if toggle.is_null() { true } else { toggle.truthy() })
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	#[test]
	fn explicit_values_win_and_absent_ones_default() {
		let first_boot = resolve_settings(None);
		assert_eq!(first_boot["general"]["teacherName"].as_str(), Some("Teacher"));
		assert_eq!(first_boot["graph"]["extractionChunkTokens"].as_i64(), Some(4096));
		let record = json!({ "version": 2, "general": { "teacherName": "Zed" }, "appearance": { "mdRendering": { "boldColor": "#fff" } }, "agent": { "graphTools": { "enabled": false } } });
		let resolved = resolve_settings(Some(&record));
		assert_eq!(resolved["general"]["teacherName"].as_str(), Some("Zed"));
		assert_eq!(resolved["appearance"]["mdRendering"]["boldColor"].as_str(), Some("#fff"));
		assert_eq!(stringify(&resolved["agent"]), r#"{"tools":{},"rules":{},"graphTools":{"enabled":false}}"#);
		assert!(graph_tools_enabled(&first_boot));
		assert!(!graph_tools_enabled(&resolved));
	}

	#[test]
	fn an_old_file_s_batch_size_and_threshold_are_ignored() {
		let old = json!({ "version": 3, "graph": { "enabled": false, "extractionChunkTokens": 900 }, "compaction": { "thresholdTokens": 90000 } });
		let resolved = resolve_settings(Some(&old));
		assert_eq!((resolved["graph"]["extractionChunkTokens"].as_i64(), resolved["compaction"]["thresholdTokens"].as_i64()), (Some(4096), Some(40000)));
		assert_eq!(resolved["graph"]["enabled"], json!(false), "the rest of the section still counts");
	}
}
