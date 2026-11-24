//! What the teacher's tool calls show while it works, for Follow's slip. A godspeed read or note
//! is a step in plain words. The work loop is none, and neither is a godspeed change: every change
//! already writes the activity log, which the window shows beside the steps. The agent's own
//! tools (web search, file reads, commands) are steps too. Pure: the names a step uses come from
//! the caller. A lesson's desk keeps steps the same way (`lesson_steps`).

use std::collections::VecDeque;

use gs_base::{ids, text, time};
use gs_json::{Json, Obj};

use crate::records::agent_actions::short_label;

/// What one tool call is for the teacher's round of work.
#[derive(Debug, PartialEq)]
pub enum RoundCall {
	/// wait_for_work, respond and read_work.
	WorkLoop,
	/// A change, which the activity log names: no step, but the teacher is at work.
	Logged,
	/// A read or a note.
	Step(TeacherStep),
}

/// One step: its words, and what a click on it opens (for a file read, that passage).
#[derive(Clone, Debug, PartialEq)]
pub struct TeacherStep {
	pub text: String,
	pub link: Option<Json>,
}

/// The names a step's words use, looked up only when a step needs one.
pub trait StepNames {
	fn space(&self, id: &str) -> Option<String>;
	fn file(&self, space_id: &str, file_id: &str) -> Option<String>;
	fn lesson(&self, id: &str) -> Option<String>;
	/// The notes folder is one Obsidian knows, so the window calls it "Obsidian".
	fn obsidian(&self) -> bool;
}

/// What a call of `tool` with these arguments is. None for a tool not decided here; every
/// listed tool is (a test in the server holds them together).
pub fn round_call(tool: &str, args: &Json, names: &dyn StepNames) -> Option<RoundCall> {
	let subject = |key: &str| args[key].as_str().map(text::trim).filter(|s| !s.is_empty()).map(quoted);
	let space = || args["space_id"].as_str().and_then(|id| names.space(id));
	let some_space = || space().unwrap_or_else(|| "a space".to_owned());
	let notes = || if names.obsidian() { "Obsidian" } else { "your notes folder" };
	let words = match tool {
		"wait_for_work" | "respond" | "read_work" => return Some(RoundCall::WorkLoop),
		"import_notes" | "create_space" | "update_space" | "add_space_file" | "set_space_file_kind" | "add_space_deadline" | "update_space_deadline" | "remove_space_deadline" | "link_space_folder" | "unlink_space_folder" | "start_lesson" | "open_page" => {
			return Some(RoundCall::Logged);
		}
		"read_passage" => return Some(RoundCall::Step(read_passage(args, names))),
		"list_spaces" => "Looking at your spaces".to_owned(),
		"read_space" => format!("Looking at {}", some_space()),
		"search_space_files" => match subject("query") {
			Some(query) => format!("Searching {} for {query}", some_space()),
			None => format!("Searching {}", some_space()),
		},
		"list_lessons" => match space() {
			Some(name) => format!("Looking at lessons in {name}"),
			None => "Looking at your lessons".to_owned(),
		},
		"read_lesson" => match args["lesson_id"].as_str().and_then(|id| names.lesson(id)) {
			Some(title) => format!("Reading the lesson {}", quoted(text::trim(&title))),
			None => "Reading a lesson".to_owned(),
		},
		"search_graph" => match subject("query") {
			Some(query) => format!("Searching your graph for {query}"),
			None => "Looking at your graph".to_owned(),
		},
		"search_vault" => match (subject("query"), args["path"].as_str().map(note_name).filter(|n| !n.is_empty())) {
			(Some(query), _) => format!("Searching {} for {query}", notes()),
			(None, Some(note)) => format!("Reading {} in {}", quoted(&note), notes()),
			(None, None) => format!("Searching {}", notes()),
		},
		"write_vault_note" => match subject("title") {
			Some(title) => format!("Saving {title} to {}", notes()),
			None => format!("Saving a note to {}", notes()),
		},
		"remember" => "Remembering a note".to_owned(),
		"forget" => "Forgetting a note".to_owned(),
		"save_rule" => "Saving a teaching rule".to_owned(),
		_ => return None,
	};
	Some(RoundCall::Step(TeacherStep { text: short_label(&words), link: None }))
}

/// The agent's own tools that show as steps, by the names Claude Code's hook gives them; its
/// hook's matcher is these.
pub const CLAUDE_OWN_TOOLS: [&str; 9] = ["WebSearch", "WebFetch", "Read", "Grep", "Glob", "Bash", "Edit", "Write", "NotebookEdit"];
/// Codex's hook reports only its commands and its patches.
pub const CODEX_OWN_TOOLS: [&str; 2] = ["Bash", "apply_patch"];

/// One of the agent's own tools, with the subject its hook kept (a file's or a site's name, the
/// web search's words, a search's plain words). None for a tool not listed above.
pub fn own_tool_step(tool: &str, subject: Option<&str>) -> Option<TeacherStep> {
	let subject = subject.map(text::trim).filter(|s| !s.is_empty());
	let words = match (tool, subject) {
		("WebSearch", Some(query)) => format!("Searching the web for {}", quoted(query)),
		("WebSearch", None) => "Searching the web".to_owned(),
		("WebFetch" | "Read", Some(name)) => format!("Reading {name}"),
		("WebFetch", None) => "Reading a web page".to_owned(),
		("Read", None) => "Reading a file".to_owned(),
		("Grep", Some(words)) => format!("Searching files for {}", quoted(words)),
		("Grep", None) => "Searching files".to_owned(),
		("Glob", _) => "Looking for files".to_owned(),
		("Bash", _) => "Running a command".to_owned(),
		("Edit" | "Write" | "NotebookEdit" | "apply_patch", _) => "Changing files".to_owned(),
		_ => return None,
	};
	Some(TeacherStep { text: short_label(&words), link: None })
}

/// A list of steps keeps this many; the oldest go first.
pub const STEPS_MAX: usize = 40;

/// A step as the window reads it: its own id, its time and its words. The caller adds the rest.
pub fn step_head(text: String, now: i64) -> Obj {
	let mut out = Obj::new();
	out.insert("id", ids::uuid_hex("step", 12));
	out.insert("at", time::iso(now));
	out.insert("text", text);
	out
}

/// Adds `step` after the others, dropping the oldest past `STEPS_MAX`.
pub fn keep_step(steps: &mut VecDeque<Json>, step: Json) {
	steps.push_back(step);
	if steps.len() > STEPS_MAX {
		steps.pop_front();
	}
}

/// Words the learner or the agent wrote, in the quotes the window's lines use.
pub(crate) fn quoted(words: &str) -> String {
	format!("“{words}”")
}

/// A note's name from its path in the notes folder: the file's name without ".md".
fn note_name(path: &str) -> String {
	let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
	text::trim(file.strip_suffix(".md").unwrap_or(file)).to_owned()
}

/// The page a place names ("p. 12"), when it names one.
fn page_of(range: &str) -> Option<&str> {
	let page = text::trim(text::trim(range).strip_prefix("p.")?);
	(!page.is_empty() && page.bytes().all(|b| b.is_ascii_digit())).then_some(page)
}

/// read_passage takes a passage id ("<file id>:<n>"), or a file id with a place. The page is named
/// only when the place says it; the file is never read to find it. A click opens the passage in the
/// source pop-up, so the link carries the space, the file, its name and the passage or place.
fn read_passage(args: &Json, names: &dyn StepNames) -> TeacherStep {
	let space_id = args["space_id"].str_or_empty();
	let passage = args["passage_id"].as_str().filter(|p| !p.is_empty());
	let range = args["range"].as_str().filter(|r| !r.is_empty());
	let (file_id, at) = match passage {
		Some(id) => {
			let (file, n) = id.split_once(':').unwrap_or((id, ""));
			(file, n.parse::<u64>().ok().map(|n| ("passage", Json::from(n))))
		}
		None => (args["file_id"].str_or_empty(), range.map(|r| ("range", Json::from(r)))),
	};
	let name = (!file_id.is_empty()).then(|| names.file(space_id, file_id)).flatten();
	let page = if passage.is_none() { range.and_then(page_of) } else { None };
	let words = match (&name, page) {
		(Some(name), Some(page)) => format!("Reading {name}, page {page}"),
		(Some(name), None) => format!("Reading {name}"),
		(None, _) => "Reading a file".to_owned(),
	};
	let link = name.zip(at).map(|(name, (key, value))| {
		let mut link = Obj::new();
		link.insert("spaceId", space_id);
		link.insert("fileId", file_id);
		link.insert("name", name);
		link.insert(key, value);
		Json::Obj(link)
	});
	TeacherStep { text: short_label(&words), link }
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;
	use crate::records::agent_actions::LABEL_MAX;

	struct Names {
		obsidian: bool,
	}

	impl StepNames for Names {
		fn space(&self, id: &str) -> Option<String> {
			(id == "spc_1").then(|| "CSE 21".to_owned())
		}
		fn file(&self, space_id: &str, file_id: &str) -> Option<String> {
			(space_id == "spc_1" && file_id == "f_0123456789ab").then(|| "HW7_F26.pdf".to_owned())
		}
		fn lesson(&self, id: &str) -> Option<String> {
			(id == "chat_1").then(|| "Limits".to_owned())
		}
		fn obsidian(&self) -> bool {
			self.obsidian
		}
	}

	const OBSIDIAN: Names = Names { obsidian: true };

	fn words(tool: &str, args: Json) -> String {
		match round_call(tool, &args, &OBSIDIAN) {
			Some(RoundCall::Step(step)) => step.text,
			other => panic!("{tool}: {other:?}"),
		}
	}

	#[test]
	fn the_work_loop_and_the_changes_make_no_step() {
		for tool in ["wait_for_work", "respond", "read_work"] {
			assert_eq!(round_call(tool, &json!({}), &OBSIDIAN), Some(RoundCall::WorkLoop), "{tool}");
		}
		for tool in ["import_notes", "create_space", "update_space", "add_space_file", "set_space_file_kind", "add_space_deadline", "update_space_deadline", "remove_space_deadline", "link_space_folder", "unlink_space_folder", "start_lesson", "open_page"] {
			assert_eq!(round_call(tool, &json!({ "space_id": "spc_1" }), &OBSIDIAN), Some(RoundCall::Logged), "{tool}");
		}
		assert_eq!(round_call("a_new_tool", &json!({}), &OBSIDIAN), None, "a tool nobody decided");
	}

	#[test]
	fn reads_and_notes_say_what_they_look_at() {
		assert_eq!(words("list_spaces", json!({})), "Looking at your spaces");
		assert_eq!(words("read_space", json!({ "space_id": "spc_1" })), "Looking at CSE 21");
		assert_eq!(words("search_space_files", json!({ "space_id": "spc_1", "query": " due " })), "Searching CSE 21 for “due”");
		assert_eq!(words("list_lessons", json!({})), "Looking at your lessons");
		assert_eq!(words("list_lessons", json!({ "space_id": "none" })), "Looking at your lessons");
		assert_eq!(words("list_lessons", json!({ "space_id": "spc_1" })), "Looking at lessons in CSE 21");
		assert_eq!(words("read_lesson", json!({ "lesson_id": "chat_1", "page": 2 })), "Reading the lesson “Limits”");
		assert_eq!(words("search_graph", json!({ "query": "x" })), "Searching your graph for “x”");
		assert_eq!(words("search_graph", json!({ "space_id": "spc_1" })), "Looking at your graph");
		assert_eq!(words("search_vault", json!({ "query": "x" })), "Searching Obsidian for “x”");
		assert_eq!(words("search_vault", json!({ "path": "CSE 21/Limits.md" })), "Reading “Limits” in Obsidian");
		assert_eq!(words("write_vault_note", json!({ "space_id": "spc_1", "topic_id": "t", "title": "Title" })), "Saving “Title” to Obsidian");
		assert_eq!(words("write_vault_note", json!({ "space_id": "spc_1", "topic_id": "t", "covered_by": "Mine.md" })), "Saving a note to Obsidian");
		assert_eq!(words("remember", json!({ "text": "Likes Python" })), "Remembering a note");
		assert_eq!(words("forget", json!({ "note_id": "n" })), "Forgetting a note");
		assert_eq!(words("save_rule", json!({ "rule": "Use Python." })), "Saving a teaching rule");
	}

	#[test]
	fn a_notes_folder_obsidian_does_not_know_is_called_your_notes_folder() {
		let plain = Names { obsidian: false };
		let step = |tool: &str, args: Json| match round_call(tool, &args, &plain) {
			Some(RoundCall::Step(step)) => step.text,
			other => panic!("{other:?}"),
		};
		assert_eq!(step("search_vault", json!({ "query": "x" })), "Searching your notes folder for “x”");
		assert_eq!(step("write_vault_note", json!({ "title": "Title" })), "Saving “Title” to your notes folder");
	}

	#[test]
	fn a_name_that_is_not_found_reads_plainly() {
		assert_eq!(words("read_space", json!({ "space_id": "spc_gone" })), "Looking at a space");
		assert_eq!(words("search_space_files", json!({ "space_id": "spc_gone", "query": "due" })), "Searching a space for “due”");
		assert_eq!(words("list_lessons", json!({ "space_id": "spc_gone" })), "Looking at your lessons");
		assert_eq!(words("read_lesson", json!({ "lesson_id": "chat_gone" })), "Reading a lesson");
		assert_eq!(words("read_passage", json!({ "space_id": "spc_1", "passage_id": "f_gone:3" })), "Reading a file");
	}

	#[test]
	fn a_file_read_names_its_page_only_when_the_call_says_it_and_links_its_passage() {
		let read = |args: Json| match round_call("read_passage", &args, &OBSIDIAN) {
			Some(RoundCall::Step(step)) => step,
			other => panic!("{other:?}"),
		};
		let by_id = read(json!({ "space_id": "spc_1", "passage_id": "f_0123456789ab:3" }));
		assert_eq!(by_id.text, "Reading HW7_F26.pdf");
		assert_eq!(by_id.link, Some(json!({ "spaceId": "spc_1", "fileId": "f_0123456789ab", "name": "HW7_F26.pdf", "passage": 3 })));
		let by_page = read(json!({ "space_id": "spc_1", "file_id": "f_0123456789ab", "range": "p. 1" }));
		assert_eq!(by_page.text, "Reading HW7_F26.pdf, page 1");
		assert_eq!(by_page.link, Some(json!({ "spaceId": "spc_1", "fileId": "f_0123456789ab", "name": "HW7_F26.pdf", "range": "p. 1" })));
		let by_slide = read(json!({ "space_id": "spc_1", "file_id": "f_0123456789ab", "range": "slide 4" }));
		assert_eq!((by_slide.text.as_str(), by_slide.link.is_some()), ("Reading HW7_F26.pdf", true));
		let no_place = read(json!({ "space_id": "spc_1", "file_id": "f_0123456789ab" }));
		assert_eq!((no_place.text.as_str(), no_place.link), ("Reading HW7_F26.pdf", None), "the call itself is refused: nothing to open");
	}

	#[test]
	fn the_agent_s_own_tools_say_what_they_look_at_and_nothing_else() {
		let own = |tool: &str, subject: Option<&str>| own_tool_step(tool, subject).map(|step| (step.text, step.link));
		let words = |tool: &str, subject: Option<&str>| own(tool, subject).map(|(text, _)| text);
		assert_eq!(words("WebSearch", Some(" cse 21 hw7 ")).as_deref(), Some("Searching the web for “cse 21 hw7”"));
		assert_eq!(words("WebFetch", Some("cse29.site")).as_deref(), Some("Reading cse29.site"));
		assert_eq!(words("Read", Some("syllabus.pdf")).as_deref(), Some("Reading syllabus.pdf"));
		assert_eq!(words("Grep", Some("due")).as_deref(), Some("Searching files for “due”"));
		assert_eq!(words("Grep", None).as_deref(), Some("Searching files"));
		assert_eq!(words("Grep", Some("  ")).as_deref(), Some("Searching files"));
		assert_eq!(words("WebSearch", None).as_deref(), Some("Searching the web"));
		assert_eq!(words("WebFetch", None).as_deref(), Some("Reading a web page"));
		assert_eq!(words("Read", None).as_deref(), Some("Reading a file"));
		assert_eq!(words("Glob", Some("x")).as_deref(), Some("Looking for files"), "a glob's pattern is never shown");
		assert_eq!(words("Bash", Some("rm -rf ~")).as_deref(), Some("Running a command"), "a command is never shown");
		for tool in ["Edit", "Write", "NotebookEdit", "apply_patch"] {
			assert_eq!(words(tool, Some("notes.md")).as_deref(), Some("Changing files"), "{tool}");
		}
		for tool in CLAUDE_OWN_TOOLS.iter().chain(&CODEX_OWN_TOOLS) {
			assert_eq!(own(tool, Some("x")).map(|(_, link)| link), Some(None), "{tool}: a step, with nothing to open");
		}
		for tool in ["Agent", "TodoWrite", "mcp__godspeed__read_space", "read_space", "webSearch"] {
			assert_eq!(own_tool_step(tool, None), None, "{tool}");
		}
		let long = words("WebSearch", Some(&"how to find the inverse of a matrix ".repeat(4))).unwrap_or_default();
		assert_eq!(text::len16(&long), LABEL_MAX);
	}

	#[test]
	fn long_words_are_cut_like_the_activity_log_s() {
		let query = "the eigenvalues of a matrix whose characteristic polynomial has a repeated root over the reals";
		let cut = words("search_space_files", json!({ "space_id": "spc_1", "query": format!("{query}\n\n") }));
		assert_eq!(text::len16(&cut), LABEL_MAX);
		assert!(cut.starts_with("Searching CSE 21 for “the eigenvalues") && cut.ends_with('…'), "{cut}");
	}
}
