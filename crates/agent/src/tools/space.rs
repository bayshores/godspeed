//! The space tools of a lesson in a space: the live space card,
//! the note on the space cover, and search over the space's files.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::contracts::space::NOTE_MAX;
use gs_core::messages::native_messages::{space_card_text, space_files_text};
use gs_json::{Json, json};
use gs_search::index::PassageRef;

use super::fn_tool::FnTool;
use gs_core::session::schema::{no_arguments, object, string, string_min};

/// Saves the space note and gives the tool's reply.
pub type SetNote = Arc<dyn Fn(&str) -> String + Send + Sync>;
/// Searches the space's files for a query, at most `limit` passages.
pub type SearchFiles = Box<dyn Fn(String, usize) -> BoxFuture<'static, Result<String, String>> + Send + Sync>;

/// What the space tools close over. Present only for lessons in a space.
#[derive(Clone)]
pub struct SpaceToolContext {
	/// The lesson's space card as it stands now; none when the space is gone, Err when its graph
	/// cannot be read.
	pub space_card: Arc<dyn Fn() -> Result<Option<Json>, String> + Send + Sync>,
	/// The [Today] note (date, time, open deadlines), added after the card.
	pub today_note: Option<Arc<dyn Fn() -> String + Send + Sync>>,
	/// Search over the space's files: with it, search_space_files and read_passage exist.
	pub search: Option<Arc<SpaceSearch>>,
	/// Saves the note on the space cover and gives the tool's reply: with it, set_space_note exists.
	pub set_note: Option<SetNote>,
}

/// The lesson's space-file search.
pub struct SpaceSearch {
	pub search_files: SearchFiles,
	pub read_passage: Box<dyn Fn(PassageRef) -> String + Send + Sync>,
}

/// read_space, then the note tool and the search tools when their readers exist.
pub fn space_tools(ctx: &SpaceToolContext) -> Vec<FnTool> {
	let mut tools = vec![read_space_tool(ctx)];
	if let Some(set_note) = &ctx.set_note {
		tools.push(set_space_note_tool(set_note.clone()));
	}
	if let Some(search) = &ctx.search {
		tools.extend(search_fn_tools(search.clone()));
	}
	tools
}

fn read_space_tool(ctx: &SpaceToolContext) -> FnTool {
	let (space_card, today_note) = (ctx.space_card.clone(), ctx.today_note.clone());
	let description = "Read the current card of this lesson's space: the space name, the learner's description of the space, its files (study material and space info) with the paths to open them, and the topics of its knowledge graph. \
		Use it when you need a file's path (the opening [Space context] card only counts the files) or space details that changed since the lesson started. To find something inside the files, use search_space_files instead. \
		It also returns today's date and time and the space's open deadlines (the [Today] note).";
	FnTool::server("read_space", description, no_arguments(), move |_args, _ctx| {
		let (space_card, today_note) = (space_card.clone(), today_note.clone());
		async move {
			let Some(card) = space_card()? else {
				return Ok(Json::from("This lesson's space no longer exists."));
			};
			let parts = [space_card_text(&card), space_files_text(&card), today_note.map(|note| note()).unwrap_or_default()];
			Ok(Json::from(parts.into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join("\n\n")))
		}
	})
}

fn set_space_note_tool(set_note: Arc<dyn Fn(&str) -> String + Send + Sync>) -> FnTool {
	let parameters = object(&["text"], vec![("text", json!({ "type": "string", "minLength": 1, "maxLength": NOTE_MAX, "description": "Two short sentences in plain words, to the learner." }))]);
	let description = format!(
		"Replace the note on this space's cover page: two short sentences to the learner about where they stand in this space and what's next. \
		At most {NOTE_MAX} characters. Write it when you finish a topic or the learner wraps up; skip it when nothing changed."
	);
	FnTool::server("set_space_note", description, parameters, move |args, _ctx| {
		let set_note = set_note.clone();
		async move { Ok(Json::from(set_note(args["text"].as_str().unwrap_or_default()))) }
	})
}

/// search_space_files and read_passage, for the cheat sheet writer.
pub fn search_tools(search: SpaceSearch) -> Vec<Arc<dyn gs_engine::turn::tool::Tool>> {
	search_fn_tools(Arc::new(search)).into_iter().map(FnTool::into_arc).collect()
}

fn search_fn_tools(search: Arc<SpaceSearch>) -> Vec<FnTool> {
	let search_files = search.clone();
	let search_input = object(
		&["query"],
		vec![
			("query", string_min(1, "What to look for, in plain words.")),
			("limit", json!({ "type": "integer", "minimum": 1, "maximum": 20, "description": "Most passages to return (default 8)." })),
		],
	);
	let search_description = "Search all of this space's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. \
		Returns the best passages, each with its id, file, place (page, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files.";
	let search_tool = FnTool::server("search_space_files", search_description, search_input, move |args, _ctx| {
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
			("passage_id", string("A passage id from search_space_files (or a previous/next id).")),
			("file_id", string("Instead of passage_id: a space file id (the part of a passage id before the \":\"), with range.")),
			("range", string("With file_id: the place, e.g. \"p. 12\", \"12:30\" or \"lines 40\".")),
		],
	);
	let read_description = "Read one passage of a space file by its id from search_space_files, or a file's passages at a place (file_id + range, e.g. a whole page). \
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
