//! What the teacher's tool calls show on a lesson's desk while it writes a reply: a step in plain
//! words, the plan its work_plan call shows, or nothing (a question, a problem, a change the
//! lesson shows by itself). Godspeed's reads say what Follow's slip says; the file tools, the job
//! tools and the PDF reader's progress have their own words. Pure: names come from the caller,
//! and the caller finds a read file on the computer.

use gs_base::text;
use gs_json::{Json, json};

use super::teacher_steps::{RoundCall, StepNames, TeacherStep, quoted, round_call};
use crate::contracts::space::{extension_of, is_recording_file};
use crate::records::agent_actions::short_label;

/// What one tool call in a lesson reply is for the desk.
#[derive(Debug, PartialEq)]
pub enum LessonCall {
	/// work_plan's plan: `{items, done}`.
	Plan(Json),
	Step(TeacherStep),
	/// A question, a problem, a change: the lesson text shows it.
	Quiet,
}

/// The file a step reads, as its call names it.
#[derive(Debug, PartialEq)]
pub enum StepFile {
	/// A path the read or pdf tool was given, at the lines a read names.
	Path { path: String, from: Option<u64>, to: Option<u64> },
	/// The space file passage read_passage opens.
	Passage,
}

/// The tools a lesson reply sends that the lesson text shows by itself.
const QUIET_TOOLS: [&str; 22] = [
	"quiz",
	"probe",
	"ask_user_question",
	"explain",
	"recall",
	"write_code",
	"problem",
	"conclude",
	"part",
	"post_problems",
	"plot",
	"visual",
	"topic_done",
	"plan_init",
	"probe_done",
	"set_space_note",
	"save_rule",
	"write_vault_note",
	"open_page",
	"add_space_deadline",
	"update_space_deadline",
	"remove_space_deadline",
];

/// What a call of the lesson tool `tool` is for the desk. `space_id` is the lesson's space, which
/// its space tools take without naming it. None for a tool not decided here; a test in the
/// services holds every lesson tool to a decision.
pub fn lesson_call(tool: &str, args: &Json, space_id: Option<&str>, names: &dyn StepNames) -> Option<LessonCall> {
	let path = path_arg(args).map(base_name);
	let step = |words: String| Some(LessonCall::Step(TeacherStep { text: short_label(&words), link: None }));
	match tool {
		"work_plan" => Some(plan_of(args).map_or(LessonCall::Quiet, LessonCall::Plan)),
		"read" => match (path, step_file(tool, args)) {
			(Some(name), Some(StepFile::Path { from: Some(from), to: Some(to), .. })) => step(format!("Reading {name}, lines {from} to {to}")),
			(Some(name), Some(StepFile::Path { from: Some(from), .. })) => step(format!("Reading {name}, from line {from}")),
			(Some(name), _) => step(format!("Reading {name}")),
			(None, _) => step("Reading a file".to_owned()),
		},
		"grep" => match (path, args["pattern"].as_str().map(text::trim).filter(|p| !p.is_empty())) {
			(Some(name), Some(pattern)) => step(format!("Searching {name} for {}", quoted(pattern))),
			(None, Some(pattern)) => step(format!("Searching files for {}", quoted(pattern))),
			(_, None) => step("Searching files".to_owned()),
		},
		"find" => step("Looking for files".to_owned()),
		"ls" => step(path.map_or_else(|| "Looking in your home folder".to_owned(), |name| format!("Looking in {name}"))),
		"pdf" => step(path.map_or_else(|| "Reading a PDF".to_owned(), |name| format!("Reading {name}"))),
		"research" => step("Checking the web".to_owned()),
		"demo" => step("Building a demo".to_owned()),
		"list_spaces" | "read_space" | "search_space_files" | "read_passage" | "search_graph" => {
			let mut args = args.clone();
			if let (Some(space_id), Some(obj)) = (space_id, args.as_obj_mut()) {
				obj.insert("space_id", space_id);
			}
			match round_call(tool, &args, names) {
				Some(RoundCall::Step(step)) => Some(LessonCall::Step(TeacherStep { link: None, ..step })),
				_ => Some(LessonCall::Quiet),
			}
		}
		_ if QUIET_TOOLS.contains(&tool) => Some(LessonCall::Quiet),
		_ => None,
	}
}

/// What one data-tool call in a talk chat is for its desk and the teacher's round: a read is a
/// step in Follow's words, with the file link Follow's slip opens; a change is quiet, since the
/// activity log names it. None for a tool not decided here.
pub fn talk_call(tool: &str, args: &Json, _space_id: Option<&str>, names: &dyn StepNames) -> Option<LessonCall> {
	Some(match round_call(tool, args, names)? {
		RoundCall::Step(step) => LessonCall::Step(step),
		RoundCall::Logged => LessonCall::Quiet,
	})
}

/// The file a call of `tool` reads, when it reads one: the read tool's (at its lines), the pdf
/// job's, read_passage's passage.
pub fn step_file(tool: &str, args: &Json) -> Option<StepFile> {
	let line = |key: &str| args[key].as_f64().filter(|n| n.fract() == 0.0 && *n >= 1.0).map(|n| n as u64);
	match tool {
		"read" => {
			let (from, limit) = (line("offset"), line("limit"));
			let to = from.zip(limit).map(|(from, limit)| from + limit - 1);
			Some(StepFile::Path { path: path_arg(args)?.to_owned(), from, to })
		}
		"pdf" => Some(StepFile::Path { path: path_arg(args)?.to_owned(), from: None, to: None }),
		"read_passage" => Some(StepFile::Passage),
		_ => None,
	}
}

fn path_arg(args: &Json) -> Option<&str> {
	args["path"].as_str().map(text::trim).filter(|p| !p.is_empty())
}

/// work_plan's items and how many are done, held to the items there are.
fn plan_of(args: &Json) -> Option<Json> {
	let items = args["items"].as_arr().filter(|items| !items.is_empty() && items.iter().all(|i| i.as_str().is_some_and(|s| !s.is_empty())))?;
	let done = args["done"].as_f64()?;
	Some(json!({ "items": items.clone(), "done": done.trunc().clamp(0.0, items.len() as f64) }))
}

/// The PDF reader's progress line ("pdf_extract: 3-5") about `name`, as a step and the first page
/// it is on. None for a line that is no step (its start, its end, another job's tools).
pub fn pdf_progress(line: &str, name: &str) -> Option<(TeacherStep, Option<u64>)> {
	let (verb, arg) = line.split_once(':').map_or((line, ""), |(verb, arg)| (verb, text::trim(arg)));
	let (words, page) = match verb {
		"pdf_info" => (format!("Skimming {name}"), None),
		"pdf_search" => match text::trim(arg.strip_prefix('"').and_then(|a| a.strip_suffix('"')).unwrap_or(arg)) {
			"" => (format!("Searching {name}"), None),
			query => (format!("Searching {name} for {}", quoted(query)), None),
		},
		"save_page" => {
			let page = arg.parse::<u64>().ok().filter(|p| *p > 0)?;
			(format!("Keeping page {page} of {name}"), Some(page))
		}
		"pdf_extract" | "pdf_render" => {
			let span = page_span(arg.split('@').next().unwrap_or_default());
			let pages = span.map(|(first, last)| if first == last { format!("page {first}") } else { format!("pages {first} to {last}") });
			let words = match (verb, pages) {
				("pdf_extract", Some(pages)) => format!("Reading {pages} of {name}"),
				("pdf_extract", None) => format!("Reading every page of {name}"),
				(_, Some(pages)) => format!("Looking closely at {pages} of {name}"),
				(_, None) => format!("Looking closely at {name}"),
			};
			(words, span.map(|(first, _)| first))
		}
		_ => return None,
	};
	Some((TeacherStep { text: short_label(&words), link: None }, page))
}

/// A page spec ("3", "3-5", "1,3,7") as its first and last page; "all" or anything else is None.
fn page_span(spec: &str) -> Option<(u64, u64)> {
	let pages: Vec<u64> = spec.split([',', '-']).filter_map(|n| text::trim(n).parse().ok()).filter(|n| *n > 0).collect();
	Some((*pages.iter().min()?, *pages.iter().max()?))
}

/// How the desk's paper draws a file, by its name: "pdf" pages, "other" for a sheet with only its
/// name (Word, PowerPoint, EPUB), "text" pages otherwise. None for a picture or a recording,
/// which the desk does not show.
pub fn desk_kind(name: &str) -> Option<&'static str> {
	match extension_of(name).as_str() {
		".pdf" => Some("pdf"),
		".docx" | ".pptx" | ".epub" => Some("other"),
		".jpg" | ".jpeg" | ".png" | ".gif" | ".webp" | ".bmp" => None,
		_ if is_recording_file(name) => None,
		_ => Some("text"),
	}
}

/// A path's last part ("Week 7.md").
pub fn base_name(path: &str) -> &str {
	path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().filter(|n| !n.is_empty()).unwrap_or(path)
}

#[cfg(test)]
mod tests {
	use super::*;

	struct Names;

	impl StepNames for Names {
		fn space(&self, id: &str) -> Option<String> {
			(id == "spc_1").then(|| "CSE 29".to_owned())
		}
		fn file(&self, space_id: &str, file_id: &str) -> Option<String> {
			(space_id == "spc_1" && file_id == "f_0123456789ab").then(|| "PA4.pdf".to_owned())
		}
		fn lesson(&self, _: &str) -> Option<String> {
			None
		}
		fn obsidian(&self) -> bool {
			false
		}
	}

	fn call(tool: &str, args: Json) -> Option<LessonCall> {
		lesson_call(tool, &args, Some("spc_1"), &Names)
	}

	fn words(tool: &str, args: Json) -> String {
		match call(tool, args) {
			Some(LessonCall::Step(step)) => step.text,
			other => panic!("{tool}: {other:?}"),
		}
	}

	#[test]
	fn the_file_tools_say_what_they_read() {
		assert_eq!(words("read", json!({ "path": "/Users/a/CSE 29/Week 7.md", "offset": 1, "limit": 21 })), "Reading Week 7.md, lines 1 to 21");
		assert_eq!(words("read", json!({ "path": "Week 7.md", "offset": 40 })), "Reading Week 7.md, from line 40");
		assert_eq!(words("read", json!({ "path": "notes\\Week 7.md" })), "Reading Week 7.md");
		assert_eq!(words("grep", json!({ "path": "/a/Week 7.md", "pattern": "malloc" })), "Searching Week 7.md for “malloc”");
		assert_eq!(words("grep", json!({ "pattern": "malloc" })), "Searching files for “malloc”");
		assert_eq!(words("find", json!({ "pattern": "*.md" })), "Looking for files");
		assert_eq!(words("ls", json!({ "path": "/Users/a/CSE 29/" })), "Looking in CSE 29");
		assert_eq!(words("ls", json!({})), "Looking in your home folder");
		assert_eq!(words("pdf", json!({ "path": "/a/HW7.pdf", "question": "q" })), "Reading HW7.pdf");
		assert_eq!(words("research", json!({ "question": "q" })), "Checking the web");
		assert_eq!(words("demo", json!({ "title": "t", "brief": "b" })), "Building a demo");
	}

	#[test]
	fn a_read_names_its_file_and_lines_for_the_paper() {
		assert_eq!(step_file("read", &json!({ "path": "Week 7.md", "offset": 3, "limit": 10 })), Some(StepFile::Path { path: "Week 7.md".to_owned(), from: Some(3), to: Some(12) }));
		assert_eq!(step_file("read", &json!({ "path": "Week 7.md", "limit": 10 })), Some(StepFile::Path { path: "Week 7.md".to_owned(), from: None, to: None }));
		assert_eq!(step_file("pdf", &json!({ "path": " HW7.pdf " })), Some(StepFile::Path { path: "HW7.pdf".to_owned(), from: None, to: None }));
		assert_eq!(step_file("read_passage", &json!({ "passage_id": "f_0123456789ab:3" })), Some(StepFile::Passage));
		assert_eq!(step_file("grep", &json!({ "path": "a.md", "pattern": "x" })), None, "a search reads no one place");
		assert_eq!(step_file("read", &json!({})), None);
	}

	#[test]
	fn the_lesson_s_space_tools_say_what_follow_s_slip_says_in_its_space() {
		assert_eq!(words("read_space", json!({})), "Looking at CSE 29");
		assert_eq!(words("search_space_files", json!({ "query": "pointers" })), "Searching CSE 29 for “pointers”");
		assert_eq!(words("read_passage", json!({ "file_id": "f_0123456789ab", "range": "p. 2" })), "Reading PA4.pdf, page 2");
		assert_eq!(words("search_graph", json!({ "query": "pointers" })), "Searching your graph for “pointers”");
		assert_eq!(words("list_spaces", json!({})), "Looking at your spaces");
		let Some(LessonCall::Step(step)) = call("read_passage", json!({ "passage_id": "f_0123456789ab:3" })) else { panic!() };
		assert_eq!(step.link, None, "the desk opens no source pop-up");
		assert_eq!(lesson_call("read_space", &json!({}), None, &Names).map(|c| matches!(c, LessonCall::Step(..))), Some(true));
	}

	#[test]
	fn work_plan_is_the_plan_and_what_the_lesson_shows_is_quiet() {
		assert_eq!(call("work_plan", json!({ "items": ["Read PA4", "Find the bug", "Explain"], "done": 1 })), Some(LessonCall::Plan(json!({ "items": ["Read PA4", "Find the bug", "Explain"], "done": 1 }))));
		assert_eq!(call("work_plan", json!({ "items": ["A", "B", "C"], "done": 7 })), Some(LessonCall::Plan(json!({ "items": ["A", "B", "C"], "done": 3 }))));
		assert_eq!(call("work_plan", json!({ "items": [], "done": 0 })), Some(LessonCall::Quiet));
		for tool in QUIET_TOOLS {
			assert_eq!(call(tool, json!({})), Some(LessonCall::Quiet), "{tool}");
		}
		assert_eq!(call("a_new_tool", json!({})), None, "a tool nobody decided");
	}

	#[test]
	fn the_pdf_reader_s_progress_says_where_in_the_file_it_is() {
		let progress = |line: &str| pdf_progress(line, "HW7.pdf").map(|(step, page)| (step.text, page));
		assert_eq!(progress("pdf_info: triaging"), Some(("Skimming HW7.pdf".to_owned(), None)));
		assert_eq!(progress("pdf_search: \"loop invariant\""), Some(("Searching HW7.pdf for “loop invariant”".to_owned(), None)));
		assert_eq!(progress("pdf_search: \"\""), Some(("Searching HW7.pdf".to_owned(), None)));
		assert_eq!(progress("pdf_extract: 3-5"), Some(("Reading pages 3 to 5 of HW7.pdf".to_owned(), Some(3))));
		assert_eq!(progress("pdf_extract: 1,7,3"), Some(("Reading pages 1 to 7 of HW7.pdf".to_owned(), Some(1))));
		assert_eq!(progress("pdf_extract: all"), Some(("Reading every page of HW7.pdf".to_owned(), None)));
		assert_eq!(progress("pdf_render: 4 @150dpi"), Some(("Looking closely at page 4 of HW7.pdf".to_owned(), Some(4))));
		assert_eq!(progress("save_page: 7"), Some(("Keeping page 7 of HW7.pdf".to_owned(), Some(7))));
		for line in ["reading pdf", "finished", "failed", "write_demo", "save_page: x"] {
			assert_eq!(progress(line), None, "{line}");
		}
	}

	#[test]
	fn the_desk_draws_pdfs_text_and_named_sheets_and_never_pictures() {
		assert_eq!(desk_kind("HW7.PDF"), Some("pdf"));
		assert_eq!(desk_kind("Slides.pptx"), Some("other"));
		assert_eq!(desk_kind("Book.epub"), Some("other"));
		assert_eq!(desk_kind("Week 7.md"), Some("text"));
		assert_eq!(desk_kind("main.c"), Some("text"));
		assert_eq!(desk_kind("photo.jpeg"), None);
		assert_eq!(desk_kind("Lecture 3.mp4"), None);
	}
}
