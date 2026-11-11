//! The write_code question. The learner writes code
//! in an editor and the teacher grades it by reading; the app never grades or runs code.

use gs_base::text;
use gs_json::Json;

use super::schema::{object, string};

/// The write_code tool input.
pub fn write_code_input_schema() -> Json {
	object(
		&["question"],
		vec![
			("question", string("The task, in markdown: what to write, its signature and any rules. ONE question per turn: ask, then end your turn. His answer determines the next.")),
			(
				"language",
				string("The language he writes in, as a lowercase name: \"c\" (the default when omitted), \"cpp\", or any other language name (the editor shows it as plain text, without highlighting)."),
			),
			("starter", string("Optional code the editor starts with (a signature, a skeleton, includes). Omit for an empty editor. Newlines as \\n.")),
		],
	)
}

/// The authoring contract: a task must exist.
pub fn write_code_input_problems(input: &Json) -> Vec<String> {
	if text::trim(input["question"].as_str().unwrap_or_default()).is_empty() {
		return vec!["question is empty: write the task he should code.".to_owned()];
	}
	Vec::new()
}

/// A markdown code block that holds any code: the fence is longer than the longest backtick run
/// inside it.
pub fn fenced_code(code: &str, language: &str) -> String {
	let mut longest = 0;
	let mut run = 0;
	for c in code.chars() {
		run = if c == '`' { run + 1 } else { 0 };
		longest = longest.max(run);
	}
	let fence = "`".repeat(3.max(longest + 1));
	format!("{fence}{language}\n{code}\n{fence}")
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn the_fence_outgrows_the_code() {
		assert_eq!(fenced_code("int x;", "c"), "```c\nint x;\n```");
		assert_eq!(fenced_code("a ```` b `` c", ""), "`````\na ```` b `` c\n`````");
	}

	#[test]
	fn a_task_must_exist() {
		assert_eq!(write_code_input_problems(&json!({ "question": " \n" })), ["question is empty: write the task he should code."]);
		assert!(write_code_input_problems(&json!({ "question": "Write f" })).is_empty());
	}
}
