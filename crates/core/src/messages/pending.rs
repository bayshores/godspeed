//! Ported from src/shared/core/pending.ts.

const QUESTION_TOOLS: [&str; 6] = ["quiz", "probe", "ask_user_question", "explain", "recall", "write_code"];

pub fn is_question_tool(name: &str) -> bool {
	QUESTION_TOOLS.contains(&name)
}

pub fn is_graded_tool(name: &str) -> bool {
	name == "quiz" || name == "probe"
}

/// The question kind a tool asks: "quiz", "explain", "code" or "ask".
pub fn tool_question_kind(tool: &str) -> &'static str {
	match tool {
		"quiz" | "probe" => "quiz",
		"explain" | "recall" => "explain",
		"write_code" => "code",
		_ => "ask",
	}
}

/// Whether an answer to this tool may carry pictures and files.
pub fn answer_takes_files(tool: &str) -> bool {
	matches!(tool_question_kind(tool), "explain" | "ask")
}

/// The working line shown while a tool runs.
pub fn tool_activity_label(tool: &str) -> &'static str {
	if is_question_tool(tool) {
		return "Writing a question…";
	}
	match tool {
		"read" => "Reading a file…",
		"ls" => "Listing a directory…",
		"find" => "Finding files…",
		"grep" => "Searching file contents…",
		"research" => "Dispatching research…",
		"demo" => "Building a demo…",
		"visual" => "Making a visual…",
		"pdf" => "Reading a PDF…",
		"plan_init" => "Drawing up the plan…",
		"probe_done" => "Concluding the assessment…",
		"post_problems" => "Listing the problems…",
		_ => "Working…",
	}
}
