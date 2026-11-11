//! The class tools of a lesson in a class (src/backend/agent/tools/class.ts): the live class card,
//! the note on the class cover, and search over the class's files.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::contracts::class::NOTE_MAX;
use gs_core::messages::native_messages::class_card_text;
use gs_json::{Json, json};
use gs_search::index::PassageRef;

use super::fn_tool::FnTool;
use gs_core::session::schema::{no_arguments, object, string, string_min};

/// Saves the class note and gives the tool's reply.
pub type SetNote = Arc<dyn Fn(&str) -> String + Send + Sync>;
/// Searches the class's files for a query, at most `limit` passages.
pub type SearchFiles = Box<dyn Fn(String, usize) -> BoxFuture<'static, Result<String, String>> + Send + Sync>;

/// What the class tools close over. Present only for lessons in a class.
#[derive(Clone)]
pub struct ClassToolContext {
	/// The lesson's class card as it stands now; none when the class is gone, Err when its graph
	/// cannot be read.
	pub class_card: Arc<dyn Fn() -> Result<Option<Json>, String> + Send + Sync>,
	/// The [Today] note (date, time, open deadlines), added after the card.
	pub today_note: Option<Arc<dyn Fn() -> String + Send + Sync>>,
	/// Search over the class's files: with it, search_class_files and read_passage exist.
	pub search: Option<Arc<ClassSearch>>,
	/// Saves the note on the class cover and gives the tool's reply: with it, set_class_note exists.
	pub set_note: Option<SetNote>,
}

/// The lesson's class-file search.
pub struct ClassSearch {
	pub search_files: SearchFiles,
	pub read_passage: Box<dyn Fn(PassageRef) -> String + Send + Sync>,
}

/// read_class, then the note tool and the search tools when their readers exist.
pub fn class_tools(ctx: &ClassToolContext) -> Vec<FnTool> {
	let mut tools = vec![read_class_tool(ctx)];
	if let Some(set_note) = &ctx.set_note {
		tools.push(set_class_note_tool(set_note.clone()));
	}
	if let Some(search) = &ctx.search {
		tools.extend(search_fn_tools(search.clone()));
	}
	tools
}

fn read_class_tool(ctx: &ClassToolContext) -> FnTool {
	let (class_card, today_note) = (ctx.class_card.clone(), ctx.today_note.clone());
	let description = "Read the current card of this lesson's class: the class name, the learner's description of the course, its files (study material and course info) with the paths to open them, and the topics of its knowledge graph. \
		Use it when you need class details the opening [Class context] card may not have (files added since the lesson started, an edited description). \
		It also returns today's date and time and the class's open deadlines (the [Today] note).";
	FnTool::server("read_class", description, no_arguments(), move |_args, _ctx| {
		let (class_card, today_note) = (class_card.clone(), today_note.clone());
		async move {
			let Some(card) = class_card()? else {
				return Ok(Json::from("This lesson's class no longer exists."));
			};
			Ok(Json::from(match today_note {
				Some(note) => format!("{}\n\n{}", class_card_text(&card), note()),
				None => class_card_text(&card),
			}))
		}
	})
}

fn set_class_note_tool(set_note: Arc<dyn Fn(&str) -> String + Send + Sync>) -> FnTool {
	let parameters = object(&["text"], vec![("text", json!({ "type": "string", "minLength": 1, "maxLength": NOTE_MAX, "description": "Two short sentences in plain words, to the learner." }))]);
	let description = format!(
		"Replace the note on this class's cover page: two short sentences to the learner about where they stand in this class and what's next. \
		At most {NOTE_MAX} characters. Write it when you finish a topic or the learner wraps up; skip it when nothing changed."
	);
	FnTool::server("set_class_note", description, parameters, move |args, _ctx| {
		let set_note = set_note.clone();
		async move { Ok(Json::from(set_note(args["text"].as_str().unwrap_or_default()))) }
	})
}

/// search_class_files and read_passage, for the cheat sheet writer.
pub fn search_tools(search: ClassSearch) -> Vec<Arc<dyn gs_engine::turn::tool::Tool>> {
	search_fn_tools(Arc::new(search)).into_iter().map(FnTool::into_arc).collect()
}

fn search_fn_tools(search: Arc<ClassSearch>) -> Vec<FnTool> {
	let search_files = search.clone();
	let search_input = object(
		&["query"],
		vec![
			("query", string_min(1, "What to look for, in plain words.")),
			("limit", json!({ "type": "integer", "minimum": 1, "maximum": 20, "description": "Most passages to return (default 8)." })),
		],
	);
	let search_description = "Search all of this class's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. \
		Returns the best passages, each with its id, file, place (page, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files.";
	let search_tool = FnTool::server("search_class_files", search_description, search_input, move |args, _ctx| {
		let search = search_files.clone();
		async move {
			let query = args["query"].as_str().unwrap_or_default().to_owned();
			let limit = args["limit"].as_f64().map_or(8, |n| n as usize);
			(search.search_files)(query, limit).await.map(Json::from)
		}
	});

	let read_input = object(
		&[],
		vec![
			("passage_id", string("A passage id from search_class_files (or a previous/next id).")),
			("file_id", string("Instead of passage_id: a class file id (the part of a passage id before the \":\"), with range.")),
			("range", string("With file_id: the place, e.g. \"p. 12\", \"12:30\" or \"lines 40\".")),
		],
	);
	let read_description = "Read one passage of a class file by its id from search_class_files, or a file's passages at a place (file_id + range, e.g. a whole page). \
		Returns the text with the ids of the passages before and after it, to keep reading.";
	let read_tool = FnTool::server("read_passage", read_description, read_input, move |args, _ctx| {
		let search = search.clone();
		async move {
			let text = |key: &str| args[key].as_str().filter(|s| !s.is_empty()).map(str::to_owned);
			Ok(Json::from(match (text("passage_id"), text("file_id"), text("range")) {
				(Some(passage_id), ..) => (search.read_passage)(PassageRef::Passage(passage_id)),
				(None, Some(file_id), Some(range)) => (search.read_passage)(PassageRef::Place { file_id, range }),
				_ => "Give passage_id, or file_id with range.".to_owned(),
			}))
		}
	});
	vec![search_tool, read_tool]
}
