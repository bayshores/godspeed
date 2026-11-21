//! The homework tools: post_problems saves the assignment's
//! problems (on its assignment file, or on the deadline when it has none), problem opens one in the learner's Your turn panel (it ends the turn,
//! but carries no solution: homework is hints only), part marks the part the learner is on there,
//! conclude closes it and marks it done when the learner's own work was right. The side tools are
//! practice's. A lesson on files posts its first file's problems with the same post_problems.

use std::sync::Arc;

use gs_core::contracts::space::MAX_FILE_PROBLEMS;
use gs_core::messages::native_messages::active_problem_of;
use gs_core::session::question_core::{problem_choice_fields, problem_choice_problems};
use gs_base::clock;
use gs_core::study::homework::{conclude_marks_done, picked_problem};
use gs_core::study::topic_end::long_problem_stop;
use gs_engine::turn::messages::text_block;
use gs_engine::turn::tool_execute::{conclude_result, invalid_input_result, problem_result};
use gs_json::{Json, js_number, json, quote};
use parking_lot::Mutex;

use super::fn_tool::FnTool;
use super::heal::heal_tool_record;
use super::jobs::JobToolContext;
use super::ports::{ChatPort, ProblemPages};
use super::practice::{practice_side_tools, record_messages};
use super::problem_piece::{NO_STATEMENT, source_field, typed, with_piece};
use gs_core::session::schema::{object, one_of_literals, string};
use super::side::LessonSide;

/// The session's problem list, read and written through the space store.
pub trait ProblemList: Send + Sync {
	fn problems(&self) -> Vec<Json>;
	/// Saves the list (done marks kept by number); the refusal text when refused.
	fn post(&self, problems: &[Json]) -> Option<String>;
	fn mark_done(&self, number: &str);
	/// The one file every posted problem is printed in: a lesson on files' first file. None for a
	/// deadline, whose problems may come from any file of the space.
	fn file_id(&self) -> Option<String> {
		None
	}
}

#[derive(Clone)]
pub struct HomeworkToolContext {
	pub chat_id: String,
	pub chat_store: Arc<dyn ChatPort>,
	pub homework: Arc<dyn ProblemList>,
	pub jobs: Option<JobToolContext>,
	pub side: LessonSide,
	/// Cuts problems out of the deadline's assignment file, or of another file of the space.
	pub pages: Arc<dyn ProblemPages>,
}

/// The number of the problem open in the stored record, as the pose wrote it.
fn open_problem_of(ctx: &HomeworkToolContext) -> Option<String> {
	let record = ctx.chat_store.get_chat(&ctx.chat_id)?;
	let active = active_problem_of(record["messages"].items())?;
	Some(match &active.input["number"] {
		Json::Str(number) => number.clone(),
		Json::Num(number) => js_number(*number),
		Json::Bool(flag) => flag.to_string(),
		_ => String::new(),
	})
}

/// The posted problem with this number.
fn stored_problem(homework: &Arc<dyn ProblemList>, number: &str) -> Option<Json> {
	homework.problems().into_iter().find(|p| p["number"].as_str() == Some(number))
}

/// One posted item as the deadline keeps it: with a `source`, its piece of the page (and the
/// piece's words unless the teacher typed the text); `next` is the item after it, whose first
/// words end this one's piece unless the item says where it ends.
async fn posted_problem(item: &Json, next: Option<&Json>, pages: &Arc<dyn ProblemPages>) -> Result<Json, String> {
	let words = typed(&item["text"]);
	let mut posted = item.clone();
	let Some(obj) = posted.as_obj_mut() else { return Ok(posted) };
	let Some(mut source) = obj.remove("source").filter(|source| !source.is_null()) else {
		return if words.is_some() { Ok(posted) } else { Err(NO_STATEMENT.to_owned()) };
	};
	if source["ends"].is_null()
		&& let Some(starts) = next.map(|next| &next["source"]["starts"]).filter(|starts| !starts.is_null())
	{
		source.set("ends", starts.clone());
	}
	let found = pages.find(&source, words).await?;
	let text = words.unwrap_or_else(|| found["text"].str_or_empty());
	if text.is_empty() {
		return Err("the page has no words to read; give the problem's text as well".to_owned());
	}
	let obj = posted.as_obj_mut().ok_or("not a problem")?;
	obj.remove("page");
	obj.insert("text", text);
	obj.insert("piece", found["piece"].clone());
	Ok(posted)
}

/// A lesson on files lists its first file's problems: a source names that file or none.
fn in_lesson_file(item: &Json, file_id: &str) -> Result<Json, String> {
	let mut item = item.clone();
	if let Some(source) = item.get_mut("source").filter(|source| source.as_obj().is_some()) {
		match source["fileId"].as_str().filter(|id| !id.is_empty()) {
			Some(named) if named != file_id => return Err(format!("its source is in {named}, but this lesson lists the problems of {file_id} only")),
			_ => source.set("fileId", file_id),
		}
	}
	Ok(item)
}

/// post_problems: the whole list in one call. With a lesson on files every source is in its first
/// file (`ProblemList::file_id`).
pub(super) fn post_problems_tool(homework: Arc<dyn ProblemList>, pages: Arc<dyn ProblemPages>) -> FnTool {
	let first_file = homework.file_id();
	let default_file = if first_file.is_some() { "the lesson's first file, the only one its list takes." } else { "the deadline's assignment file." };
	let problem = object(
		&["number", "title"],
		vec![
			("number", string("As the assignment numbers it, e.g. \"1\", \"2b\", \"Q3\". Unique.")),
			("title", string("A few words on what it asks.")),
			("text", string("The problem as the assignment states it (markdown + LaTeX), with any parts. Required unless you pass source.")),
			("source", source_field(Some(default_file))),
			("page", json!({ "type": "integer", "minimum": 1, "description": "The assignment page it is on." })),
		],
	);
	let parameters = object(&["problems"], vec![("problems", json!({ "type": "array", "items": problem, "minItems": 1, "maxItems": MAX_FILE_PROBLEMS }))]);
	let description = "Save the assignment's problems, all of them in order, in one call. The learner sees them as the session's list with how many are done. Calling it again replaces the list; a problem keeps its done mark by number.";
	FnTool::immediate_async("post_problems", description, parameters, move |args| {
		let (homework, pages, first_file) = (homework.clone(), pages.clone(), first_file.clone());
		async move {
			let named = |item: &Json| item["number"].str_or_empty().to_owned();
			let items = match &first_file {
				Some(file_id) => match args["problems"].items().iter().map(|item| in_lesson_file(item, file_id).map_err(|why| format!("problem {}: {why}", named(item)))).collect::<Result<Vec<_>, _>>() {
					Ok(items) => items,
					Err(why) => return invalid_input_result("post_problems", &[why]),
				},
				None => args["problems"].items().to_vec(),
			};
			let mut posted = Vec::with_capacity(items.len());
			for (at, item) in items.iter().enumerate() {
				match posted_problem(item, items.get(at + 1), &pages).await {
					Ok(problem) => posted.push(problem),
					Err(why) => return invalid_input_result("post_problems", &[format!("problem {}: {why}", item["number"].str_or_empty())]),
				}
			}
			if let Some(refused) = homework.post(&posted) {
				return invalid_input_result("post_problems", &[refused]);
			}
			json!({ "content": [text_block(&format!("Saved {} problems.", posted.len()))], "details": null })
		}
	})
	.sequential()
}

fn problem_tool(homework: Arc<dyn ProblemList>, open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let open = open.clone();
	let mut fields = vec![
		("number", string("REQUIRED \u{2014} the problem's number as posted with post_problems.")),
		(
			"statement",
			string("The problem as the learner sees it while working (markdown + LaTeX): the assignment's wording, starting with the problem itself, never a title or heading line. Required unless the posted problem was posted with a source. When you pass options, the statement never lists them again and never says how many to pick: the rows say \"Select all that apply\" themselves. Never any part of its answer."),
		),
	];
	fields.extend(problem_choice_fields());
	let parameters = object(&["number"], fields);
	let description = "Open one problem in the learner's Your turn panel, where it stays in view. Ends the turn: the learner's work and questions arrive as their messages (text and photos). Only one problem is open at a time; conclude it before opening the next.";
	FnTool::immediate("problem", description, parameters, move |args| {
		let choice_problems = problem_choice_problems(&args);
		if !choice_problems.is_empty() {
			return invalid_input_result("problem", &choice_problems);
		}
		let mut open = open.lock();
		if let Some(number) = open.as_ref() {
			return invalid_input_result("problem", &[format!("problem {number} is still open \u{2014} conclude it first")]);
		}
		let posted = homework.problems();
		if posted.is_empty() {
			return invalid_input_result("problem", &["no problems are posted yet \u{2014} post them with post_problems first".to_owned()]);
		}
		let number = args["number"].str_or_empty();
		let Some(stored) = posted.iter().find(|p| p["number"].as_str() == Some(number)) else {
			let numbers: Vec<&str> = posted.iter().map(|p| p["number"].str_or_empty()).collect();
			return invalid_input_result("problem", &[format!("no problem numbered {}; the numbers are {}", quote(number), numbers.join(", "))]);
		};
		let piece = Some(&stored["piece"]).filter(|piece| !piece.is_null());
		if piece.is_none() && typed(&args["statement"]).is_none() {
			return invalid_input_result("problem", &[format!("{NO_STATEMENT}; problem {number} has no page of its own")]);
		}
		*open = Some(number.to_owned());
		let posed = problem_result("the learner's work and questions arrive as their messages.");
		match piece {
			Some(piece) => with_piece(posed, &json!({ "piece": piece.clone(), "text": stored["text"].clone() })),
			None => posed,
		}
	})
	.sequential()
}

fn part_tool(homework: Arc<dyn ProblemList>, open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let open = open.clone();
	let parameters = object(&["part"], vec![("part", string("REQUIRED \u{2014} the part as the problem labels it, e.g. \"a\", \"b\", \"2\"."))]);
	let description = "For a problem with parts: mark the part the learner works on now, when they start it. Their panel opens that part and folds the others. Doesn't end the turn.";
	FnTool::immediate("part", description, parameters, move |args| {
		let Some(number) = open.lock().clone() else {
			return invalid_input_result("part", &["no problem is open".to_owned()]);
		};
		// A problem cut from its page knows its parts' labels.
		let labels: Vec<String> = stored_problem(&homework, &number).map(|p| p["piece"]["labels"].items().iter().map(|l| l["label"].str_or_empty().to_owned()).collect()).unwrap_or_default();
		let part = args["part"].str_or_empty();
		// "(a)", "a" and "A" are one part, as the learner's panel reads them.
		let bare = |label: &str| label.trim().trim_start_matches('(').trim_end_matches(')').to_lowercase();
		if !labels.is_empty() && !labels.iter().any(|label| bare(label) == bare(part)) {
			return invalid_input_result("part", &[format!("no part {}; the parts are {}", quote(part), labels.join(", "))]);
		}
		json!({ "content": [text_block("Marked.")], "details": null })
	})
	.sequential()
}

fn conclude_tool(ctx: &HomeworkToolContext, open: &Arc<Mutex<Option<String>>>) -> FnTool {
	let (open, homework, chat_id, chat_store) = (open.clone(), ctx.homework.clone(), ctx.chat_id.clone(), ctx.chat_store.clone());
	let parameters = object(
		&["outcome", "verdict"],
		vec![
			(
				"outcome",
				one_of_literals(
					&["solved", "solvedWithHints", "movedOn", "dismissed"],
					"REQUIRED \u{2014} solved or solvedWithHints once the learner's own work is right (marks the problem done), movedOn when the learner leaves it for now. Bare words, no quotes (dismissed is synthesized, never yours).",
				),
			),
			("verdict", string("REQUIRED \u{2014} what was right in the learner's work, or where it still breaks. Never the answer.")),
		],
	);
	let description = "Close the open problem with the outcome and verdict; solved and solvedWithHints mark it done. Then say your closing words and END YOUR TURN: the next problem waits for the learner's go-ahead. When they asked for a different problem, that ask is the go-ahead: open it right after this result. Never conclude while parts you will still ask remain: ask them first and conclude after the last part.";
	FnTool::immediate("conclude", description, parameters, move |args| {
		let mut open = open.lock();
		let Some(number) = open.take() else {
			return invalid_input_result("conclude", &["no problem is open".to_owned()]);
		};
		if conclude_marks_done(&args["outcome"]) {
			homework.mark_done(&number);
		}
		// With every problem done, the done bar shows instead of a stop; a problem left for a picked
		// one makes none either.
		let left = homework.problems().iter().any(|p| !p["done"].truthy());
		let messages = record_messages(&chat_store, &chat_id);
		let picked = args["outcome"].as_str() == Some("movedOn") && picked_problem(&messages).is_some();
		conclude_result((left && !picked).then(|| long_problem_stop(&messages, clock::now_ms())).flatten())
	})
	.sequential()
}

/// The homework agent's whole registry; `enabled` filters the side tools as in practice.
pub fn homework_tools(ctx: &HomeworkToolContext, enabled: Option<&Json>) -> Vec<FnTool> {
	let open = Arc::new(Mutex::new(open_problem_of(ctx)));
	let mut tools = vec![post_problems_tool(ctx.homework.clone(), ctx.pages.clone()), problem_tool(ctx.homework.clone(), &open), part_tool(ctx.homework.clone(), &open), conclude_tool(ctx, &open)];
	tools.extend(practice_side_tools(ctx.jobs.as_ref(), &ctx.side, enabled));
	heal_tool_record(tools)
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::abort::Abort;
	use gs_engine::turn::tool::{Tool, ToolContext};

	use super::*;
	use crate::tools::plan::PlanContext;
	use crate::tools::test_record::{FakePages, learner_at, record};

	struct Deadline(Mutex<Vec<Json>>);

	impl ProblemList for Deadline {
		fn problems(&self) -> Vec<Json> {
			self.0.lock().clone()
		}
		fn post(&self, problems: &[Json]) -> Option<String> {
			*self.0.lock() = problems.to_vec();
			None
		}
		fn mark_done(&self, number: &str) {
			for p in self.0.lock().iter_mut().filter(|p| p["number"].as_str() == Some(number)) {
				p.as_obj_mut().unwrap().insert("done", true);
			}
		}
	}

	/// Problem 1 open for 26 active minutes, with problem 2 after it; `then` is the learner's
	/// newest input.
	async fn conclude_one(outcome: &str, problems: Json, then: Option<Json>) -> Json {
		let posed = json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "h1", "name": "problem", "arguments": { "number": "1", "statement": "s" } }], "timestamp": clock::now_ms() - 26 * 60_000 });
		let result = json!({ "role": "toolResult", "toolCallId": "h1", "toolName": "problem", "details": null, "isError": false, "timestamp": clock::now_ms() - 26 * 60_000 });
		let worked: Vec<Json> = (0..6).map(|i| learner_at(22 - 4 * i)).collect();
		let PlanContext { chat_id, chat_store } = record([vec![posed, result], worked, then.into_iter().collect()].concat());
		let homework = Arc::new(Deadline(Mutex::new(problems.as_arr().unwrap().clone())));
		let ctx = HomeworkToolContext { chat_id, chat_store, homework, jobs: None, side: LessonSide::default(), pages: FakePages::new(Err(String::new())) };
		let tool = homework_tools(&ctx, None).into_iter().find(|t| t.name() == "conclude").unwrap();
		tool.execute(json!({ "outcome": outcome, "verdict": "v" }), ToolContext { tool_call_id: "c1".to_owned(), abort: Abort::new() }).await.unwrap()
	}

	#[tokio::test]
	async fn a_long_problem_stops_unless_none_is_left() {
		let two = json!([{ "number": "1" }, { "number": "2" }]);
		let stop = &conclude_one("solved", two.clone(), None).await["details"]["stop"];
		assert_eq!((stop["kind"].as_str(), stop["activeMinutes"].as_f64()), (Some("problem"), Some(26.0)));
		assert_eq!(conclude_one("solved", json!([{ "number": "1" }, { "number": "2", "done": true }]), None).await["details"], Json::Null, "the done bar shows instead");
		assert_eq!(conclude_one("movedOn", json!([{ "number": "1" }]), None).await["details"]["stop"]["kind"].as_str(), Some("problem"), "problem 1 is still undone");
		let pick = json!({ "role": "custom", "customType": "practice-next", "details": { "number": "2" }, "timestamp": clock::now_ms() });
		assert_eq!(conclude_one("movedOn", two.clone(), Some(pick.clone())).await["details"], Json::Null, "he picked problem 2: no break before it");
		assert_eq!(conclude_one("solved", two, Some(pick)).await["details"]["stop"]["kind"].as_str(), Some("problem"), "solved on the way still stops");
	}

	#[tokio::test]
	async fn a_choice_problem_needs_two_to_eight_options() {
		let ctx = HomeworkToolContext { chat_id: "c".to_owned(), chat_store: record(vec![]).chat_store, homework: Arc::new(Deadline(Mutex::new(vec![json!({ "number": "1", "text": "t" })]))), jobs: None, side: LessonSide::default(), pages: FakePages::new(Err(String::new())) };
		let tool = homework_tools(&ctx, None).into_iter().find(|t| t.name() == "problem").unwrap();
		let pose = |extra: Json| {
			let mut input = json!({ "number": "1", "statement": "s" });
			for (key, value) in extra.as_obj().unwrap().iter() {
				input.as_obj_mut().unwrap().insert(key, value.clone());
			}
			tool.execute(input, ToolContext { tool_call_id: "p1".to_owned(), abort: Abort::new() })
		};
		let out = pose(json!({ "options": [{ "label": "only" }] })).await.unwrap();
		assert_eq!(out["isError"].as_bool(), Some(true));
		assert!(out["details"]["problems"][0].as_str().unwrap().contains("1 items"));
		assert_eq!(pose(json!({ "multiSelect": true })).await.unwrap()["isError"].as_bool(), Some(true));
		assert_ne!(pose(json!({ "options": [{ "label": "a" }, { "label": "b" }] })).await.unwrap()["isError"].as_bool(), Some(true));
	}

	fn run(deadline: &Arc<Deadline>, pages: &Arc<FakePages>, tool: &str) -> FnTool {
		let ctx = HomeworkToolContext { chat_id: "c".to_owned(), chat_store: record(vec![]).chat_store, homework: deadline.clone(), jobs: None, side: LessonSide::default(), pages: pages.clone() };
		homework_tools(&ctx, None).into_iter().find(|t| t.name() == tool).unwrap()
	}

	async fn call(tool: &FnTool, args: Json) -> Json {
		tool.execute(args, ToolContext { tool_call_id: "t1".to_owned(), abort: Abort::new() }).await.unwrap()
	}

	fn piece_of(file: &str, labels: Json) -> Json {
		json!({ "fileId": file, "parts": [{ "page": 1, "crop": [0.1, 0.1, 0.9, 0.4], "aspect": 0.77 }], "labels": labels })
	}

	#[tokio::test]
	async fn a_posted_source_becomes_a_piece_and_ends_where_the_next_problem_starts() {
		let deadline = Arc::new(Deadline(Mutex::new(Vec::new())));
		let pages = FakePages::new(Ok(json!({ "piece": piece_of("f_1", json!([])), "text": "1. First problem" })));
		let post = run(&deadline, &pages, "post_problems");
		let first = json!({ "number": "1", "title": "First", "page": 1, "source": { "page": 1, "starts": "1. First" } });
		let second = json!({ "number": "2", "title": "Second", "text": "Typed two.", "source": { "page": 1, "starts": "2. Second", "ends": "3. Third" } });
		let plain = json!({ "number": "3", "title": "Third", "text": "Typed three.", "page": 2 });
		let out = call(&post, json!({ "problems": [first, second, plain] })).await;
		assert_ne!(out["isError"].as_bool(), Some(true), "{out:?}");
		let asked = pages.asked.lock();
		assert_eq!(asked[0], (json!({ "page": 1, "starts": "1. First", "ends": "2. Second" }), None), "the next problem's words end it");
		assert_eq!(asked[1], (json!({ "page": 1, "starts": "2. Second", "ends": "3. Third" }), Some("Typed two.".to_owned())), "its own ends stand, and the typed text goes along");
		assert_eq!(asked.len(), 2, "a problem with no source is not looked up");
		let saved = deadline.0.lock();
		assert_eq!((saved[0]["text"].as_str(), saved[0].get("page"), saved[0].get("source")), (Some("1. First problem"), None, None), "the piece's words stand in for the text; no page, no source");
		assert_eq!(saved[0]["piece"]["fileId"].as_str(), Some("f_1"));
		assert_eq!(saved[1]["text"].as_str(), Some("Typed two."));
		assert_eq!((saved[2]["text"].as_str(), saved[2]["page"].as_f64(), saved[2].get("piece")), (Some("Typed three."), Some(2.0), None));
	}

	#[tokio::test]
	async fn one_problem_that_refuses_saves_nothing_and_is_named() {
		let deadline = Arc::new(Deadline(Mutex::new(vec![json!({ "number": "old", "text": "t" })])));
		let post = run(&deadline, &FakePages::new(Err("not on page 1".to_owned())), "post_problems");
		let out = call(&post, json!({ "problems": [{ "number": "1", "title": "A", "text": "typed" }, { "number": "2b", "title": "B", "source": { "page": 1, "starts": "x" } }] })).await;
		assert_eq!(out["details"]["problems"][0].as_str(), Some("problem 2b: not on page 1"));
		let neither = call(&post, json!({ "problems": [{ "number": "4", "title": "D" }] })).await;
		assert_eq!(neither["details"]["problems"][0].as_str(), Some("problem 4: give the statement, or a source to show the page itself"));
		assert_eq!(deadline.0.lock()[0]["number"].as_str(), Some("old"), "the list is as it was");
		let scan = FakePages::new(Ok(json!({ "piece": piece_of("f_1", json!([])), "text": "" })));
		let blank = call(&run(&deadline, &scan, "post_problems"), json!({ "problems": [{ "number": "5", "title": "E", "source": { "page": 1, "starts": "x" } }] })).await;
		assert!(blank["details"]["problems"][0].as_str().unwrap().starts_with("problem 5: the page has no words"));
	}

	#[tokio::test]
	async fn a_posted_piece_opens_with_its_words_and_a_problem_without_one_needs_a_statement() {
		let with_piece = json!({ "number": "1", "title": "A", "text": "1. First problem", "piece": piece_of("f_1", json!([{ "label": "a", "page": 1, "y": 0.2 }, { "label": "b", "page": 1, "y": 0.3 }])) });
		let deadline = Arc::new(Deadline(Mutex::new(vec![with_piece.clone(), json!({ "number": "2", "title": "B", "text": "typed" })])));
		let pages = FakePages::new(Err(String::new()));
		let out = call(&run(&deadline, &pages, "problem"), json!({ "number": "1" })).await;
		assert_eq!(out["details"], json!({ "piece": with_piece["piece"].clone(), "text": "1. First problem" }));
		assert!(out["content"][0]["text"].as_str().unwrap().ends_with("The problem as the file prints it:\n1. First problem"));
		assert_eq!(out["terminate"], Json::Bool(true));
		let bare = call(&run(&deadline, &pages, "problem"), json!({ "number": "2" })).await;
		assert!(bare["details"]["problems"][0].as_str().unwrap().starts_with("give the statement, or a source"));
		assert_eq!(call(&run(&deadline, &pages, "problem"), json!({ "number": "2", "statement": "typed" })).await["details"], Json::Null);
	}

	#[tokio::test]
	async fn a_part_must_be_one_the_page_labels() {
		let labelled = json!({ "number": "1", "title": "A", "text": "t", "piece": piece_of("f_1", json!([{ "label": "a", "page": 1, "y": 0.2 }, { "label": "b", "page": 1, "y": 0.3 }, { "label": "c", "page": 1, "y": 0.4 }])) });
		let plain = json!({ "number": "2", "title": "B", "text": "t" });
		for (number, part, refused) in [("1", "b", None), ("1", "(B)", None), ("1", "x", Some("no part \"x\"; the parts are a, b, c")), ("2", "x", None)] {
			let deadline = Arc::new(Deadline(Mutex::new(vec![labelled.clone(), plain.clone()])));
			let pages = FakePages::new(Err(String::new()));
			// The problem is open in the tool's own copy, as after a pose in this turn.
			let ctx = HomeworkToolContext { chat_id: "c".to_owned(), chat_store: record(vec![]).chat_store, homework: deadline.clone(), jobs: None, side: LessonSide::default(), pages };
			let tools = homework_tools(&ctx, None);
			let tool = |name: &str| tools.iter().find(|t| t.name() == name).unwrap();
			let posed = call(tool("problem"), json!({ "number": number, "statement": "s" })).await;
			assert_ne!(posed["isError"].as_bool(), Some(true), "{posed:?}");
			let out = call(tool("part"), json!({ "part": part })).await;
			assert_eq!(out["details"]["problems"][0].as_str(), refused, "{number} {part}");
		}
	}
}
