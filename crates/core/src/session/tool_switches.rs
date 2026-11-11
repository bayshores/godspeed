//! Ported from src/shared/core/tool-switches.ts: the sub-agent tools a learner may switch off.
//! Not toggleable on purpose: quiz and ask_user_question (teaching is built on graded checks),
//! the learner-filesystem set, the plan tools and probe_done (a prober that can never conclude
//! is a lockout). Names are the model-facing tool names.

use gs_json::Json;

pub const TOGGLEABLE_TOOLS: [&str; 4] = ["research", "demo", "visual", "pdf"];

/// The keys the settings write side accepts in agent.tools: the toggleables plus the quizzing
/// switch (`explain: true` arms free-recall quizzing and drops the multiple-choice quiz).
pub const WRITABLE_TOOL_KEYS: [&str; 5] = ["research", "demo", "visual", "pdf", "explain"];

/// An explicit `false` for this tool in the resolved settings; a missing key means enabled.
fn switched_off(enabled: Option<&Json>, name: &str) -> bool {
	enabled.is_some_and(|e| e[name] == Json::Bool(false))
}

/// Drops every tool the resolved settings mark as disabled, keeping the order of the rest.
pub fn filter_enabled_tools<T>(tools: Vec<(String, T)>, enabled: Option<&Json>) -> Vec<(String, T)> {
	tools.into_iter().filter(|(name, _)| !switched_off(enabled, name)).collect()
}

/// The switch name Settings shows, so the model and the learner call each tool the same thing.
fn switch_label(tool: &str) -> &'static str {
	match tool {
		"research" => "Web research",
		"demo" => "Demos",
		"visual" => "Figures",
		"pdf" => "PDF reading",
		// Another name has no label, which a template prints as "undefined".
		_ => "undefined",
	}
}

/// One system-prompt line naming the switched-off tools among `carried`, so the doctrine's
/// mentions of them don't send the model planning around a tool it no longer has. Empty when
/// none of them is off.
pub fn switched_off_tools_note(enabled: Option<&Json>, carried: &[&str]) -> String {
	let off: Vec<String> = carried.iter().filter(|t| switched_off(enabled, t)).map(|t| format!("{} (`{t}`)", switch_label(t))).collect();
	match off.as_slice() {
		[] => String::new(),
		[one] => format!("The learner switched off {one} in Settings, so that tool is gone. Don't plan around it or offer it."),
		[init @ .., last] => format!("The learner switched off {} and {last} in Settings, so those tools are gone. Don't plan around them or offer them.", init.join(", ")),
	}
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn only_an_explicit_false_removes_a_tool() {
		let enabled = json!({ "demo": false, "pdf": true, "research": null });
		let kept = filter_enabled_tools(vec![("demo".to_owned(), 1), ("pdf".to_owned(), 2), ("research".to_owned(), 3)], Some(&enabled));
		assert_eq!(kept, [("pdf".to_owned(), 2), ("research".to_owned(), 3)]);
		assert_eq!(filter_enabled_tools(vec![("demo".to_owned(), 1)], None).len(), 1);
	}

	#[test]
	fn the_note_names_each_switched_off_tool() {
		let enabled = json!({ "demo": false, "visual": false, "pdf": false });
		assert_eq!(switched_off_tools_note(None, &TOGGLEABLE_TOOLS), "");
		assert_eq!(switched_off_tools_note(Some(&enabled), &["demo"]), "The learner switched off Demos (`demo`) in Settings, so that tool is gone. Don't plan around it or offer it.");
		assert_eq!(
			switched_off_tools_note(Some(&enabled), &TOGGLEABLE_TOOLS),
			"The learner switched off Demos (`demo`), Figures (`visual`) and PDF reading (`pdf`) in Settings, so those tools are gone. Don't plan around them or offer them."
		);
		assert_eq!(WRITABLE_TOOL_KEYS[..4], TOGGLEABLE_TOOLS);
	}
}
