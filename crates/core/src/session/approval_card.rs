//! What a lesson's desk says about a permission question the agent waits on: one sentence in the
//! teacher's name, and what it is about (the command, the file, the site, the search, the tool or
//! the question) as its own object, which the window draws beside the sentence. Pure.

use gs_json::{Json, json};

use super::lesson_steps::base_name;

/// What a card's subject is, by name, in `Subject` order (the window's `APPROVAL_SUBJECTS`).
pub const APPROVAL_SUBJECTS: [&str; 6] = ["command", "file", "site", "search", "tool", "words"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Subject {
	/// A command to run, in the agent's own type.
	Command,
	/// A file's name.
	File,
	/// A site's name.
	Site,
	/// The words of a web search.
	Search,
	/// One of the agent's own tools, by its name.
	Tool,
	/// What the agent asks, in its own words.
	Words,
}

/// The card's sentence, and its subject when it has one.
fn card(text: String, subject: Option<(Subject, &str)>) -> Json {
	let subject = subject.map(|(kind, words)| json!({ "kind": APPROVAL_SUBJECTS[kind as usize], "text": words }));
	json!({ "text": text, "subject": subject })
}

fn site_of(url: &str) -> Option<String> {
	url::Url::parse(url).ok()?.host_str().map(str::to_owned)
}

/// One of Claude Code's own tools, by what it does to the learner's computer.
fn tool_card(teacher: &str, name: &str, input: &Json) -> Json {
	let field = |key: &str| input[key].as_str().map(str::trim).filter(|v| !v.is_empty());
	let file = field("file_path").or_else(|| field("notebook_path")).map(base_name);
	let file_card = |verb: &str| match file {
		Some(name) => card(format!("{teacher} wants to {verb} this file."), Some((Subject::File, name))),
		None => card(format!("{teacher} wants to {verb} a file."), None),
	};
	match name {
		"Bash" => card(format!("{teacher} wants to run this command."), field("command").map(|c| (Subject::Command, c))),
		"Edit" | "MultiEdit" | "Write" | "NotebookEdit" => file_card("change"),
		"Read" => file_card("read"),
		"WebFetch" => match field("url").and_then(site_of) {
			Some(site) => card(format!("{teacher} wants to open a page on this site."), Some((Subject::Site, &site))),
			None => card(format!("{teacher} wants to open a web page."), None),
		},
		"WebSearch" => match field("query") {
			Some(query) => card(format!("{teacher} wants to search the web for this."), Some((Subject::Search, query))),
			None => card(format!("{teacher} wants to search the web."), None),
		},
		_ => card(format!("{teacher} wants to use this tool."), Some((Subject::Tool, name))),
	}
}

/// The card for `ask`, a permission question as the lesson's turn passes it on (`{kind, ...}`):
/// `{text, subject}`, where `subject` is `{kind, text}` or null.
pub fn approval_card(ask: &Json, teacher: &str) -> Json {
	let field = |key: &str| ask[key].as_str().map(str::trim).filter(|v| !v.is_empty());
	match ask["kind"].as_str() {
		Some("tool") => tool_card(teacher, ask["name"].str_or_empty(), &ask["input"]),
		Some("command") => card(format!("{teacher} wants to run this command."), field("command").map(|c| (Subject::Command, c))),
		Some("fileChange") => card(format!("{teacher} wants to change files."), None),
		Some("permissions") => card(format!("{teacher} wants more access to your computer."), None),
		Some("question") => {
			let asked: Vec<&str> = ask["questions"].items().iter().filter_map(|q| q["question"].as_str().map(str::trim).filter(|q| !q.is_empty())).collect();
			let words = asked.join("\n");
			card(format!("{teacher} has a question."), (!words.is_empty()).then_some((Subject::Words, words.as_str())))
		}
		Some("elicitation") => card(format!("{teacher} asks for your answer."), field("message").map(|m| (Subject::Words, m))),
		_ => card(format!("{teacher} wants your permission."), None),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn said(ask: Json) -> (String, Json) {
		let card = approval_card(&ask, "Claude");
		(card["text"].str_or_empty().to_owned(), card["subject"].clone())
	}

	fn subject(kind: &str, text: &str) -> Json {
		json!({ "kind": kind, "text": text })
	}

	#[test]
	fn a_command_is_its_own_object_under_the_sentence() {
		assert_eq!(said(json!({ "kind": "tool", "name": "Bash", "input": { "command": " ls -la " } })), ("Claude wants to run this command.".to_owned(), subject("command", "ls -la")));
		assert_eq!(said(json!({ "kind": "command", "command": "npm test", "cwd": "/w", "reason": null })), ("Claude wants to run this command.".to_owned(), subject("command", "npm test")));
		assert_eq!(said(json!({ "kind": "tool", "name": "Bash", "input": {} })).1, Json::Null);
	}

	#[test]
	fn a_tool_names_its_file_site_or_search_as_the_subject() {
		assert_eq!(said(json!({ "kind": "tool", "name": "Edit", "input": { "file_path": "/Users/a/notes/week 3.md" } })), ("Claude wants to change this file.".to_owned(), subject("file", "week 3.md")));
		assert_eq!(said(json!({ "kind": "tool", "name": "Write", "input": {} })), ("Claude wants to change a file.".to_owned(), Json::Null));
		assert_eq!(said(json!({ "kind": "tool", "name": "Read", "input": { "file_path": "C:\\work\\hw.pdf" } })), ("Claude wants to read this file.".to_owned(), subject("file", "hw.pdf")));
		assert_eq!(said(json!({ "kind": "tool", "name": "WebFetch", "input": { "url": "https://docs.python.org/3/x.html" } })), ("Claude wants to open a page on this site.".to_owned(), subject("site", "docs.python.org")));
		assert_eq!(said(json!({ "kind": "tool", "name": "WebFetch", "input": { "url": "nope" } })), ("Claude wants to open a web page.".to_owned(), Json::Null));
		assert_eq!(said(json!({ "kind": "tool", "name": "WebSearch", "input": { "query": "limits" } })), ("Claude wants to search the web for this.".to_owned(), subject("search", "limits")));
		assert_eq!(said(json!({ "kind": "tool", "name": "Glob", "input": {} })), ("Claude wants to use this tool.".to_owned(), subject("tool", "Glob")));
	}

	#[test]
	fn codex_s_other_asks_are_plain_words() {
		assert_eq!(said(json!({ "kind": "fileChange", "reason": null })), ("Claude wants to change files.".to_owned(), Json::Null));
		assert_eq!(said(json!({ "kind": "permissions", "reason": null, "permissions": {} })), ("Claude wants more access to your computer.".to_owned(), Json::Null));
		assert_eq!(said(json!({ "kind": "question", "questions": [{ "id": "q", "question": "Which file?" }, { "id": "r" }, { "question": "Why?" }] })), ("Claude has a question.".to_owned(), subject("words", "Which file?\nWhy?")));
		assert_eq!(said(json!({ "kind": "question", "questions": [] })).1, Json::Null);
		assert_eq!(said(json!({ "kind": "elicitation", "server": "github", "message": "Pick a repo." })), ("Claude asks for your answer.".to_owned(), subject("words", "Pick a repo.")));
		assert_eq!(said(json!({ "kind": "launch" })), ("Claude wants your permission.".to_owned(), Json::Null));
	}

	#[test]
	fn no_sentence_has_a_long_dash() {
		for kind in ["fileChange", "permissions", "question", "elicitation", "launch"] {
			assert!(!said(json!({ "kind": kind })).0.contains('—'), "{kind}");
		}
	}
}
