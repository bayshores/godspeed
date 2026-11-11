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
