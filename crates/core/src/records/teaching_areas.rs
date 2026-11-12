//! The area descriptions and part names the window shows stay in the TypeScript.

use std::sync::LazyLock;

use gs_base::{re::Re, text};
use gs_json::{Json, Obj};

/// Longest rule, in characters (code points).
pub const RULE_MAX_CHARS: usize = 200;
/// Most rules in one list.
pub const RULES_MAX: usize = 20;

/// One of the six areas the learner's rules are grouped under.
pub struct TeachingArea {
	pub id: &'static str,
	pub label: &'static str,
}

pub const TEACHING_AREAS: [TeachingArea; 6] = [
	TeachingArea { id: "voice", label: "Voice" },
	TeachingArea { id: "teaching", label: "Lesson flow" },
	TeachingArea { id: "questions", label: "Questions" },
	TeachingArea { id: "facts", label: "Facts and research" },
	TeachingArea { id: "demos", label: "Demos and figures" },
	TeachingArea { id: "files", label: "Your files and formatting" },
];

/// One line of at most `max` code points: control, format and line-separator characters become
/// spaces, runs of whitespace one space, trimmed.
pub fn one_line(raw: &str, max: usize) -> String {
	static INVISIBLE: LazyLock<Re> = LazyLock::new(|| Re::new(r"[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]", "gu"));
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let line = SPACES.replace(&INVISIBLE.replace(raw, " "), " ");
	let cut: String = gs_json::lone::pair_up(text::trim(&line)).chars().take(max).collect();
	text::trim(&cut).to_owned()
}

/// A rule list as stored: strings only, one line each, no repeats, at most RULES_MAX.
pub fn sanitize_rules(raw: &Json) -> Vec<String> {
	let mut out: Vec<String> = Vec::new();
	for entry in raw.as_arr().into_iter().flatten() {
		let Some(entry) = entry.as_str() else { continue };
		let rule = one_line(entry, RULE_MAX_CHARS);
		if !rule.is_empty() && !out.contains(&rule) {
			out.push(rule);
		}
	}
	out.truncate(RULES_MAX);
	out
}

/// Area rules made safe to store: known areas only, empty lists dropped.
pub fn sanitize_area_rules(raw: &Json) -> Json {
	let mut out = Obj::new();
	if raw.as_obj().is_none() {
		return Json::Obj(out);
	}
	for area in &TEACHING_AREAS {
		let rules = sanitize_rules(&raw[area.id]);
		if !rules.is_empty() {
			out.insert(area.id, rules);
		}
	}
	Json::Obj(out)
}

/// A title line, then one "- rule" line each.
fn block(title: &str, rules: impl Iterator<Item = String>) -> String {
	std::iter::once(title.to_owned()).chain(rules.map(|r| format!("- {r}"))).collect::<Vec<_>>().join("\n")
}

/// The section added after the instructions, or "" when there are no rules. Space rules only
/// come with a lesson in that space: its name and its rules.
pub fn learner_rules_section(rules: &Json, lesson_space: Option<(&str, &[String])>) -> String {
	let mut blocks: Vec<String> = Vec::new();
	for area in &TEACHING_AREAS {
		let list = rules[area.id].as_arr().filter(|l| !l.is_empty());
		if let Some(list) = list {
			blocks.push(block(area.label, list.iter().map(|r| r.as_str().unwrap_or_default().to_owned())));
		}
	}
	if let Some((name, space_rules)) = lesson_space.filter(|(_, r)| !r.is_empty()) {
		blocks.push(block(&format!("Rules for this space ({name})"), space_rules.iter().cloned()));
	}
	if blocks.is_empty() {
		return String::new();
	}
	let intro = ["## The learner's rules", "The learner wrote these rules. Follow them. Where a rule conflicts with the instructions above, the rule wins."];
	intro.iter().map(|s| (*s).to_owned()).chain(blocks).collect::<Vec<_>>().join("\n\n")
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn rules_are_cleaned_and_deduplicated() {
		assert_eq!(one_line("a\u{200b}\tb\u{2028}c  ", 200), "a b c");
		assert_eq!(one_line("😀😀😀", 2), "😀😀");
		assert_eq!(sanitize_rules(&json!(["x", 1, " x ", "y"])), ["x", "y"]);
		assert!(sanitize_rules(&json!("x")).is_empty());
	}

	#[test]
	fn area_rules_and_the_prompt_section() {
		let rules = sanitize_area_rules(&json!({ "voice": ["Short.", "Short."], "nope": ["x"], "facts": [] }));
		assert_eq!(gs_json::stringify(&rules), r#"{"voice":["Short."]}"#);
		assert_eq!(sanitize_area_rules(&json!([1])), json!({}));
		assert_eq!(learner_rules_section(&json!({}), None), "");
		let space_rules = ["Use Python.".to_owned()];
		assert_eq!(
			learner_rules_section(&rules, Some(("CSE 21", &space_rules))),
			"## The learner's rules\n\nThe learner wrote these rules. Follow them. Where a rule conflicts with the instructions above, the rule wins.\n\nVoice\n- Short.\n\nRules for this space (CSE 21)\n- Use Python."
		);
	}
}
